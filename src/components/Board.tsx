import { memo, useEffect, useRef, useState } from "react";
import { axisLen, cellKey, CELL_STATUS_LABEL, type Cell, type GridDoc } from "../lib/types";
import { useStore } from "../state/store";

/* 2D 棋盘本体，渲染在 CanvasPlane 的 world 层里。
   world 坐标 → 屏幕坐标由画布的 transform 统一负责，这里只管排版。
   3D 题走 Cube3D / Flat3D，不经过这里。 */

export const CELL_W = 152;
export const CELL_H = 106;
export const GAP = 12;
export const HEAD_W = 120;
export const HEAD_H = 64;

export const boardMetrics = (n: number) => ({
  w: HEAD_W + n * (CELL_W + GAP),
  h: HEAD_H + n * (CELL_H + GAP),
});

export const cellPos = (x: number, y: number) => ({
  left: HEAD_W + x * (CELL_W + GAP),
  top: HEAD_H + y * (CELL_H + GAP),
});

const STATUS_STYLE: Record<Cell["status"], string> = {
  empty: "border-dashed border-line-strong bg-white/[0.02] text-ink-faint",
  searching: "border-axis1/60 bg-axis1/[0.08] text-ink-dim animate-pulse-soft",
  correct: "border-ok/60 bg-ok/[0.14] text-ink shadow-[0_0_28px_-12px_rgb(52_211_153/0.6)]",
  incorrect: "border-bad/55 bg-bad/[0.12] text-ink-dim",
  similar: "border-warn/60 bg-warn/[0.12] text-ink-dim",
  auto: "border-axis1/45 bg-axis1/[0.10] text-ink-dim border-dashed",
  error: "border-line-strong bg-white/[0.03] text-ink-faint border-dotted",
};

const STATUS_DOT: Record<Cell["status"], string> = {
  empty: "",
  searching: "◌",
  correct: "✓",
  incorrect: "✕",
  similar: "≈",
  auto: "⚡",
  error: "!",
};

type Props = {
  doc: GridDoc;
  mode: "play" | "edit";
};

export const Board = memo(function Board({ doc, mode }: Props) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const submitGuess = useStore((s) => s.submitGuess);
  const moveSelected = useStore((s) => s.moveSelected);

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [drag, setDrag] = useState<{ dx: number; dy: number; keys: string[] } | null>(null);
  const dragRef = useRef<{ x: number; y: number; keys: string[]; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const n = axisLen(doc, 0);
  const { w, h } = boardMetrics(n);

  const beginEdit = (k: string) => {
    const cell = doc.cells[k];
    setDraft(cell?.guess ?? "");
    setEditing(k);
  };

  /* 输入法组合期间的 Enter 是"选词"不是"提交" —— 中文用户不处理这个会当场炸毛 */
  const commit = (k: string, e?: React.KeyboardEvent) => {
    if (e && (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
    void submitGuess(k, draft);
    setEditing(null);
  };

  const onCellPointerDown = (e: React.PointerEvent, k: string) => {
    if (mode !== "edit" || editing) return;
    e.stopPropagation();
    const nextSel = selection.includes(k) ? selection : [k];
    select(nextSel);
    dragRef.current = { x: e.clientX, y: e.clientY, keys: nextSel, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onCellPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const vp = useStore.getState().viewport;
    const strideX = CELL_W + GAP;
    const strideY = CELL_H + GAP;
    const dx = Math.round((e.clientX - d.x) / vp.z / strideX);
    const dy = Math.round((e.clientY - d.y) / vp.z / strideY);
    if (dx || dy) d.moved = true;
    setDrag({ dx, dy, keys: d.keys });
  };

  const onCellPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const g = drag;
    setDrag(null);
    if (!d || !g || !d.moved) return;
    if (g.dx || g.dy) moveSelected(g.dx, g.dy);
  };

  return (
    <div className="relative" style={{ width: w, height: h }}>
      {/* 列条件 —— axes[0] 的 values 与横坐标 x 一一对应 */}
      {doc.axes[0]?.values.map((label, x) => (
        <div
          key={`c${x}`}
          className="absolute flex flex-col justify-end pb-2 text-center"
          style={{ left: HEAD_W + x * (CELL_W + GAP), top: 0, width: CELL_W, height: HEAD_H }}
        >
          <div className="text-micro font-semibold uppercase tracking-wider text-axis1/70">列 {x + 1}</div>
          <div className="truncate text-small font-medium text-ink-dim" title={label}>
            {label}
          </div>
        </div>
      ))}

      {/* 行条件 */}
      {doc.axes[1]?.values.map((label, y) => (
        <div
          key={`r${y}`}
          className="absolute flex flex-col justify-center pr-3 text-right"
          style={{ left: 0, top: HEAD_H + y * (CELL_H + GAP), width: HEAD_W - GAP, height: CELL_H }}
        >
          <div className="text-micro font-semibold uppercase tracking-wider text-axis2/70">行 {y + 1}</div>
          <div className="line-clamp-2 text-small font-medium text-ink-dim" title={label}>
            {label}
          </div>
        </div>
      ))}

      {/* 格子 */}
      {Array.from({ length: n * n }, (_, idx) => {
        const x = idx % n;
        const y = Math.floor(idx / n);
        const k = cellKey(x, y);
        const cell = doc.cells[k];
        const { left, top } = cellPos(x, y);
        const isSel = selection.includes(k);
        const isDragging = drag?.keys.includes(k);
        const offset = isDragging && drag ? { dx: drag.dx, dy: drag.dy } : null;
        const status = cell?.status ?? "empty";

        return (
          <div
            key={k}
            data-cell={k}
            role="button"
            tabIndex={0}
            aria-label={`第 ${y + 1} 行第 ${x + 1} 列，${CELL_STATUS_LABEL[status]}`}
            className={`absolute flex flex-col rounded-card border p-3 transition-[background,border-color,box-shadow,transform] duration-200 ease-out ${STATUS_STYLE[status]} ${
              isSel ? "ring-2 ring-axis1 ring-offset-2 ring-offset-void" : ""
            } ${mode === "edit" ? "cursor-grab active:cursor-grabbing" : "cursor-text hover:border-line-strong hover:bg-white/[0.05]"}`}
            style={{
              left,
              top,
              width: CELL_W,
              height: CELL_H,
              zIndex: isDragging ? 20 : 1,
              transform: offset
                ? `translate3d(${offset.dx * (CELL_W + GAP)}px, ${offset.dy * (CELL_H + GAP)}px, 0) scale(1.03)`
                : undefined,
              opacity: isDragging ? 0.85 : 1,
            }}
            onPointerDown={(e) => onCellPointerDown(e, k)}
            onPointerMove={onCellPointerMove}
            onPointerUp={onCellPointerUp}
            onDoubleClick={() => mode === "play" && beginEdit(k)}
            onClick={() => {
              if (mode !== "play" || editing === k) return;
              if (cell?.answers.length) beginEdit(k);
            }}
            onKeyDown={(e) => {
              /* 只认格子自身获焦时的回车（键盘可访问性）。内部输入框的回车会冒泡上来，
                 若不排除，提交完会立刻被重新打开、答案文本被输入框盖住永远看不见。 */
              if (e.key === "Enter" && mode === "play" && e.target === e.currentTarget) beginEdit(k);
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-micro text-ink-faint">
                {y + 1}-{x + 1}
              </span>
              {status !== "empty" && (
                <span className="text-tiny font-semibold" aria-hidden>
                  {STATUS_DOT[status]}
                </span>
              )}
            </div>

            {editing === k ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => setEditing(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(k, e);
                  if (e.key === "Escape") setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                data-no-pan
                className="mt-1 w-full min-w-0 bg-transparent text-lead font-semibold text-ink outline-none placeholder:text-ink-faint"
                placeholder="输入答案…"
                autoComplete="off"
              />
            ) : (
              <div className="mt-1 line-clamp-2 text-lead font-semibold leading-snug">
                {cell?.guess || (mode === "edit" ? (cell?.answers[0]?.text ?? "未设答案") : "")}
              </div>
            )}

            <div className="mt-auto flex items-center gap-2 text-micro text-ink-faint">
              {status === "similar" && cell?.confidence != null && (
                <span className="text-warn">相近 {Math.round(cell.confidence * 100)}%</span>
              )}
              {mode === "edit" && (
                <span className="truncate">
                  {cell?.answers.length ?? 0} 个答案
                  {(cell?.answers.some((a) => a.aliases.length || a.synonyms.length) ?? false) && " · 有别名"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
