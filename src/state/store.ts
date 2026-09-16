import { create } from "zustand";
import {
  AXIS_LEN_3D,
  allCoords,
  axisLen,
  cellKey,
  comboText,
  dimsOf,
  parseCellKey,
  type Axis,
  type Cell,
  type CellAnswer,
  type GridDoc,
  type GridSize,
  type JudgeMode,
} from "../lib/types";
import { matchGuess, type SemanticResolver } from "../lib/match";
import {
  isJudgeReady,
  judgeEntry,
  loadJudgeConfig,
  saveJudgeConfig,
  type JudgeConfig,
} from "../lib/judge";
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

export function emptyCell(x: number, y: number, z?: number): Cell {
  return z === undefined ? { x, y, answers: [], status: "empty" } : { x, y, z, answers: [], status: "empty" };
}

const mkAxis = (label: string, values: string[]): Axis => ({ label, values });

/** 2D 题：两条轴（列轴在前，下标对齐 x）。 */
export function createDoc2D(size: GridSize = 3, title = "未命名题"): GridDoc {
  return mkDoc(
    [
      mkAxis("列", Array.from({ length: size }, (_, i) => `条件 ${i + 1}`)),
      mkAxis("行", Array.from({ length: size }, (_, i) => `条件 ${i + 1}`)),
    ],
    "answers",
    title,
  );
}

/** 3D 题：三条轴，各 3 个特质。默认开放造词 —— 旧版 3D 的玩法。 */
export function createDoc3D(title = "未命名 3D 题", judgeMode: JudgeMode = "open"): GridDoc {
  return mkDoc(
    ["X", "Y", "Z"].map((n) => mkAxis(`轴 ${n}`, ["特质一", "特质二", "特质三"])),
    judgeMode,
    title,
  );
}

function mkDoc(axes: Axis[], judgeMode: JudgeMode, title: string): GridDoc {
  const doc: GridDoc = {
    v: 2,
    id: "",
    title,
    description: "",
    axes,
    judgeMode,
    cells: {},
    similarSearch: true,
    status: "draft",
    updatedAt: 0,
  };
  for (const [x, y, z] of allCoords(doc)) doc.cells[cellKey(x, y, z)] = emptyCell(x, y, z);
  return doc;
}

/** 按新轴的形状重排格子：能落到新范围内的保留，其余丢弃。轴名/特质尽量沿用。 */
export function reshape(doc: GridDoc, axes: Axis[], judgeMode?: JudgeMode): GridDoc {
  const next: GridDoc = { ...doc, axes, judgeMode: judgeMode ?? doc.judgeMode, cells: {} };
  /* 2D ↔ 3D 之间迁移时，把旧格子对齐到 z=0 层（2D 的 (x,y) 就是 3D 的第一层），
     这样「行列题升级成三轴题」不会把已经录好的答案全清掉。 */
  for (const [x, y, z] of allCoords(next)) {
    const k = cellKey(x, y, z);
    const prev =
      doc.cells[k] ??
      (z === 0 ? doc.cells[cellKey(x, y)] : undefined) ?? // 2D → 3D
      (z === undefined ? doc.cells[cellKey(x, y, 0)] : undefined); // 3D → 2D
    next.cells[k] = prev ? { x, y, z, answers: prev.answers, status: prev.status } : emptyCell(x, y, z);
  }
  return next;
}

/** 改 2D 题的边长，保留仍在新范围内的格子与条件。 */
export function resizeDoc(doc: GridDoc, size: GridSize): GridDoc {
  const grow = (ax: Axis, prefix: string): Axis => ({
    ...ax,
    values: Array.from({ length: size }, (_, i) => ax.values[i] ?? `${prefix} ${i + 1}`),
  });
  return reshape(doc, [grow(doc.axes[0], "条件"), grow(doc.axes[1], "条件")]);
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
  /** 开放模式的 AI 裁判配置（玩家 BYOK） */
  judgeConfig: JudgeConfig;

  doc: () => GridDoc;
  setResolver: (r?: SemanticResolver) => void;
  notify: (msg: string | null) => void;
  setJudgeConfig: (c: JudgeConfig) => void;

  /* 文档操作（全部走历史） */
  replaceDoc: (doc: GridDoc, label: string, coalesce?: boolean) => void;
  resetHistory: (doc: GridDoc) => void;
  newGrid: (dims: 2 | 3, size?: GridSize, judgeMode?: JudgeMode) => void;
  setMeta: (patch: Partial<Pick<GridDoc, "title" | "description" | "status" | "similarSearch" | "judgeMode">>, label: string) => void;
  setSize: (size: GridSize) => void;
  setDims: (dims: 2 | 3, judgeMode?: JudgeMode) => void;
  setAxisLabel: (axis: number, label: string) => void;
  setAxisValue: (axis: number, index: number, label: string) => void;

  /* 答案编辑 */
  addAnswer: (key: string, text: string) => void;
  updateAnswer: (key: string, id: string, patch: Partial<CellAnswer>) => void;
  removeAnswer: (key: string, id: string) => void;

  /* 游玩 */
  submitGuess: (key: string, guess: string) => Promise<void>;
  judgeCell: (key: string) => Promise<void>;
  judgeAll: () => Promise<number>;
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

/** 把 "x,y,z" 拆成坐标 —— store 里到处要用。 */
const coordsOf = (key: string) => parseCellKey(key);

export const useStore = create<Store>()((set, get) => ({
  history: initHistory(createDoc2D(3)),
  selection: [],
  viewport: { x: 0, y: 0, z: 1 },
  judging: {},
  toast: null,
  judgeConfig: loadJudgeConfig(),

  doc: () => get().history.present,
  setResolver: (r) => set({ resolver: r }),
  notify: (msg) => set({ toast: msg }),
  setJudgeConfig: (c) => {
    saveJudgeConfig(c);
    set({ judgeConfig: c });
  },

  replaceDoc: (doc, label, coalesce) =>
    set((s) => ({
      history: commit(s.history, label, { ...doc, updatedAt: Date.now() }, Date.now(), { coalesce }),
    })),

  resetHistory: (doc) => set({ history: initHistory(doc), selection: [] }),

  newGrid: (dims, size = 3, judgeMode) =>
    set({
      history: initHistory(
        dims === 3 ? createDoc3D("未命名 3D 题", judgeMode ?? "open") : createDoc2D(size, "未命名题"),
      ),
      selection: [],
    }),

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

  /* 2D ↔ 3D：轴长沿用（3×3 ↔ 3×3×3），旧格子对齐到 z=0 层保留 */
  setDims: (dims, judgeMode) =>
    set((s) => {
      const d = s.history.present;
      const len = dims === 3 ? AXIS_LEN_3D : Math.max(2, Math.min(5, axisLen(d, 0))) as GridSize;
      const axes: Axis[] = Array.from({ length: dims }, (_, n) => {
        const prev = d.axes[n];
        return {
          label: prev?.label ?? ["列", "行", "Z"][n],
          values: Array.from({ length: len }, (_, i) => prev?.values[i] ?? `特质 ${i + 1}`),
        };
      });
      const next = reshape(d, axes, judgeMode ?? (dims === 3 ? d.judgeMode : "answers"));
      return { history: commit(s.history, "改维度", next, Date.now(), { coalesce: false }), selection: [] };
    }),

  setAxisLabel: (axis, label) =>
    set((s) => {
      const axes = s.history.present.axes.map((a, n) => (n === axis ? { ...a, label } : a));
      return { history: commit(s.history, "改轴名", { ...s.history.present, axes }, Date.now(), { coalesce: true }) };
    }),

  setAxisValue: (axis, index, label) =>
    set((s) => {
      const axes = s.history.present.axes.map((a, n) =>
        n === axis ? { ...a, values: a.values.map((v, i) => (i === index ? label : v)) } : a,
      );
      return { history: commit(s.history, "改条件", { ...s.history.present, axes }, Date.now(), { coalesce: true }) };
    }),

  addAnswer: (key, text) =>
    set((s) => {
      const d = s.history.present;
      const [x, y, z] = coordsOf(key);
      const cell = d.cells[key] ?? emptyCell(x, y, z);
      const answer: CellAnswer = { id: uid("a"), text, aliases: [], synonyms: [] };
      const cells = { ...d.cells, [key]: { ...cell, answers: [...cell.answers, answer] } };
      return { history: commit(s.history, "加答案", { ...d, cells }, Date.now(), { coalesce: false }) };
    }),

  updateAnswer: (key, id, patch) =>
    set((s) => {
      const d = s.history.present;
      const cell = d.cells[key];
      if (!cell) return {};
      const answers = cell.answers.map((a) => (a.id === id ? { ...a, ...patch } : a));
      const cells = { ...d.cells, [key]: { ...cell, answers } };
      return { history: commit(s.history, "改答案", { ...d, cells }, Date.now(), { coalesce: true }) };
    }),

  removeAnswer: (key, id) =>
    set((s) => {
      const d = s.history.present;
      const cell = d.cells[key];
      if (!cell) return {};
      const answers = cell.answers.filter((a) => a.id !== id);
      const cells = { ...d.cells, [key]: { ...cell, answers } };
      return { history: commit(s.history, "删答案", { ...d, cells }, Date.now(), { coalesce: false }) };
    }),

  /**
   * 判定一次作答。两种模式在这里分岔：
   * - answers：走 match.ts 的流水线，答案就存在本格里，纯本地、确定性。
   * - open：走 AI 裁判，答案由玩家现造，题目本身没有标准答案。
   */
  submitGuess: async (key, guess) => {
    const s = get();
    const d = s.history.present;
    const cell = d.cells[key];
    if (!cell) return;

    const text = guess.trim();
    if (!text) {
      const cells = {
        ...d.cells,
        [key]: { ...cell, status: "empty" as const, guess: undefined, confidence: undefined, reason: undefined, ok: undefined, rarity: undefined },
      };
      get().replaceDoc({ ...d, cells }, "清空作答");
      return;
    }

    /* 先置 searching，让 UI 立刻有反馈 —— 语义档/AI 裁判要等网络，不能干等着没动静 */
    set((st) => ({
      judging: { ...st.judging, [key]: true },
      history: commit(
        st.history,
        "作答",
        { ...d, cells: { ...d.cells, [key]: { ...cell, status: "searching", guess: text } } },
        Date.now(),
        { coalesce: false },
      ),
    }));

    const [x, y, z] = coordsOf(key);
    let patch: Partial<Cell>;

    if (d.judgeMode === "open") {
      const cfg = get().judgeConfig;
      if (!isJudgeReady(cfg)) {
        patch = { status: "error", reason: "未配置 AI 裁判，去「AI 裁判」里填接口", ok: null };
      } else {
        const r = await judgeEntry(cfg, comboText(d, [x, y, z]), text);
        patch =
          r.ok === null
            ? { status: "error", reason: r.reason, ok: null, rarity: null }
            : { status: r.ok ? "correct" : "incorrect", ok: r.ok, rarity: r.rarity, reason: r.reason };
      }
    } else {
      let result;
      try {
        result = await matchGuess({
          guess: text,
          answers: cell.answers,
          row: { label: comboText(d, [x, y, z]) },
          col: { label: "" },
          similarEnabled: d.similarSearch,
          resolver: get().resolver,
        });
      } catch {
        result = { tier: "none" as const, confidence: 0, accepted: false, similar: false, reason: "判定出错" };
      }
      patch = {
        status: result.accepted ? "correct" : result.similar ? "similar" : "incorrect",
        confidence: result.confidence,
        reason: result.reason ?? (result.canonical ? `命中：${result.canonical.text}` : undefined),
      };
    }

    /* 异步回来时文档可能已经变了（玩家又改了别的格、或撤销了），按当前值合并 */
    const cur = get().history.present;
    const curCell = cur.cells[key] ?? cell;
    const cells = { ...cur.cells, [key]: { ...curCell, guess: text, ...patch } };
    set((st) => ({
      judging: Object.fromEntries(Object.entries(st.judging).filter(([k]) => k !== key)),
      history: commit(st.history, "作答", { ...cur, cells }, Date.now(), { coalesce: false }),
    }));
  },

  /** 单独重判一格（开放模式）。 */
  judgeCell: async (key) => {
    const d = get().history.present;
    const cell = d.cells[key];
    if (!cell?.guess) return;
    await get().submitGuess(key, cell.guess);
  },

  /** 批量重判所有已填的格子。逐格串行 —— 并发打模型容易被限流。 */
  judgeAll: async () => {
    const d = get().history.present;
    if (d.judgeMode !== "open") return 0;
    const keys = allCoords(d)
      .map(([x, y, z]) => cellKey(x, y, z))
      .filter((k) => d.cells[k]?.guess);
    for (const k of keys) await get().submitGuess(k, d.cells[k].guess!);
    return keys.length;
  },

  /**
   * 自动填充：把玩家已经在别处答对的内容，补进同样接受它的空格。
   * 「不是万能匹配」的保证在于 —— 只认本格已录入的答案，且必须精确命中，
   * 走的是 matchGuess 的 exact 档，任何模糊/语义推断都不参与。
   * 开放模式没有标准答案可比对，因此只在预设答案模式下有意义。
   */
  autoFill: () => {
    const s = get();
    const d = s.history.present;
    if (d.judgeMode !== "answers") return 0;
    if (!d.similarSearch) return 0;
    const solved = Object.values(d.cells)
      .filter((c) => c.status === "correct" || c.status === "auto")
      .map((c) => c.guess ?? "")
      .filter(Boolean);
    if (!solved.length) return 0;

    const cells = { ...d.cells };
    let filled = 0;
    for (const [x, y, z] of allCoords(d)) {
      const k = cellKey(x, y, z);
      const cell = d.cells[k];
      if (!cell || cell.answers.length === 0) continue;
      if (cell.status === "correct" || cell.status === "auto") continue;
      const hit = cell.answers.find((a) =>
        solved.some((g) => a.text.trim().toLowerCase() === g.trim().toLowerCase()),
      );
      if (hit) {
        cells[k] = { ...cell, status: "auto", guess: hit.text, reason: "与已填格子条件重合" };
        filled++;
      }
    }
    if (filled) get().replaceDoc({ ...d, cells }, `自动填充 ${filled} 格`, false);
    return filled;
  },

  select: (keys, additive) =>
    set((s) => {
      if (!additive) return { selection: keys };
      const next = new Set(s.selection);
      for (const k of keys) (next.has(k) ? next.delete(k) : next.add(k));
      return { selection: [...next] };
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
        if (c) cells[k] = { ...c, status: "empty", guess: undefined, confidence: undefined, reason: undefined, ok: undefined, rarity: undefined };
      }
      return {
        history: commit(s.history, "清空所选题", { ...d, cells }, Date.now(), { coalesce: false }),
        selection: [],
      };
    }),

  /* 拖动选中的格子，按格距吸附 —— 交换位置而不是自由漂移，保持棋盘结构。
     3D 题只沿 X/Y 平面移动，层（z）不动。 */
  moveSelected: (dx, dy) =>
    set((s) => {
      const d = s.history.present;
      const nx = axisLen(d, 0);
      const ny = axisLen(d, 1);
      const move = (k: string): [number, number, number?] | null => {
        const [x, y, z] = coordsOf(k);
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= nx || ty >= ny) return null;
        return z === undefined ? [tx, ty] : [tx, ty, z];
      };
      const targets = s.selection.map(move);
      if (targets.some((t) => t === null)) return { toast: "已经到边界了" };

      const cells = { ...d.cells };
      const stash: Record<string, Cell> = {};
      for (const k of s.selection) stash[k] = cells[k];
      for (const k of s.selection) cells[k] = { ...cells[k], status: "empty" };
      for (const k of s.selection) {
        const [tx, ty, tz] = move(k)!;
        const nk = cellKey(tx, ty, tz);
        cells[nk] = { ...(stash[k] ?? cells[nk]), x: tx, y: ty, z: tz, status: "empty" };
      }
      return {
        history: commit(s.history, "移动格子", { ...d, cells }, Date.now(), { coalesce: true }),
        selection: s.selection.map((k) => cellKey(...(move(k)! as [number, number]))),
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

export const dimsOfDoc = dimsOf;
