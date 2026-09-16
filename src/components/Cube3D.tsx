import { memo, useCallback, useEffect, useRef, useState } from "react";
import { allCoords, cellKey, comboText, parseCellKey, type Cell, type GridDoc } from "../lib/types";
import { useStore } from "../state/store";
import { usePrefersReducedMotion } from "./CanvasPlane";

/* 3D 题的**立方体视图**：27 个方块按 (x,y,z) 摆成 3×3×3，拖着转。

   性能上有一条硬规矩：**旋转与缩放直接写 DOM 的 transform，不进 React state**。
   27 个方块每个带 6 个面（162 个节点），每帧过一遍 reconciliation 会明显掉帧。
   只有「文字/状态变了」才走 React 重渲染 —— 与 CanvasPlane 同一手法。

   点击只在选中/作答时用，所以不担心与拖拽冲突：位移超过阈值就判定为旋转，不算点击。 */

const FACES = ["front", "back", "right", "left", "top", "bottom"];
const LAYER_CLASS = ["ag3d-l0", "ag3d-l1", "ag3d-l2"];

/** 立方体边长与方块间距的默认值。间距可在界面上调（把方块拆开看内部）。 */
const CELL_SIZE = 72;
export const DEFAULT_SPACE = 104;
export const MIN_SPACE = 60;
export const MAX_SPACE = 170;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

type Props = {
  doc: GridDoc;
  mode: "play" | "edit";
  space?: number;
  /** 选中态由外面传，方便与侧栏编辑器联动 */
  onSelect?: (key: string) => void;
};

export const Cube3D = memo(function Cube3D({ doc, mode, space = DEFAULT_SPACE, onSelect }: Props) {
  const selected = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const submitGuess = useStore((s) => s.submitGuess);
  const reduced = usePrefersReducedMotion();

  const sceneRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  /* 视角存 ref 而不是 state —— 它就是不能进渲染循环 */
  const view = useRef({ rx: -20, ry: -30, zoom: 1 });

  const [dragging, setDragging] = useState(false);
  /* 作答输入框不塞进旋转的立方体面里 —— 面是斜的，打字时字也是斜的，手机上更难用。
     改成场景底部一个浮层，键盘、输入法、长文本都正常。 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const applyView = useCallback(() => {
    const { rx, ry, zoom } = view.current;
    if (worldRef.current) worldRef.current.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    if (cameraRef.current) cameraRef.current.style.transform = `scale(${zoom})`;
  }, []);

  useEffect(applyView, [applyView]);

  /* 手势：单指/单键拖动 = 旋转；双指捏合或滚轮 = 缩放。
     指针按 id 记账，才能同时跟踪两根手指。 */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; zoom: number } | null>(null);
  const moved = useRef(0);

  const twoPointerDist = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = 0;
    if (pointers.current.size === 2) {
      pinch.current = { dist: twoPointerDist(), zoom: view.current.zoom };
    } else {
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinch.current && pointers.current.size === 2) {
      const ratio = twoPointerDist() / (pinch.current.dist || 1);
      view.current.zoom = clamp(pinch.current.zoom * ratio, 0.35, 2.6);
      applyView();
      moved.current = 99;
      return;
    }

    moved.current += Math.abs(dx) + Math.abs(dy);
    /* 纵向拖动改俯仰并夹在 ±85°，避免转过头看到"翻过去"的背面 */
    view.current.ry += dx * 0.32;
    view.current.rx = clamp(view.current.rx - dy * 0.32, -85, 85);
    applyView();
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setDragging(false);
  };

  /* 滚轮缩放。必须非 passive 才能 preventDefault —— 否则页面会跟着滚。 */
  useEffect(() => {
    const el = sceneRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = clamp(view.current.zoom * (e.deltaY > 0 ? 0.92 : 1.08), 0.35, 2.6);
      applyView();
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyView]);

  const pick = (key: string) => {
    /* 拖过就不算点击 —— 否则每次旋转结束都会顺手选中一个方块 */
    if (moved.current > 6) return;
    if (mode === "edit") {
      select([key]);
      onSelect?.(key);
      return;
    }
    setDraft(useStore.getState().history.present.cells[key]?.guess ?? "");
    setEditing(key);
  };

  /* 输入法组合期间的 Enter 是"选词"不是"提交" */
  const commit = (e?: React.KeyboardEvent) => {
    if (!editing) return;
    if (e && (e.nativeEvent as unknown as { isComposing?: boolean }).isComposing) return;
    void submitGuess(editing, draft);
    setEditing(null);
  };

  /* 同一个答案被填进多格时标黄：开放模式下 27 格尽量不重复，这是核心约束 */
  const dup = new Set<string>();
  {
    const first: Record<string, string> = {};
    for (const [x, y, z] of allCoords(doc)) {
      const k = cellKey(x, y, z);
      const t = doc.cells[k]?.guess?.trim();
      if (!t) continue;
      if (first[t]) {
        dup.add(first[t]);
        dup.add(k);
      } else first[t] = k;
    }
  }

  const layerLen = doc.axes[2]?.values.length ?? 1;

  return (
    <div
      ref={sceneRef}
      className={`ag3d-scene ${dragging ? "is-dragging" : ""}`}
      style={{ ["--cs" as string]: `${CELL_SIZE}px` }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      data-cube="1"
    >
      <div ref={cameraRef} className="ag3d-camera">
        <div ref={worldRef} className="ag3d-world">
          {allCoords(doc).map(([x, y, z = 0]) => {
            const k = cellKey(x, y, z);
            const cell: Cell | undefined = doc.cells[k];
            const text = cell?.guess || (mode === "edit" ? (cell?.answers[0]?.text ?? "") : "");
            const status = cell?.status ?? "empty";
            const isSel = selected.includes(k);

            /* 居中：下标 0..2 映射到 -1..1，再乘间距 */
            const mid = (layerLen - 1) / 2;
            const transform = `translate3d(${(x - mid) * space}px, ${(y - mid) * space}px, ${(z - mid) * space}px)`;

            const cls = [
              "ag3d-wrap",
              LAYER_CLASS[z] ?? "",
              text ? "is-filled" : "is-empty",
              status === "correct" || status === "auto" ? "is-ok" : "",
              status === "incorrect" ? "is-bad" : "",
              status === "searching" ? "is-busy" : "",
              /* error 不走红框 —— 红=答错了。判不出来是另一回事，别混为一谈。 */
              status === "error" ? "is-err" : "",
              dup.has(k) ? "is-dup" : "",
              isSel ? "is-sel" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                key={k}
                className={cls}
                data-cell={k}
                style={{ transform, transition: reduced ? "none" : undefined }}
                onPointerUp={() => pick(k)}
                title={`第 ${z + 1} 层 · ${y + 1} 行 ${x + 1} 列`}
              >
                <div className="ag3d-cell">
                  {FACES.map((f) => (
                    <div key={f} className={`ag3d-face ag3d-f-${f}`}>
                      <span className="ag3d-ans">{f === "front" ? text || "＋" : text}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {editing && (
        <div
          className="absolute bottom-4 left-1/2 z-20 w-[min(420px,calc(100%-2rem))] -translate-x-1/2"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div className="glass rounded-card p-3 shadow-lift">
            <div className="mb-2 flex items-center gap-2">
              <span className="line-clamp-1 text-micro text-ink-faint" title={comboText(doc, parseCellKey(editing))}>
                {comboText(doc, parseCellKey(editing))}
              </span>
              <button
                onClick={() => setEditing(null)}
                className="ml-auto shrink-0 rounded-md px-1.5 text-micro text-ink-faint transition hover:text-ink"
                aria-label="关闭输入"
              >
                ✕
              </button>
            </div>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit(e);
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-10 min-w-0 flex-1 rounded-xl border border-line bg-black/30 px-3 text-small font-semibold outline-none focus:border-axis1/60"
                placeholder="填一样同时符合这三项的事物…"
                autoComplete="off"
              />
              <button
                onClick={() => commit()}
                className="h-10 shrink-0 rounded-xl bg-gradient-to-br from-axis1 to-axis2 px-4 text-small font-semibold text-void transition hover:brightness-110"
              >
                提交
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
