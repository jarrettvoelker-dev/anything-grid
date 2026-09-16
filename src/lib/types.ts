/* 全局数据模型。M1 全部在客户端；M2 起 GridDoc 的 answers 部分移到服务端，
   但这里的类型保持不变 —— 前端只多一个"服务端判定"的实现替换掉本地引擎。 */

export type GridSize = 2 | 3 | 4 | 5;

export const GRID_SIZES: GridSize[] = [2, 3, 4, 5];

/** 一条轴上的一个条件（行或列）。 */
export type Category = {
  label: string;
  hint?: string;
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
 * auto → 由「自动填充」写入（视觉上要能区分，否则玩家不知道哪些不是自己填的）。
 */
export type CellStatus = "empty" | "searching" | "correct" | "incorrect" | "similar" | "auto";

export const CELL_STATUS_LABEL: Record<CellStatus, string> = {
  empty: "待填",
  searching: "判定中",
  correct: "正确",
  incorrect: "不符",
  similar: "接近",
  auto: "自动填入",
};

export type Cell = {
  x: number;
  y: number;
  answers: CellAnswer[];
  status: CellStatus;
  /** 玩家最后一次提交的原文，用于结果卡片回显 */
  guess?: string;
  /** 判定置信度 0..1，similar 状态下展示 */
  confidence?: number;
  /** 若不通过，服务端/引擎给出的简短原因 */
  reason?: string;
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
  v: 1;
  id: string;
  title: string;
  description: string;
  size: GridSize;
  /** 行条件，长度 = size */
  rows: Category[];
  /** 列条件，长度 = size */
  cols: Category[];
  /** key = `${x},${y}`，答案只存这里 */
  cells: Record<string, Cell>;
  /** 是否开启相似搜索 */
  similarSearch: boolean;
  status: GridStatus;
  updatedAt: number;
};

export const cellKey = (x: number, y: number) => `${x},${y}`;

export const parseCellKey = (k: string): [number, number] => {
  const [x, y] = k.split(",");
  return [Number(x), Number(y)];
};
