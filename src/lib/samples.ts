import { allCoords, cellKey, type Axis, type Cell, type CellAnswer, type GridDoc } from "./types";

/* 示例题库。纯内容，不是逻辑 —— 题目尺寸与条件完全由数据驱动，
   引擎里没有任何一处写死 3×3 或 2×2。这里覆盖 2×2 / 3×3 / 4×4 / 5×5 各一套，
   外加两套 3D 题演示开放造词模式。 */

type CellSeed = { answers: string[]; aliases?: string[]; synonyms?: string[]; note?: string };

const cellsFor = (axes: Axis[], seeds: Record<string, CellSeed>): Record<string, Cell> => {
  const cells: Record<string, Cell> = {};
  for (const [x, y, z] of allCoords({ axes })) {
    const k = cellKey(x, y, z);
    const seed = seeds[k];
    const answers: CellAnswer[] = seed
      ? seed.answers.map((text, i) => ({
          id: `s${k.replace(/,/g, "")}${i}`,
          text,
          aliases: i === 0 ? (seed.aliases ?? []) : [],
          synonyms: i === 0 ? (seed.synonyms ?? []) : [],
          note: i === 0 ? seed.note : undefined,
        }))
      : [];
    cells[k] = z === undefined ? { x, y, answers, status: "empty" } : { x, y, z, answers, status: "empty" };
  }
  return cells;
};

/** 2D 题：两条轴，values[x] 是列条件、values[y] 是行条件。棋盘边长由 rows/cols 的长度决定。 */
function build(
  title: string,
  description: string,
  rows: string[],
  cols: string[],
  seeds: Record<string, CellSeed>,
): GridDoc {
  const axes: Axis[] = [
    { label: "列条件", values: cols },
    { label: "行条件", values: rows },
  ];
  return {
    v: 2,
    id: "",
    title,
    description,
    axes,
    judgeMode: "answers",
    cells: cellsFor(axes, seeds),
    similarSearch: true,
    status: "unlisted",
    updatedAt: 0,
  };
}

/** 3D 题：三条轴各 3 个特质，27 格，开放造词 —— 玩家自己想答案，AI 判冷门度。 */
function build3D(title: string, description: string, axes: Axis[]): GridDoc {
  return {
    v: 2,
    id: "",
    title,
    description,
    axes,
    judgeMode: "open",
    cells: cellsFor(axes, {}),
    similarSearch: false,
    status: "unlisted",
    updatedAt: 0,
  };
}

export const SAMPLES: GridDoc[] = [
  build("入门 · 2×2", "四个格子，先熟悉一下行列交叉的玩法。", ["能吃", "不能吃"], ["圆", "方"], {
    "0,0": { answers: ["橙子", "西瓜"], aliases: ["橙"], note: "圆形的能吃的食物" },
    "1,0": { answers: ["三明治", "饼干"], aliases: ["三文治"] },
    "0,1": { answers: ["硬币", "盘子"] },
    "1,1": { answers: ["书", "手机"] },
  }),

  build(
    "日常物品 · 3×3",
    "每一格填一样同时满足该行与该列条件的日常物品。",
    ["能装进口袋", "需要用电", "会发出声音"],
    ["金属做的", "有屏幕", "比手掌大"],
    {
      "1,0": { answers: ["手机", "智能手表"], aliases: ["電話"], synonyms: ["移动电话"], note: "有屏幕又要用电的经典答案" },
      "0,0": { answers: ["钥匙", "硬币"] },
      "2,0": { answers: ["蓝牙音箱", "对讲机"] },
      "1,1": { answers: ["平板电脑", "电子书阅读器"] },
      "0,1": { answers: ["电水壶", "吹风机"] },
      "2,1": { answers: ["洗衣机", "吸尘器"] },
      "1,2": { answers: ["笔记本电脑"] },
      "0,2": { answers: ["铃铛", "口琴"] },
      "2,2": { answers: ["钢琴", "音响"] },
    },
  ),

  build(
    "生物图鉴 · 4×4",
    "横竖各四个条件，四条轴两两交叉出 16 个格子。",
    ["生活在水里", "会飞", "有毛", "有毒"],
    ["比猫小", "比人大", "能食用", "在夜间活动"],
    {
      "0,0": { answers: ["孔雀鱼", "小丑鱼"] },
      "1,0": { answers: ["蜂鸟", "蜻蜓"] },
      "2,0": { answers: ["水獭", "鸭嘴兽"] },
      "3,0": { answers: ["箱水母", "石头鱼"] },
      "1,1": { answers: ["信天翁", "秃鹫"] },
      "3,1": { answers: ["眼镜蛇", "蝎子"] },
      "0,2": { answers: ["三文鱼", "生蚝"] },
      "1,2": { answers: ["鹌鹑", "鸽子"] },
      "2,2": { answers: ["兔子", "山羊"] },
      "3,2": { answers: ["河豚"] },
      "0,3": { answers: ["章鱼", "乌贼"] },
      "1,3": { answers: ["猫头鹰", "蝙蝠"] },
      "2,3": { answers: ["刺猬", "狐狸"] },
      "3,3": { answers: ["蝎子", "蜈蚣"] },
    },
  ),

  build(
    "抽象概念 · 5×5",
    "25 格。抽象题的答案是概念而非实物，靠相似搜索的语义档会更好玩。",
    ["能用数字衡量", "需要两个人以上", "会随时间衰减", "让人上瘾", "无法被拥有"],
    ["看不见", "说不清", "能买卖", "会传染", "有上限"],
    {
      "0,0": { answers: ["时间", "温度"] },
      "3,0": { answers: ["习惯", "瘾"] },
      "4,1": { answers: ["爱", "信任"] },
      "0,2": { answers: ["货币", "股票"] },
      "2,2": { answers: ["记忆", "注意力"] },
      "1,3": { answers: ["谣言", "情绪"] },
      "3,3": { answers: ["快乐", "灵感"] },
      "4,4": { answers: ["自由", "可能性"] },
    },
  ),

  /* ---- 3D：开放造词，27 格无标准答案 ---- */
  build3D("三维 · 物理三轴", "27 格，每格填一样同时满足三项特质的任意事物。自己造答案，AI 判冷门度。", [
    { label: "尺寸", values: ["极小", "常规", "巨大"] },
    { label: "速度", values: ["静止", "中速", "极快"] },
    { label: "危险性", values: ["无害", "有风险", "致命"] },
  ]),

  build3D("三维 · 日常物品", "三条轴交叉出 27 格，答案越冷门分越低。", [
    { label: "价格", values: ["便宜", "中等", "昂贵"] },
    { label: "重量", values: ["很轻", "一般", "很重"] },
    { label: "常见度", values: ["随处可见", "偶尔见到", "几乎见不到"] },
  ]),
];

export const findSample = (title: string) => SAMPLES.find((s) => s.title === title);
