import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, initHistory, redo, undo, undoLabel, HISTORY_LIMIT } from "./history";

const T0 = 1_700_000_000_000;

describe("撤销栈", () => {
  it("提交后可以撤销回上一状态，重做回到新状态", () => {
    let h = initHistory("a");
    h = commit(h, "改标题", "b", T0);
    expect(h.present).toBe("b");
    expect(canUndo(h)).toBe(true);

    h = undo(h);
    expect(h.present).toBe("a");
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(h.present).toBe("b");
  });

  it("空白历史里撤销/重做是安全的空操作", () => {
    const h = initHistory("a");
    expect(undo(h).present).toBe("a");
    expect(redo(h).present).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("撤销后产生新分支，重做栈被清空", () => {
    let h = initHistory("a");
    h = commit(h, "x", "b", T0);
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, "y", "c", T0 + 5000);
    expect(canRedo(h)).toBe(false);
  });

  it("同一标签在合并窗口内只留一条记录", () => {
    let h = initHistory("a");
    for (let i = 1; i <= 10; i++) h = commit(h, "改标题", `v${i}`, T0 + i * 30);
    expect(h.past.length).toBe(1);
    /* 撤销要回到这一串连续输入之前，而不是回到上一次击键 */
    expect(undo(h).present).toBe("a");
  });

  it("超过合并窗口后另起一条记录", () => {
    let h = initHistory("a");
    h = commit(h, "改标题", "b", T0);
    h = commit(h, "改标题", "c", T0 + 5000);
    expect(h.past.length).toBe(2);
    expect(undo(h).present).toBe("b");
  });

  it("标签不同不合并", () => {
    let h = initHistory("a");
    h = commit(h, "改标题", "b", T0);
    h = commit(h, "改描述", "c", T0 + 10);
    expect(h.past.length).toBe(2);
  });

  it("显式关闭合并时，连续同标签也各自成条", () => {
    let h = initHistory("a");
    h = commit(h, "拖拽", "b", T0, { coalesce: false });
    h = commit(h, "拖拽", "c", T0 + 10, { coalesce: false });
    expect(h.past.length).toBe(2);
  });

  it("历史长度有上限，不会无限增长", () => {
    let h = initHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 40; i++) h = commit(h, `op${i}`, i, T0 + i * 1000, { coalesce: false });
    expect(h.past.length).toBe(HISTORY_LIMIT);
    /* 保留的是最近的记录 */
    expect(h.past[h.past.length - 1].label).toBe(`op${HISTORY_LIMIT + 40}`);
  });

  it("撤销标签可用于提示文案", () => {
    let h = initHistory("a");
    h = commit(h, "移动格子", "b", T0);
    expect(undoLabel(h)).toBe("移动格子");
    expect(undoLabel(initHistory("a"))).toBeNull();
  });
});
