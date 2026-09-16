import { describe, expect, it, vi } from "vitest";
import { isJudgeReady, judgeEntry, parseJudgeResponse } from "./judge";

/* 模型回复的解析是这条链路上最脆的一段：外面可能裹 markdown 代码块、
   可能带寒暄、可能干脆不是 JSON。解析错了玩家会看到莫名其妙的判定。 */

describe("parseJudgeResponse", () => {
  it("解析裸 JSON", () => {
    expect(parseJudgeResponse('{"ok":true,"rarity":3,"reason":"符合"}')).toEqual({
      ok: true,
      rarity: 3,
      reason: "符合",
    });
  });

  it("解析被 ```json 代码块包裹的 JSON", () => {
    const r = parseJudgeResponse('```json\n{"ok":false,"rarity":8,"reason":"不符合"}\n```');
    expect(r.ok).toBe(false);
    expect(r.rarity).toBe(8);
  });

  it("解析前后带寒暄的 JSON", () => {
    const r = parseJudgeResponse('好的，我判断如下：\n{"ok":true,"rarity":0,"reason":"极冷门"}\n以上。');
    expect(r.ok).toBe(true);
    expect(r.rarity).toBe(0);
  });

  it("rarity 为 0 不能被当成缺失 —— 0 是最冷门，是有效值", () => {
    expect(parseJudgeResponse('{"ok":true,"rarity":0,"reason":""}').rarity).toBe(0);
  });

  it("缺字段时用 null 占位，而不是编造一个值", () => {
    const r = parseJudgeResponse('{"ok":true}');
    expect(r.ok).toBe(true);
    expect(r.rarity).toBeNull();
    expect(r.reason).toBe("");
  });

  it("ok 不是布尔值时判为不确定，不硬转成 true", () => {
    expect(parseJudgeResponse('{"ok":"yes","rarity":1}').ok).toBeNull();
  });

  it("rarity 是 NaN / 字符串时判为 null", () => {
    expect(parseJudgeResponse('{"ok":true,"rarity":"很冷门"}').rarity).toBeNull();
    expect(parseJudgeResponse('{"ok":true,"rarity":null}').rarity).toBeNull();
  });

  it("完全不是 JSON 时返回失败态，不抛异常", () => {
    const r = parseJudgeResponse("我不知道该怎么判断");
    expect(r.ok).toBeNull();
    expect(r.reason).toContain("判定失败");
  });

  it("空字符串不抛异常", () => {
    expect(parseJudgeResponse("").ok).toBeNull();
  });
});

describe("isJudgeReady", () => {
  it("三项齐全才算配好", () => {
    expect(isJudgeReady({ base: "https://x/v1", model: "m", key: "k" })).toBe(true);
    expect(isJudgeReady({ base: "", model: "m", key: "k" })).toBe(false);
    expect(isJudgeReady({ base: "https://x/v1", model: "", key: "k" })).toBe(false);
    expect(isJudgeReady({ base: "https://x/v1", model: "m", key: "" })).toBe(false);
  });
});

describe("judgeEntry", () => {
  const cfg = { base: "https://api.example.com/v1/", model: "m", key: "sk-test" };

  const mockFetch = (body: unknown, ok = true, status = 200) =>
    vi.fn().mockResolvedValue({
      ok,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as typeof fetch;

  it("拼出正确的 URL（去掉尾部斜杠）并带上 Bearer 头", async () => {
    const f = mockFetch({ choices: [{ message: { content: '{"ok":true,"rarity":2,"reason":"ok"}' } }] });
    await judgeEntry(cfg, "轴：A", "答案", f);
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer sk-test");
  });

  it("把特质组合与答案一起发给模型", async () => {
    const f = mockFetch({ choices: [{ message: { content: '{"ok":true,"rarity":1,"reason":""}' } }] });
    await judgeEntry(cfg, "尺寸：极小 ｜ 速度：静止", "蚂蚁", f);
    const body = JSON.parse((f as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string);
    expect(body.messages[1].content).toContain("尺寸：极小 ｜ 速度：静止");
    expect(body.messages[1].content).toContain("蚂蚁");
    expect(body.temperature).toBe(0);
  });

  it("未配置时直接返回失败态，不发请求", async () => {
    const f = mockFetch({});
    const r = await judgeEntry({ base: "", model: "", key: "" }, "轴", "答案", f);
    expect(r.ok).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("空格子不发请求 —— 别浪费玩家的 token", async () => {
    const f = mockFetch({});
    const r = await judgeEntry(cfg, "轴", "   ", f);
    expect(r.ok).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("HTTP 报错降级成失败态并带上状态码，不抛", async () => {
    const r = await judgeEntry(cfg, "轴", "答案", mockFetch({ error: "bad key" }, false, 401));
    expect(r.ok).toBeNull();
    expect(r.reason).toContain("401");
  });

  it("网络异常降级成失败态，不抛", async () => {
    const f = vi.fn().mockRejectedValue(new Error("Failed to fetch")) as unknown as typeof fetch;
    const r = await judgeEntry(cfg, "轴", "答案", f);
    expect(r.ok).toBeNull();
    expect(r.reason).toContain("Failed to fetch");
  });

  it("模型回复为空时不崩", async () => {
    const r = await judgeEntry(cfg, "轴", "答案", mockFetch({ choices: [] }));
    expect(r.ok).toBeNull();
  });
});
