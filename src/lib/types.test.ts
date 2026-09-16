import { describe, expect, it } from "vitest";
import {
  allCoords,
  cellCount,
  cellKey,
  comboText,
  dimsOf,
  migrateV1,
  parseCellKey,
  sizeOf,
  type GridDoc,
} from "./types";

/* v1 存档迁移是这次模型升级里最危险的一步：
   用户 localStorage 里躺着的旧文档一旦读不出来 = 作品全没。
   所以这里把「旧存档能完整还原」当作硬约束来测。 */

const v1Sample = {
  v: 1,
  id: "abc123",
  title: "入门 · 2×2",
  description: "四个格子",
  size: 2,
  rows: [{ label: "能吃" }, { label: "不能吃" }],
  cols: [{ label: "圆" }, { label: "方" }],
  cells: {
    "0,0": { x: 0, y: 0, answers: [{ id: "a1", text: "橙子", aliases: ["橙"], synonyms: [] }], status: "empty" },
    "1,0": { x: 1, y: 0, answers: [{ id: "a2", text: "三明治", aliases: [], synonyms: [] }], status: "correct", guess: "三明治" },
  },
  similarSearch: false,
  status: "unlisted",
  updatedAt: 1234,
};

describe("migrateV1", () => {
  it("把 v1 文档升到 v2，轴与格子都不丢", () => {
    const d = migrateV1(v1Sample)!;
    expect(d.v).toBe(2);
    expect(d.id).toBe("abc123");
    expect(d.title).toBe("入门 · 2×2");
    expect(d.judgeMode).toBe("answers");
    expect(d.similarSearch).toBe(false);
    expect(d.status).toBe("unlisted");
    expect(d.updatedAt).toBe(1234);
    expect(d.axes).toHaveLength(2);
  });

  it("轴的下标语义必须对齐坐标：axes[0] 是列（对应 x），axes[1] 是行（对应 y）", () => {
    const d = migrateV1(v1Sample)!;
    expect(d.axes[0].values).toEqual(["圆", "方"]);
    expect(d.axes[1].values).toEqual(["能吃", "不能吃"]);
    /* (1,0) 应该落在「方 × 能吃」上 —— 顺序搞反了这里就红 */
    expect(d.axes[0].values[1]).toBe("方");
    expect(d.axes[1].values[0]).toBe("能吃");
  });

  it("保留格子里的答案与作答状态", () => {
    const d = migrateV1(v1Sample)!;
    expect(d.cells["0,0"].answers[0].text).toBe("橙子");
    expect(d.cells["0,0"].answers[0].aliases).toEqual(["橙"]);
    expect(d.cells["1,0"].status).toBe("correct");
    expect(d.cells["1,0"].guess).toBe("三明治");
  });

  it("v1 缺格的文档补出完整的 size×size 个格子", () => {
    const d = migrateV1({ ...v1Sample, cells: {} })!;
    expect(Object.keys(d.cells)).toHaveLength(4);
    expect(d.cells["1,1"]).toMatchObject({ x: 1, y: 1, status: "empty", answers: [] });
  });

  it("rows/cols 被裁短时按 size 补齐，不产生 undefined 的轴值", () => {
    const d = migrateV1({ ...v1Sample, size: 4, rows: [{ label: "只有一行" }], cols: [] })!;
    expect(d.axes[0].values).toHaveLength(4);
    expect(d.axes[1].values).toHaveLength(4);
    expect(d.axes[1].values[0]).toBe("只有一行");
    expect(d.axes[1].values[3]).toBe("条件 4");
    expect(d.axes[0].values.every((v) => typeof v === "string" && v.length > 0)).toBe(true);
  });

  it("size 越界时夹到 2..5，不生成畸形棋盘", () => {
    expect(sizeOf(migrateV1({ ...v1Sample, size: 99 })!)).toBe(5);
    expect(sizeOf(migrateV1({ ...v1Sample, size: 0 })!)).toBe(2);
  });

  it("已经是 v2 的文档原样通过", () => {
    const v2: GridDoc = {
      v: 2,
      id: "xyz",
      title: "三维题",
      description: "",
      axes: [
        { label: "X", values: ["a", "b", "c"] },
        { label: "Y", values: ["d", "e", "f"] },
        { label: "Z", values: ["g", "h", "i"] },
      ],
      judgeMode: "open",
      cells: {},
      similarSearch: true,
      status: "draft",
      updatedAt: 9,
    };
    expect(migrateV1(v2)).toEqual(v2);
  });

  it("认不出来的东西返回 null，不抛异常", () => {
    expect(migrateV1(null)).toBeNull();
    expect(migrateV1(undefined)).toBeNull();
    expect(migrateV1("字符串")).toBeNull();
    expect(migrateV1(42)).toBeNull();
    expect(migrateV1({})).toBeNull();
    expect(migrateV1({ v: 3, axes: [] })).toBeNull();
    /* v2 但轴不够两条 —— 半截存档也该被挡住 */
    expect(migrateV1({ v: 2, axes: [{ label: "x", values: ["a"] }] })).toBeNull();
  });
});

describe("cellKey / parseCellKey", () => {
  it("二维与三维的 key 互不混淆", () => {
    expect(cellKey(1, 2)).toBe("1,2");
    expect(cellKey(1, 2, 0)).toBe("1,2,0");
    expect(parseCellKey("1,2")).toEqual([1, 2]);
    expect(parseCellKey("1,2,0")).toEqual([1, 2, 0]);
  });

  it("往返一致", () => {
    for (const c of [[0, 0], [2, 1], [0, 2, 1]] as [number, number, number?][]) {
      expect(parseCellKey(cellKey(c[0], c[1], c[2]))).toEqual(c);
    }
  });
});

describe("维度与格子枚举", () => {
  const mk = (axisLens: number[]): GridDoc => ({
    v: 2,
    id: "t",
    title: "t",
    description: "",
    axes: axisLens.map((n, i) => ({
      label: `轴${i}`,
      values: Array.from({ length: n }, (_, j) => `v${j}`),
    })),
    judgeMode: "answers",
    cells: {},
    similarSearch: true,
    status: "draft",
    updatedAt: 0,
  });

  it("2D 题的格子数是边长平方，维度是 2", () => {
    const d = mk([3, 3]);
    expect(dimsOf(d)).toBe(2);
    expect(sizeOf(d)).toBe(3);
    expect(cellCount(d)).toBe(9);
    expect(allCoords(d)).toHaveLength(9);
  });

  it("3D 题是 27 格，维度是 3", () => {
    const d = mk([3, 3, 3]);
    expect(dimsOf(d)).toBe(3);
    expect(cellCount(d)).toBe(27);
    expect(allCoords(d)).toHaveLength(27);
  });

  it("3D 枚举顺序与旧版编号一致（z 最外层，x 最内层）", () => {
    const d = mk([3, 3, 3]);
    const coords = allCoords(d);
    expect(coords[0]).toEqual([0, 0, 0]);
    expect(coords[1]).toEqual([1, 0, 0]);
    expect(coords[2]).toEqual([2, 0, 0]);
    expect(coords[9]).toEqual([0, 0, 1]);
    expect(coords[26]).toEqual([2, 2, 2]);
  });

  it("2D 题绝不会枚举出带 z 的格子", () => {
    expect(allCoords(mk([2, 2])).every((c) => c.length === 2)).toBe(true);
  });

  it("comboText 把各轴特质地拼成一句话，缺下标时退到第一个值", () => {
    const d = mk([3, 3, 3]);
    expect(comboText(d, [1, 2, 0])).toBe("轴0：v1 ｜ 轴1：v2 ｜ 轴2：v0");
    expect(comboText(d, [1, undefined, 0])).toBe("轴0：v1 ｜ 轴1：v0 ｜ 轴2：v0");
  });
});
