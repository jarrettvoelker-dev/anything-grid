/* ============================================================================
   撤销 / 重做
   采用**快照式**而不是命令式：一个 GridDoc 只有几 KB，快照比维护成对的
   undo/redo patch 简单得多，也不会出现"撤销后状态对不上"的经典 bug。

   带**合并（coalesce）**：连续同标签的操作（拖拽、连续输入）在 400ms 内
   只留一条历史，否则拖一次方块就会塞进上百条记录、Ctrl+Z 得按到手酸。
   ========================================================================== */

export type HistoryEntry<T> = {
  snapshot: T;
  label: string;
  at: number;
};

export type History<T> = {
  present: T;
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
};

export const COALESCE_MS = 400;
export const HISTORY_LIMIT = 80;

export function initHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] };
}

/**
 * 提交一次变更。
 * @param label 操作名（中文，会显示在"撤销：移动方块"这类提示里）
 * @param now   时间戳，由调用方注入以便测试
 */
export function commit<T>(
  h: History<T>,
  label: string,
  next: T,
  now: number,
  opts: { coalesce?: boolean; coalesceMs?: number; limit?: number } = {},
): History<T> {
  const coalesceMs = opts.coalesceMs ?? COALESCE_MS;
  const limit = opts.limit ?? HISTORY_LIMIT;
  const top = h.past[h.past.length - 1];

  /* 合并：上一条同标签且够近 —— 保留更早的那个快照（撤销要回到一串操作之前） */
  if (opts.coalesce !== false && top && top.label === label && now - top.at < coalesceMs) {
    return {
      present: next,
      past: [...h.past.slice(0, -1), { ...top, at: now }],
      future: [],
    };
  }

  const past = [...h.past, { snapshot: h.present, label, at: now }];
  return {
    present: next,
    past: past.length > limit ? past.slice(past.length - limit) : past,
    future: [],
  };
}

export function undo<T>(h: History<T>): History<T> {
  const top = h.past[h.past.length - 1];
  if (!top) return h;
  return {
    present: top.snapshot,
    past: h.past.slice(0, -1),
    future: [{ snapshot: h.present, label: top.label, at: top.at }, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  const top = h.future[0];
  if (!top) return h;
  return {
    present: top.snapshot,
    past: [...h.past, { snapshot: h.present, label: top.label, at: top.at }],
    future: h.future.slice(1),
  };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;
export const undoLabel = <T>(h: History<T>): string | null =>
  h.past.length ? h.past[h.past.length - 1].label : null;
export const redoLabel = <T>(h: History<T>): string | null =>
  h.future.length ? h.future[0].label : null;
