import type { Category, CellAnswer } from "./types";

/* ============================================================================
   相似搜索流水线
   规格要求的顺序：Exact → Alias → Synonym → Semantic → Category Validation → Confidence

   本文件是**纯函数 + 可注入的语义解析器**，因此：
   - M1 在客户端跑，语义档留空（resolver 不传 → 该档跳过）；
   - M3 只需传入一个走服务端 BYOK 的 resolver，本文件一行不用改。
   判定结果只回给 UI，**答案文本永远不下发到"待判定"的那一侧**。
   ========================================================================== */

export type MatchTier = "exact" | "alias" | "synonym" | "semantic" | "none";

export type MatchResult = {
  tier: MatchTier;
  /** 0..1。低于 accept 阈值的命中一律不判对。 */
  confidence: number;
  /** 过阈值，判为正确 */
  accepted: boolean;
  /** 未过阈值但足够接近 —— UI 提示"接近"，不算对 */
  similar: boolean;
  /** 命中时，回显用的规范答案 */
  canonical?: CellAnswer;
  /** 若不通过，给玩家的简短原因 */
  reason?: string;
};

/** 置信度阈值。semantic 档的产物必须同时过 accept 与类别校验才判对。 */
export const THRESHOLDS = {
  /** ≥ 此值才自动接受（判对） */
  accept: 0.8,
  /** [similar, accept) 之间提示"接近" */
  similar: 0.6,
} as const;

/** 语义档单独一个阈值：模型给的分数普遍偏高，卡得比字符串匹配严一点。 */
export const SEMANTIC_ACCEPT = 0.72;

/**
 * 归一化：全角转半角、大小写、去空白、去标点。
 * 中文没有词边界，所以连空格一起删 —— "mine craft" 与 "minecraft" 应当等价。
 */
export function normalize(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　]+/g, "")
    .replace(/[·・.,，。、!！?？'"“”‘’()（）[\]【】{}<>《》\-—_/\\|~`^*+=#$%&:;]/g, "");
}

/** Levenshtein 距离，带早退：差距超过 limit 直接返回 limit+1。 */
export function editDistance(a: string, b: string, limit = 64): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/** 相似度 0..1（1 = 完全相同）。 */
export function similarity(a: string, b: string): number {
  const n = normalize(a);
  const m = normalize(b);
  if (!n && !m) return 1;
  if (!n || !m) return 0;
  const max = Math.max(n.length, m.length);
  const d = editDistance(n, m, max);
  return Math.max(0, 1 - d / max);
}

/** 模糊档最高只给到 synonym 之下 —— 拼错一个字母不该等于答对。 */
const FUZZY_WEIGHT = 0.8;

export type SemanticResolver = (input: {
  guess: string;
  row: Category;
  col: Category;
  /** 本格的规范答案候选（创建者录入的主答案文本） */
  candidates: string[];
}) => Promise<{ match?: string; confidence: number; reason?: string } | null>;

export type MatchInput = {
  guess: string;
  answers: CellAnswer[];
  row: Category;
  col: Category;
  /** 关闭相似搜索时只做精确匹配 */
  similarEnabled: boolean;
  resolver?: SemanticResolver;
};

function ok(tier: MatchTier, confidence: number, canonical: CellAnswer): MatchResult {
  return { tier, confidence, accepted: true, similar: false, canonical };
}

/**
 * 判定一次猜测。
 * 关闭 similarSearch 时严格只认精确匹配，其余一律 incorrect —— 这是规格里写死的。
 */
export async function matchGuess(input: MatchInput): Promise<MatchResult> {
  const { guess, answers, row, col, similarEnabled, resolver } = input;
  const g = normalize(guess);

  if (!g) return { tier: "none", confidence: 0, accepted: false, similar: false, reason: "空答案" };
  if (!answers.length) {
    return { tier: "none", confidence: 0, accepted: false, similar: false, reason: "本题未录入答案" };
  }

  /* 1. Exact —— 关不关相似搜索都要跑 */
  for (const a of answers) {
    if (normalize(a.text) === g) return ok("exact", 1, a);
  }
  if (!similarEnabled) {
    return { tier: "none", confidence: 0, accepted: false, similar: false, reason: "答案不匹配" };
  }

  /* 2. Alias —— 拼写/缩写/译名差异 */
  for (const a of answers) {
    if (a.aliases.some((x) => normalize(x) === g)) return ok("alias", 0.95, a);
  }

  /* 3. Synonym —— 不同的词指同一物 */
  for (const a of answers) {
    if (a.synonyms.some((x) => normalize(x) === g)) return ok("synonym", 0.85, a);
  }

  /* 4. Semantic —— 只在开了相似搜索、且注入了 resolver 时跑。
        注意：resolver 结果必须先过 Category Validation，再谈置信度。 */
  if (resolver) {
    try {
      const r = await resolver({
        guess,
        row,
        col,
        candidates: answers.map((a) => a.text),
      });
      if (r) {
        const conf = Math.max(0, Math.min(1, r.confidence));
        /* Category Validation：语义命中必须落回本格已录入的某个答案，
           否则等于让模型凭空发明一个"正确答案"。 */
        const hit = r.match
          ? answers.find((a) => normalize(a.text) === normalize(r.match as string)) ??
            answers.find((a) =>
              [...a.aliases, ...a.synonyms].some((x) => normalize(x) === normalize(r.match as string)),
            )
          : undefined;
        if (hit && conf >= SEMANTIC_ACCEPT) {
          return { tier: "semantic", confidence: conf, accepted: true, similar: false, canonical: hit };
        }
        if (hit) {
          /* 模型认为像，但没到可信阈值 —— 提示"接近"，不判对 */
          return {
            tier: "semantic",
            confidence: conf,
            accepted: false,
            similar: conf >= THRESHOLDS.similar,
            reason: r.reason || "语义相似度不足，未自动判定",
          };
        }
      }
    } catch {
      /* 语义档是增强项，网关挂了不该让整局玩不下去 —— 静默降级到模糊匹配 */
    }
  }

  /* 5. 模糊匹配：只用来提示"接近"，永不判对 */
  let best = 0;
  let bestAnswer: CellAnswer | undefined;
  for (const a of answers) {
    const pool = [a.text, ...a.aliases, ...a.synonyms];
    for (const x of pool) {
      const s = similarity(guess, x) * FUZZY_WEIGHT;
      if (s > best) {
        best = s;
        bestAnswer = a;
      }
    }
  }
  if (best >= THRESHOLDS.similar) {
    return {
      tier: "none",
      confidence: best,
      accepted: false,
      similar: true,
      canonical: bestAnswer,
      reason: "拼写接近，但不是标准答案",
    };
  }
  return { tier: "none", confidence: best, accepted: false, similar: false, reason: "答案不匹配" };
}
