/* 全局数据模型。M1 全部在客户端；M2 起 GridDoc 的 answers 部分移到服务端，
   但这里的类型保持不变 —— 前端只多一个"服务端判定"的实现替换掉本地引擎。

   v2 起 2D 与 3D 统一成同一套模型：**N 条轴 × 每轴若干特质，格子 = 各轴各取一值**。
   - 2D：2 条轴（列、行），即原来的 rows × cols
   - 3D：3 条轴（X、Y、Z），27 格
   所以「尺寸」不再是独立字段，而是 axes 的函数。 */

export type GridSize = 2 | 3 | 4 | 5;

export const GRID_SIZES: GridSize[] = [2, 3, 4, 5];

/** 3D 题每条轴固定 3 个特质 —— 3×3×3 = 27 格，这是玩法定义的，不是可调参数。 */
export const AXIS_LEN_3D = 3;

/** 一条轴（2D 里的行或列；3D 里的 X/Y/Z）。 */
export type Axis = {
  label: string;
  /** 轴上的特质，格子的第 n 个下标就取自 axes[n].values */
  values: string[];
};

/** 一条轴上的一个条件。2D 的 Category 现在只是 Axis 的一个值 + 轴的说明。 */
export type Category = {
  label: string;
  hint?: string;
};

/**
 * 判定模式，由出题人选：
 * - `answers` 预设答案：格子有标准答案，玩家猜，精确/别名/同义词匹配（2D 默认）
 * - `open` 开放判定：格子无标准答案，玩家自由造词，AI 判是否符合各轴特质 + 冷门度（3D 默认）
 */
export type JudgeMode = "answers" | "open";

export const JUDGE_MODE_LABEL: Record<JudgeMode, string> = {
  answers: "预设答案",
  open: "开放造词",
};

/** 一个被接受的答案。一个格子可以有多个正确答案。 */
export type CellAnswer = {
  id: string;
  /** 主答案，也是判定命中后回显的规范写法 */
  text: string;
  /** 别名：拼写/缩写/译名差异，如 "MC" → "Minecraft" */
  aliases: string[];
  /** 同义词：不同的词指同一物，如 "轿车" → "汽车" */
  synonyms: string[];
  /** 答案描述，展示在结果卡片与提示里 */
  note?: string;
  /** 答案配图 URL */
  image?: string;
};

/**
 * 格子状态机。UI 直接按这个渲染，别再散落布尔量。
 * empty → 未填；searching → 判定中；correct/incorrect/similar → 判定结果；
 * auto → 由「自动填充」写入（视觉上要能区分，否则玩家不知道哪些不是自己填的）；
 * error → 判定失败（网关挂了、没配 key）。**不能并进 incorrect** ——
 *         把"没判成"显示成"答错了"是在骗玩家。
 */
export type CellStatus = "empty" | "searching" | "correct" | "incorrect" | "similar" | "auto" | "error";

export const CELL_STATUS_LABEL: Record<CellStatus, string> = {
  empty: "待填",
  searching: "判定中",
  correct: "正确",
  incorrect: "不符",
  similar: "接近",
  auto: "自动填入",
  error: "判定失败",
};

export type Cell = {
  x: number;
  y: number;
  /** 3D 题才有 */
  z?: number;
  /** `answers` 模式用；`open` 模式的格子恒为空数组 */
  answers: CellAnswer[];
  status: CellStatus;
  /** 玩家最后一次提交的原文，用于结果卡片回显 */
  guess?: string;
  /** 判定置信度 0..1，similar 状态下展示 */
  confidence?: number;
  /** 若不通过，服务端/引擎给出的简短原因 */
  reason?: string;
  /** `open` 模式：AI 判定是否符合该格特质组合 */
  ok?: boolean | null;
  /** `open` 模式：冷门度 0..10，越小越冷门；null = 没判出来 */
  rarity?: number | null;
};

/** 发布状态。draft 只有创建者能看到，unlisted 有链接就能玩但不上首页。 */
export type GridStatus = "draft" | "private" | "unlisted" | "public";

export const GRID_STATUS_LABEL: Record<GridStatus, string> = {
  draft: "草稿",
  private: "私密",
  unlisted: "仅链接",
  public: "公开",
};

export type GridDoc = {
  v: 2;
  id: string;
  title: string;
  description: string;
  /** 长度 2 或 3。dims = axes.length，各轴长度即该维的格子数。 */
  axes: Axis[];
  judgeMode: JudgeMode;
  /** key 由 cellKey 生成，答案只存这里 */
  cells: Record<string, Cell>;
  /** 仅 `answers` 模式生效 */
  similarSearch: boolean;
  status: GridStatus;
  updatedAt: number;
};

/** 2D → `"x,y"`；3D → `"x,y,z"`。 */
export const cellKey = (x: number, y: number, z?: number) =>
  z === undefined ? `${x},${y}` : `${x},${y},${z}`;

export const parseCellKey = (k: string): [number, number, number?] => {
  const parts = k.split(",").map(Number);
  return parts.length === 3 ? [parts[0], parts[1], parts[2]] : [parts[0], parts[1]];
};

/** 题目维度：2 或 3。 */
export const dimsOf = (doc: GridDoc): number => doc.axes.length;

/** 某条轴上特质的个数。2D 题两条轴等长，即棋盘边长。 */
export const axisLen = (doc: GridDoc, n: number): number => doc.axes[n]?.values.length ?? 0;

/** 2D 题的棋盘边长（2..5）；3D 题返回该维长度。 */
export const sizeOf = (doc: GridDoc): number => axisLen(doc, 0);

/** 该题一共多少格 —— 各轴长度之积。 */
export const cellCount = (doc: Axed): number =>
  doc.axes.reduce((n, ax) => n * ax.values.length, 1);

/** 尺寸的展示写法：2D 是 "3×3"，3D 是 "3×3×3"。 */
export const sizeLabel = (doc: Axed): string => doc.axes.map((ax) => ax.values.length).join("×");

/** 只依赖 axes 的形状，方便在文档还没拼全时（如构建示例题）就能枚举格子。 */
export type Axed = { axes: Axis[] };

/** 枚举全部格子下标。3D 按 z 再 y 再 x 的顺序，与旧版 3D 的编号一致。 */
export function allCoords(doc: Axed): [number, number, number?][] {
  const [a, b] = doc.axes;
  const out: [number, number, number?][] = [];
  if (doc.axes.length < 3) {
    for (let y = 0; y < (b?.values.length ?? 0); y++)
      for (let x = 0; x < (a?.values.length ?? 0); x++) out.push([x, y]);
    return out;
  }
  const c = doc.axes[2];
  for (let z = 0; z < c.values.length; z++)
    for (let y = 0; y < b.values.length; y++)
      for (let x = 0; x < a.values.length; x++) out.push([x, y, z]);
  return out;
}

/** 某个格子「各轴各取一值」的文字描述，喂给 AI 裁判、也用作 tooltip。 */
export const comboText = (doc: Axed, coords: (number | undefined)[]): string =>
  doc.axes.map((ax, n) => `${ax.label}：${ax.values[coords[n] ?? 0] ?? ""}`).join(" ｜ ");

/* ============================================================================
   v1 → v2 迁移
   v1 的存档躺在用户 localStorage 里（`{v:1, size, rows, cols, cells}`），
   直接当 v2 用会读到 undefined 的 axes 而崩在渲染里。所以读档处一律过这里。
   ========================================================================== */

type V1Doc = {
  v?: number;
  id?: string;
  title?: string;
  description?: string;
  size?: number;
  rows?: Category[];
  cols?: Category[];
  cells?: Record<string, Cell>;
  similarSearch?: boolean;
  status?: GridStatus;
  updatedAt?: number;
};

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

/** 把任意来源的存档整成合法的 v2 文档；认不出来就返回 null。 */
export function migrateV1(raw: unknown): GridDoc | null {
  if (!isObj(raw)) return null;
  const d = raw as V1Doc;

  if (d.v === 2) {
    /* 已经是 v2：只做最低限度的形状校验，别让半截存档把渲染搞崩 */
    const axes = Array.isArray((raw as unknown as GridDoc).axes) ? (raw as unknown as GridDoc).axes : null;
    if (!axes || axes.length < 2) return null;
    const cells = isObj(d.cells) ? (d.cells as Record<string, Cell>) : {};
    return {
      v: 2,
      id: d.id ?? "",
      title: d.title ?? "未命名题",
      description: d.description ?? "",
      axes,
      judgeMode: (raw as unknown as GridDoc).judgeMode === "open" ? "open" : "answers",
      cells,
      similarSearch: d.similarSearch !== false,
      status: d.status ?? "draft",
      updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
    };
  }

  if (d.v !== 1) return null;

  /* v1 只有 2D：rows/cols 两个 Category 数组，长度应等于 size，但可能被裁短过 */
  const size = Math.max(2, Math.min(5, typeof d.size === "number" ? d.size : 3));
  const labelsOf = (arr: Category[] | undefined, prefix: string): string[] =>
    Array.from({ length: size }, (_, i) => arr?.[i]?.label ?? `${prefix} ${i + 1}`);

  const cells: Record<string, Cell> = {};
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = cellKey(x, y);
      const c = d.cells?.[k];
      cells[k] = {
        x,
        y,
        answers: Array.isArray(c?.answers) ? c.answers : [],
        status: c?.status ?? "empty",
        guess: c?.guess,
        confidence: c?.confidence,
        reason: c?.reason,
      };
    }
  }

  return {
    v: 2,
    id: d.id ?? "",
    title: d.title ?? "未命名题",
    description: d.description ?? "",
    /* 轴的顺序是有讲究的：values[x] 必须对应横坐标 x，所以列轴在前 */
    axes: [
      { label: "列条件", values: labelsOf(d.cols, "条件") },
      { label: "行条件", values: labelsOf(d.rows, "条件") },
    ],
    judgeMode: "answers",
    cells,
    similarSearch: d.similarSearch !== false,
    status: d.status ?? "draft",
    updatedAt: typeof d.updatedAt === "number" ? d.updatedAt : 0,
  };
}
