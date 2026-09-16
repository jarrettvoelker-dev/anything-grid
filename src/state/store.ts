import { create } from "zustand";
import {
  cellKey,
  type Cell,
  type CellAnswer,
  type Category,
  type GridDoc,
  type GridSize,
} from "../lib/types";
import { matchGuess, type SemanticResolver } from "../lib/match";
import {
  canRedo,
  canUndo,
  commit,
  initHistory,
  redo as histRedo,
  redoLabel,
  undo as histUndo,
  undoLabel,
  type History,
} from "../lib/history";

/* 单 store：文档、历史、选择、视口放一起。
   拆多个 store 会让"选择变了要同步文档"这类跨 store 依赖变成隐性 bug 温床。 */

let seq = 0;
const uid = (p: string) => `${p}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function emptyCell(x: number, y: number): Cell {
  return { x, y, answers: [], status: "empty" };
}

export function createDoc(size: GridSize = 3, title = "未命名题"): GridDoc {
  const mk = (i: number): Category => ({ label: `条件 ${i + 1}` });
  const cells: Record<string, Cell> = {};
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells[cellKey(x, y)] = emptyCell(x, y);
  return {
    v: 1,
    id: "",
    title,
    description: "",
    size,
    rows: Array.from({ length: size }, (_, i) => mk(i)),
    cols: Array.from({ length: size }, (_, i) => mk(i)),
    cells,
    similarSearch: true,
    status: "draft",
    updatedAt: 0,
  };
}

/** 改尺寸时保留仍在新范围内的格子内容，其余丢弃。 */
export function resizeDoc(doc: GridDoc, size: GridSize): GridDoc {
  const cells: Record<string, Cell> = {};
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const k = cellKey(x, y);
      cells[k] = doc.cells[k] ?? emptyCell(x, y);
    }
  }
  const grow = (arr: Category[], n: number, prefix: string): Category[] =>
    Array.from({ length: n }, (_, i) => arr[i] ?? { label: `${prefix} ${i + 1}` });
  return { ...doc, size, cells, rows: grow(doc.rows, size, "条件"), cols: grow(doc.cols, size, "条件") };
}

export type Viewport = { x: number; y: number; z: number };

type Store = {
  history: History<GridDoc>;
  /** 选中的格子 key 集合（多选） */
  selection: string[];
  /** 视口：世界坐标平移 + 缩放。不进历史 —— 平移缩放不该污染 Ctrl+Z */
  viewport: Viewport;
  /** 判定中的格子，UI 用来显示 searching 态 */
  judging: Record<string, boolean>;
  /** 最近一次操作提示 */
  toast: string | null;
  /** M3 注入；M1 为 undefined，语义档自动跳过 */
  resolver?: SemanticResolver;

  doc: () => GridDoc;
  setResolver: (r?: SemanticResolver) => void;
  notify: (msg: string | null) => void;

  /* 文档操作（全部走历史） */
  replaceDoc: (doc: GridDoc, label: string, coalesce?: boolean) => void;
  resetHistory: (doc: GridDoc) => void;
  newGrid: (size: GridSize) => void;
  setMeta: (patch: Partial<Pick<GridDoc, "title" | "description" | "status" | "similarSearch">>, label: string) => void;
  setSize: (size: GridSize) => void;
  setRowLabel: (i: number, label: string) => void;
  setColLabel: (i: number, label: string) => void;

  /* 答案编辑 */
  addAnswer: (x: number, y: number, text: string) => void;
  updateAnswer: (x: number, y: number, id: string, patch: Partial<CellAnswer>) => void;
  removeAnswer: (x: number, y: number, id: string) => void;

  /* 游玩 */
  submitGuess: (x: number, y: number, guess: string) => Promise<void>;
  autoFill: () => number;

  /* 选择与画布 */
  select: (keys: string[], additive?: boolean) => void;
  clearSelection: () => void;
  deleteSelected: () => void;
  moveSelected: (dx: number, dy: number) => void;
  setViewport: (v: Viewport) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  undoText: () => string | null;
  redoText: () => string | null;
};

export const useStore = create<Store>()((set, get) => ({
  history: initHistory(createDoc(3)),
  selection: [],
  viewport: { x: 0, y: 0, z: 1 },
  judging: {},
  toast: null,

  doc: () => get().history.present,
  setResolver: (r) => set({ resolver: r }),
  notify: (msg) => set({ toast: msg }),

  replaceDoc: (doc, label, coalesce) =>
    set((s) => ({
      history: commit(s.history, label, { ...doc, updatedAt: Date.now() }, Date.now(), { coalesce }),
    })),

  resetHistory: (doc) => set({ history: initHistory(doc), selection: [] }),

  newGrid: (size) => set({ history: initHistory(createDoc(size)), selection: [] }),

  setMeta: (patch, label) =>
    set((s) => ({
      history: commit(s.history, label, { ...s.history.present, ...patch, updatedAt: Date.now() }, Date.now(), {
        coalesce: label.includes("标题") || label.includes("描述"),
      }),
    })),

  setSize: (size) =>
    set((s) => ({
      history: commit(s.history, "改尺寸", resizeDoc(s.history.present, size), Date.now(), { coalesce: false }),
      selection: [],
    })),

  setRowLabel: (i, label) =>
    set((s) => {
      const rows = s.history.present.rows.map((c, n) => (n === i ? { ...c, label } : c));
      return {
        history: commit(s.history, "改行条件", { ...s.history.present, rows }, Date.now(), { coalesce: true }),
      };
    }),

  setColLabel: (i, label) =>
    set((s) => {
      const cols = s.history.present.cols.map((c, n) => (n === i ? { ...c, label } : c));
      return {
        history: commit(s.history, "改列条件", { ...s.history.present, cols }, Date.now(), { coalesce: true }),
      };
    }),

  addAnswer: (x, y, text) =>
    set((s) => {
      const d = s.history.present;
      const k = cellKey(x, y);
      const cell = d.cells[k] ?? emptyCell(x, y);
      const answer: CellAnswer = { id: uid("a"), text, aliases: [], synonyms: [] };
      const cells = { ...d.cells, [k]: { ...cell, answers: [...cell.answers, answer] } };
      return { history: commit(s.history, "加答案", { ...d, cells }, Date.now(), { coalesce: false }) };
    }),

  updateAnswer: (x, y, id, patch) =>
    set((s) => {
      const d = s.history.present;
      const k = cellKey(x, y);
      const cell = d.cells[k];
      if (!cell) return {};
      const answers = cell.answers.map((a) => (a.id === id ? { ...a, ...patch } : a));
      const cells = { ...d.cells, [k]: { ...cell, answers } };
      return { history: commit(s.history, "改答案", { ...d, cells }, Date.now(), { coalesce: true }) };
    }),

  removeAnswer: (x, y, id) =>
    set((s) => {
      const d = s.history.present;
      const k = cellKey(x, y);
      const cell = d.cells[k];
      if (!cell) return {};
      const answers = cell.answers.filter((a) => a.id !== id);
      const cells = { ...d.cells, [k]: { ...cell, answers } };
      return { history: commit(s.history, "删答案", { ...d, cells }, Date.now(), { coalesce: false }) };
    }),

  submitGuess: async (x, y, guess) => {
    const s = get();
    const d = s.history.present;
    const k = cellKey(x, y);
    const cell = d.cells[k];
    if (!cell) return;

    const text = guess.trim();
    if (!text) {
      const cells = { ...d.cells, [k]: { ...cell, status: "empty" as const, guess: undefined, confidence: undefined, reason: undefined } };
      get().replaceDoc({ ...d, cells }, "清空作答");
      return;
    }

    /* 先置 searching，让 UI 立刻有反馈 —— 语义档要等网络，不能干等着没动静 */
    set((st) => ({
      judging: { ...st.judging, [k]: true },
      history: commit(
        st.history,
        "作答",
        { ...d, cells: { ...d.cells, [k]: { ...cell, status: "searching", guess: text } } },
        Date.now(),
        { coalesce: false },
      ),
    }));

    let result;
    try {
      result = await matchGuess({
        guess: text,
        answers: cell.answers,
        row: d.rows[y] ?? { label: "" },
        col: d.cols[x] ?? { label: "" },
        similarEnabled: d.similarSearch,
        resolver: get().resolver,
      });
    } catch {
      result = { tier: "none" as const, confidence: 0, accepted: false, similar: false, reason: "判定出错" };
    }

    const cur = get().history.present;
    const curCell = cur.cells[k];
    const nextStatus = result.accepted ? "correct" : result.similar ? "similar" : "incorrect";
    const cells = {
      ...cur.cells,
      [k]: {
        ...curCell,
        status: nextStatus as Cell["status"],
        guess: text,
        confidence: result.confidence,
        reason: result.reason ?? (result.canonical ? `命中：${result.canonical.text}` : undefined),
      },
    };
    set((st) => ({
      judging: Object.fromEntries(Object.entries(st.judging).filter(([key]) => key !== k)),
      history: commit(st.history, "作答", { ...cur, cells }, Date.now(), { coalesce: false }),
    }));
  },

  /**
   * 自动填充：把玩家已经在别处答对的内容，补进同样接受它的空格。
   * 「不是万能匹配」的保证在于 —— 只认本格已录入的答案，且必须精确命中，
   * 走的是 matchGuess 的 exact 档，任何模糊/语义推断都不参与。
   */
  autoFill: () => {
    const s = get();
    const d = s.history.present;
    if (!d.similarSearch) return 0;
    const solved = Object.values(d.cells)
      .filter((c) => c.status === "correct" || c.status === "auto")
      .map((c) => c.guess ?? "")
      .filter(Boolean);
    if (!solved.length) return 0;

    const cells = { ...d.cells };
    let filled = 0;
    for (const cell of Object.values(d.cells)) {
      if (cell.answers.length === 0) continue;
      if (cell.status === "correct" || cell.status === "auto") continue;
      const hit = cell.answers.find((a) =>
        solved.some((g) => a.text.trim().toLowerCase() === g.trim().toLowerCase()),
      );
      if (hit) {
        cells[cellKey(cell.x, cell.y)] = { ...cell, status: "auto", guess: hit.text, reason: "与已填格子条件重合" };
        filled++;
      }
    }
    if (filled) get().replaceDoc({ ...d, cells }, `自动填充 ${filled} 格`, false);
    return filled;
  },

  select: (keys, additive) =>
    set((s) => {
      if (!additive) return { selection: keys };
      const set2 = new Set(s.selection);
      for (const k of keys) (set2.has(k) ? set2.delete(k) : set2.add(k));
      return { selection: [...set2] };
    }),

  clearSelection: () => set({ selection: [] }),

  deleteSelected: () =>
    set((s) => {
      if (!s.selection.length) return {};
      const d = s.history.present;
      const cells = { ...d.cells };
      for (const k of s.selection) {
        const c = cells[k];
        /* 删的是"这一格的作答"，不是题目的正确答案 —— 正确答案只能在创建器里删 */
        if (c) cells[k] = { ...c, status: "empty", guess: undefined, confidence: undefined, reason: undefined };
      }
      return {
        history: commit(s.history, "清空所选题", { ...d, cells }, Date.now(), { coalesce: false }),
        selection: [],
      };
    }),

  /* 拖动选中的格子，按格距吸附 —— 交换位置而不是自由漂移，保持棋盘结构 */
  moveSelected: (dx, dy) =>
    set((s) => {
      const d = s.history.present;
      const n = d.size;
      const move = (k: string): [number, number] | null => {
        const [x, y] = k.split(",").map(Number);
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) return null;
        return [nx, ny];
      };
      const targets = s.selection.map(move);
      if (targets.some((t) => t === null)) return { toast: "已经到边界了" };

      const cells = { ...d.cells };
      const moving = new Set(s.selection);
      /* 先把移动目标区的内容暂存，避免相互覆盖 */
      const stash: Record<string, Cell> = {};
      for (const k of moving) stash[k] = cells[k];
      for (const k of s.selection) cells[k] = { ...cells[k], status: "empty" };
      for (const k of s.selection) {
        const [nx, ny] = move(k)!;
        const nk = cellKey(nx, ny);
        cells[nk] = { ...(stash[k] ?? cells[nk]), x: nx, y: ny, status: "empty" };
      }
      const sel = s.selection.map((k) => {
        const [nx, ny] = move(k)!;
        return cellKey(nx, ny);
      });
      return {
        history: commit(s.history, "移动格子", { ...d, cells }, Date.now(), { coalesce: true }),
        selection: sel,
      };
    }),

  setViewport: (v) => set({ viewport: v }),

  undo: () => set((s) => ({ history: histUndo(s.history), selection: [] })),
  redo: () => set((s) => ({ history: histRedo(s.history), selection: [] })),
  canUndo: () => canUndo(get().history),
  canRedo: () => canRedo(get().history),
  undoText: () => undoLabel(get().history),
  redoText: () => redoLabel(get().history),
}));
