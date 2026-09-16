import { describe, expect, it } from "vitest";
import { matchGuess, normalize, similarity, SEMANTIC_ACCEPT, THRESHOLDS, type SemanticResolver } from "./match";
import type { CellAnswer } from "./types";

const row = { label: "能玩" };
const col = { label: "方块" };

const answers: CellAnswer[] = [
  { id: "a1", text: "Minecraft", aliases: ["MC", "麦块"], synonyms: ["我的世界"] },
  { id: "a2", text: "俄罗斯方块", aliases: ["Tetris"], synonyms: [] },
];

const base = { answers, row, col };

describe("normalize", () => {
  it("忽略大小写、空白与标点，并把全角折成半角", () => {
    expect(normalize("  Hello, World!  ")).toBe("helloworld");
    expect(normalize("ＭＣ")).toBe("mc");
    expect(normalize("mine craft")).toBe("minecraft");
    expect(normalize("俄 罗 斯 · 方块")).toBe("俄罗斯方块");
  });
});

describe("similarity", () => {
  it("完全相同为 1，完全不同为 0", () => {
    expect(similarity("abc", "abc")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });
  it("允许一个字符的编辑距离换取接近 1 的相似度", () => {
    expect(similarity("minecraft", "minecraf")).toBeGreaterThan(0.85);
  });
});

describe("严格模式（关闭相似搜索）", () => {
  it("只认精确匹配", async () => {
    const r = await matchGuess({ ...base, guess: "Minecraft", similarEnabled: false });
    expect(r.tier).toBe("exact");
    expect(r.accepted).toBe(true);
  });

  it("别名在同义词在严格模式下都不算对", async () => {
    for (const g of ["MC", "我的世界", "mc"]) {
      const r = await matchGuess({ ...base, guess: g, similarEnabled: false });
      expect(r.accepted).toBe(false);
      expect(r.tier).toBe("none");
    }
  });

  it("大小写与空格差异仍算精确（归一化之后相等）", async () => {
    const r = await matchGuess({ ...base, guess: "  mine craft ", similarEnabled: false });
    expect(r.accepted).toBe(true);
    expect(r.canonical?.text).toBe("Minecraft");
  });
});

describe("相似搜索流水线", () => {
  it("Exact → 置信度 1", async () => {
    const r = await matchGuess({ ...base, guess: "俄罗斯方块", similarEnabled: true });
    expect(r.tier).toBe("exact");
    expect(r.confidence).toBe(1);
    expect(r.accepted).toBe(true);
  });

  it("Alias → 接受，置信度低于精确", async () => {
    const r = await matchGuess({ ...base, guess: "MC", similarEnabled: true });
    expect(r.tier).toBe("alias");
    expect(r.accepted).toBe(true);
    expect(r.confidence).toBeLessThan(1);
    expect(r.canonical?.text).toBe("Minecraft");
  });

  it("Synonym → 接受", async () => {
    const r = await matchGuess({ ...base, guess: "我的世界", similarEnabled: true });
    expect(r.tier).toBe("synonym");
    expect(r.accepted).toBe(true);
  });

  it("拼写接近但不等 → 只提示「接近」，绝不判对", async () => {
    const r = await matchGuess({ ...base, guess: "Minecraf", similarEnabled: true });
    expect(r.accepted).toBe(false);
    expect(r.similar).toBe(true);
    expect(r.confidence).toBeGreaterThanOrEqual(THRESHOLDS.similar);
    expect(r.confidence).toBeLessThan(THRESHOLDS.accept);
  });

  it("毫不相干 → 既不接受也不提示接近", async () => {
    const r = await matchGuess({ ...base, guess: "香蕉", similarEnabled: true });
    expect(r.accepted).toBe(false);
    expect(r.similar).toBe(false);
  });

  it("空答案不通过", async () => {
    const r = await matchGuess({ ...base, guess: "   ", similarEnabled: true });
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain("空");
  });

  it("本题一个答案都没录入时，任何猜测都不通过", async () => {
    const r = await matchGuess({ ...base, answers: [], guess: "随便", similarEnabled: true });
    expect(r.accepted).toBe(false);
    expect(r.reason).toContain("未录入");
  });
});

describe("语义档（M3 由服务端 BYOK 注入）", () => {
  const resolverReturning = (payload: { match?: string; confidence: number } | null): SemanticResolver =>
    async () => payload;

  it("未注入 resolver 时语义档整档跳过，不会凭空判对", async () => {
    const r = await matchGuess({ ...base, guess: "麦块游戏", similarEnabled: true });
    expect(r.tier).toBe("none");
    expect(r.accepted).toBe(false);
  });

  it("语义命中且置信度过阈值 → 接受", async () => {
    const r = await matchGuess({
      ...base,
      guess: "那个方块游戏",
      similarEnabled: true,
      resolver: resolverReturning({ match: "Minecraft", confidence: 0.9 }),
    });
    expect(r.tier).toBe("semantic");
    expect(r.accepted).toBe(true);
    expect(r.canonical?.text).toBe("Minecraft");
  });

  it("Category Validation：语义给出本格未录入的答案 → 一律不接受", async () => {
    const r = await matchGuess({
      ...base,
      guess: "泰拉瑞亚",
      similarEnabled: true,
      resolver: resolverReturning({ match: "泰拉瑞亚", confidence: 0.99 }),
    });
    expect(r.accepted).toBe(false);
    expect(r.canonical).toBeUndefined();
  });

  it("置信度低于语义阈值 → 不判对，可能只提示接近", async () => {
    const r = await matchGuess({
      ...base,
      guess: "那个方块游戏",
      similarEnabled: true,
      resolver: resolverReturning({ match: "Minecraft", confidence: SEMANTIC_ACCEPT - 0.05 }),
    });
    expect(r.accepted).toBe(false);
    expect(r.tier).toBe("semantic");
  });

  it("resolver 抛异常时静默降级，不影响本局继续玩", async () => {
    const boom: SemanticResolver = async () => {
      throw new Error("网关 502");
    };
    const r = await matchGuess({ ...base, guess: "俄罗斯方块", similarEnabled: true, resolver: boom });
    expect(r.accepted).toBe(true); // 精确档在语义档之前就已命中
    const r2 = await matchGuess({ ...base, guess: "香蕉", similarEnabled: true, resolver: boom });
    expect(r2.accepted).toBe(false);
    expect(r2.reason).not.toContain("网关"); // 不把底层错误抛给玩家
  });
});
