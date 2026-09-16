/* ============================================================================
   开放造词模式的 AI 裁判（`judgeMode: "open"`）
   移植自旧版 3D 单文件的 judgeKey —— 玩法与提示词保持不变。

   为什么这一档可以走**玩家** BYOK，而 2D 的语义搜索必须走**创建者** BYOK：
   - 开放模式下题目**没有隐藏答案**，喂给模型的只有「特质组合 + 玩家自己刚敲的词」。
     玩家就算把 Base URL 指向自己的服务器，也偷不到任何他不知道的东西。
   - 预设答案模式下答案是要藏的，判定必须由持有答案的一方（服务端/创建者）发起。

   因此这里用玩家的 key 是安全的，且符合「不花宿主钱」的原则。
   ========================================================================== */

export type JudgeConfig = {
  base: string;
  model: string;
  key: string;
};

export type JudgeResult = {
  /** true 符合 / false 不符 / null 判定失败（网关挂了、解析不出来） */
  ok: boolean | null;
  /** 冷门度 0..10，越小越冷门；解析不出来时 null */
  rarity: number | null;
  reason: string;
};

const KEY_JUDGE = "ag.judge.v1";
const EMPTY: JudgeConfig = { base: "", model: "", key: "" };

export const isJudgeReady = (c: JudgeConfig): boolean => Boolean(c.base && c.model && c.key);

export function loadJudgeConfig(): JudgeConfig {
  try {
    const raw = localStorage.getItem(KEY_JUDGE);
    if (!raw) return { ...EMPTY };
    const d = JSON.parse(raw) as Partial<JudgeConfig>;
    return {
      base: typeof d.base === "string" ? d.base : "",
      model: typeof d.model === "string" ? d.model : "",
      key: typeof d.key === "string" ? d.key : "",
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveJudgeConfig(c: JudgeConfig): void {
  try {
    if (!isJudgeReady(c)) localStorage.removeItem(KEY_JUDGE);
    else localStorage.setItem(KEY_JUDGE, JSON.stringify(c));
  } catch {
    /* 隐私模式禁用存储 —— 静默降级，本局仍可用 */
  }
}

/**
 * 从模型回复里抠出判定结果。
 * 模型经常在 JSON 外面裹一层 ```json 或者寒暄，所以先抓最外层的花括号块。
 * 纯函数，单独测 —— 这是整条链路上最容易出意外的一段。
 */
export function parseJudgeResponse(text: string): JudgeResult {
  const m = text.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(m ? m[0] : text) as { ok?: unknown; rarity?: unknown; reason?: unknown };
    return {
      ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
      rarity: typeof parsed.rarity === "number" && Number.isFinite(parsed.rarity) ? parsed.rarity : null,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    return { ok: null, rarity: null, reason: "判定失败：模型没有返回可解析的 JSON" };
  }
}

const SYSTEM_PROMPT =
  "你是严格的出题裁判。用户给出三个特质标签和一个答案（任意事物、概念、生物、物品均可）。" +
  "判断该答案是否同时符合这三个特质。只输出 JSON，不要任何多余文字：" +
  '{"ok":true,"rarity":0,"reason":"不超过30字的中文理由"}。' +
  "rarity 表示该答案在该组合下的冷门程度：0=极其冷门，10=非常常见（越冷门分越低）。";

/** 请 AI 判一格。失败一律降级成 ok:null + 原因，绝不抛 —— 网关挂了不该让整局玩不下去。 */
export async function judgeEntry(
  cfg: JudgeConfig,
  combo: string,
  answer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<JudgeResult> {
  if (!isJudgeReady(cfg)) return { ok: null, rarity: null, reason: "未配置 AI 裁判" };
  const text = answer.trim();
  if (!text) return { ok: null, rarity: null, reason: "空格子" };

  try {
    const res = await fetchImpl(cfg.base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `特质：${combo}\n答案：${text}` },
        ],
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: null, rarity: null, reason: `判定失败：HTTP ${res.status} ${detail.slice(0, 140)}` };
    }
    const js = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = js.choices?.[0]?.message?.content ?? "";
    return parseJudgeResponse(content);
  } catch (e) {
    return { ok: null, rarity: null, reason: "判定失败：" + (e instanceof Error ? e.message : String(e)) };
  }
}
