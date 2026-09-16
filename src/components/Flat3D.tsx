import { memo, useEffect, useRef, useState } from "react";
import { cellKey, CELL_STATUS_LABEL, type Cell, type GridDoc } from "../lib/types";
import { useStore } from "../state/store";

/* 3D 题的**平面层视图**：把立方体沿 Z 轴切成 3 张 3×3 的棋盘，一次看一张。
   这是「同一道题两种视图」的另一半 —— 转不明白立方体的人用这个。
   布局与状态色沿用 2D 棋盘那一套，玩家两种视图之间不用重新学。 */

const STATUS_STYLE: Record<Cell["status"], string> = {
  empty: "border-dashed border-line-strong bg-white/[0.02] text-ink-faint",
  searching: "border-axis1/60 bg-axis1/[0.08] text-ink-dim animate-pulse-soft",
  correct: "border-ok/60 bg-ok/[0.14] text-ink shadow-[0_0_24px_-12px_rgb(52_211_153/0.6)]",
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

/** 三层各自的强调色，与立方体视图配色一致 —— 两边的"第 N 层"必须看起来是同一层。
    用的是设计系统里 axis1/2/3 那三个轴线色，不另起一套。 */
export const LAYER_DOT = ["bg-axis1", "bg-axis2", "bg-axis3"];

/** 层色对应的特质小标（图例里用）。 */
const LAYER_CHIP = ["bg-axis1/20 text-axis1", "bg-axis2/20 text-axis2", "bg-axis3/20 text-axis3"];

/**
 * 三条轴的图例。立方体视图里方块只有颜色没有文字，玩家看不出"这题在问什么" ——
 * 必须有个地方把轴名与特质摆出来。
 *
 * 配色只对 **Z 轴（层）** 上色，因为立方体上的颜色含义就是"第几层"，
 * 别的轴跟着上色会让同一个颜色有两种意思，反而更乱。
 */
export function AxisLegend({ doc }: { doc: GridDoc }) {
  return (
    <div className="glass max-w-[min(460px,66vw)] rounded-card px-2.5 py-2">
      {doc.axes.map((ax, n) => (
        <div key={n} className="flex items-baseline gap-2 py-0.5 text-micro">
          <span className="shrink-0 font-medium text-ink-dim">{ax.label}</span>
          <span className="flex min-w-0 flex-wrap gap-1">
            {ax.values.map((v, i) => (
              <span
                key={i}
                className={`max-w-[12ch] truncate rounded-md px-1.5 py-px ${
                  n === 2 ? (LAYER_CHIP[i] ?? "bg-white/[0.06] text-ink-faint") : "bg-white/[0.06] text-ink-faint"
                }`}
                title={v}
              >
                {v}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

type Props = {
  doc: GridDoc;
  mode: "play" | "edit";
  /** 受控的当前层；不传则自身维护 */
  layer?: number;
  onLayerChange?: (z: number) => void;
};

export const Flat3D = memo(function Flat3D({ doc, mode, layer, onLayerChange }: Props) {
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const submitGuess = useStore((s) => s.submitGuess);

  const [innerLayer, setInnerLayer] = useState(0);
  const z = layer ?? innerLayer;
  const setZ = (n: number) => (onLayerChange ? onLayerChange(n) : setInnerLayer(n));

  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const [axisX, axisY, axisZ] = doc.axes;
  const safeZ = Math.min(z, axisZ.values.length - 1);

  const beginEdit = (k: string) => {
    setDraft(doc.cells[k]?.guess ?? "");
    setEditing(k);
  };

  /* 输入法组合期间的 Enter 是"选词"不是"提交" */
  const commit = (k: string, e?: React.KeyboardEvent) => {
    if (e && (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
    void submitGuess(k, draft);
    setEditing(null);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 层切换 */}
      <div className="flex gap-1.5">
        {axisZ.values.map((label, n) => (
          <button
            key={n}
            data-layer={n}
            onClick={() => setZ(n)}
            className={`flex-1 rounded-xl border px-2 py-1.5 text-center transition ${
              n === safeZ ? "border-line-strong bg-white/[0.1] font-semibold text-ink" : "border-line bg-white/[0.03] text-ink-dim hover:bg-white/[0.07]"
            }`}
            aria-pressed={n === safeZ}
          >
            <span className="flex items-center justify-center gap-1.5 text-micro text-ink-faint">
              <span className={`h-2 w-2 rounded-sm ${LAYER_DOT[n] ?? "bg-white/40"}`} />
              第 {n + 1} 层
            </span>
            <span className="mt-0.5 block truncate text-small">{label}</span>
          </button>
        ))}
      </div>

      <div className="text-micro text-ink-faint">
        {axisZ.label}：<span className="text-ink-dim">{axisZ.values[safeZ]}</span>
        <span className="mx-2 text-ink-faint/50">·</span>
        另外两层在别的页签里
      </div>

      {/* 3×3 棋盘 */}
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `76px repeat(${axisX.values.length}, minmax(0, 1fr))` }}
      >
        <div />
        {axisX.values.map((label, x) => (
          <div key={`h${x}`} className="flex flex-col justify-end pb-1 text-center">
            <span className="text-micro font-semibold uppercase tracking-wider text-axis1/70">X{x + 1}</span>
            <span className="truncate text-micro text-ink-dim" title={label}>
              {label}
            </span>
          </div>
        ))}

        {axisY.values.map((rowLabel, y) => (
          <FragmentRow
            key={`r${y}`}
            doc={doc}
            mode={mode}
            y={y}
            z={safeZ}
            rowLabel={rowLabel}
            selection={selection}
            select={select}
            editing={editing}
            draft={draft}
            setDraft={setDraft}
            inputRef={inputRef}
            beginEdit={beginEdit}
            commit={commit}
            setEditing={setEditing}
          />
        ))}
      </div>
    </div>
  );
});

/* 一行 = 行标签 + 各列格子。抽出来只为让上面的 JSX 不至于深到看不清层级。 */
function FragmentRow({
  doc,
  mode,
  y,
  z,
  rowLabel,
  selection,
  select,
  editing,
  draft,
  setDraft,
  inputRef,
  beginEdit,
  commit,
  setEditing,
}: {
  doc: GridDoc;
  mode: "play" | "edit";
  y: number;
  z: number;
  rowLabel: string;
  selection: string[];
  select: (keys: string[], additive?: boolean) => void;
  editing: string | null;
  draft: string;
  setDraft: (s: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  beginEdit: (k: string) => void;
  commit: (k: string, e?: React.KeyboardEvent) => void;
  setEditing: (s: string | null) => void;
}) {
  const n = doc.axes[0].values.length;
  return (
    <>
      <div className="flex flex-col justify-center pr-1 text-right">
        <span className="text-micro font-semibold uppercase tracking-wider text-axis2/70">Y{y + 1}</span>
        <span className="line-clamp-2 text-micro text-ink-dim" title={rowLabel}>
          {rowLabel}
        </span>
      </div>
      {Array.from({ length: n }, (_, x) => {
        const k = cellKey(x, y, z);
        const cell = doc.cells[k];
        const status = cell?.status ?? "empty";
        const isSel = selection.includes(k);
        return (
          <div
            key={k}
            data-cell={k}
            role="button"
            tabIndex={0}
            aria-label={`第 ${z + 1} 层第 ${y + 1} 行第 ${x + 1} 列，${CELL_STATUS_LABEL[status]}`}
            onPointerDown={(e) => {
              if (mode !== "edit" || editing) return;
              e.stopPropagation();
              select([k]);
            }}
            onClick={() => {
              if (mode !== "play" || editing === k) return;
              beginEdit(k);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && mode === "play" && e.target === e.currentTarget) beginEdit(k);
            }}
            className={`flex min-h-[74px] flex-col rounded-xl border p-2 transition-[background,border-color] duration-200 ${STATUS_STYLE[status]} ${
              isSel ? "ring-2 ring-axis1 ring-offset-1 ring-offset-void" : ""
            } ${mode === "edit" ? "cursor-pointer" : "cursor-text hover:border-line-strong hover:bg-white/[0.05]"}`}
          >
            <div className="flex items-start justify-between gap-1">
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
                className="mt-1 w-full min-w-0 bg-transparent text-small font-semibold text-ink outline-none placeholder:text-ink-faint"
                placeholder="输入答案…"
                autoComplete="off"
              />
            ) : (
              <div className="mt-1 line-clamp-3 text-small font-semibold leading-snug">
                {cell?.guess || (mode === "edit" ? (cell?.answers[0]?.text ?? "") : "")}
              </div>
            )}

            <div className="mt-auto flex items-center gap-1 text-micro text-ink-faint">
              {cell?.rarity != null && status === "correct" && <span className="text-ok">冷门 {cell.rarity}</span>}
              {status === "similar" && cell?.confidence != null && (
                <span className="text-warn">相近 {Math.round(cell.confidence * 100)}%</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
