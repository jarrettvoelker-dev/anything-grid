import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "../state/store";

/* ============================================================================
   2D 无限画布
   视口变换只作用在**一个** world 层上（GPU 合成的 transform），子节点做 memo，
   所以拖动时不会重建整棵 DOM —— 这是"像 spatial workspace 而不是堆 HTML"的关键。

   手势矩阵：
     · 空白处拖拽 / 空格 + 拖拽 / 中键拖拽 → 平移（带惯性）
     · 滚轮 / 触控板双指 → 以指针为锚点缩放
     · 单指触控 → 平移；双指触控 → 捏合缩放
     · Shift + 拖拽 → 框选多选
   ========================================================================== */

const MIN_Z = 0.25;
const MAX_Z = 2.6;
const DOT = 26; // 世界坐标下的点阵间距

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 系统是否要求减少动态效果。惯性滚动对前庭敏感人群不友好，必须尊重。 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** 触摸设备上降低特效强度：点阵淡一些、惯性短一些，省电也省得晃眼。 */
const isCoarse = () => typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;

type Props = {
  children: ReactNode;
  /** 背景（非格子）点击 */
  onBackgroundClick?: () => void;
  className?: string;
};

export function CanvasPlane({ children, onBackgroundClick, className = "" }: Props) {
  const viewport = useStore((s) => s.viewport);
  const setViewport = useStore((s) => s.setViewport);
  const select = useStore((s) => s.select);
  const clearSelection = useStore((s) => s.clearSelection);

  const worldRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();

  const [spaceDown, setSpaceDown] = useState(false);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [panning, setPanning] = useState(false);

  /* 手势状态放 ref：pointermove 每秒几十次，走 state 会拖慢 */
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>;
    mode: "none" | "pan" | "marquee" | "pinch";
    startVp: { x: number; y: number; z: number };
    start: { x: number; y: number };
    last: { x: number; y: number };
    velocity: { x: number; y: number };
    lastT: number;
    pinchDist: number;
    moved: boolean;
  }>({
    pointers: new Map(),
    mode: "none",
    startVp: { x: 0, y: 0, z: 1 },
    start: { x: 0, y: 0 },
    last: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    lastT: 0,
    pinchDist: 0,
    moved: false,
  });

  /* 视口与点阵都用命令式写 DOM：不进 React 协调，拖动才跟手 */
  useLayoutEffect(() => {
    const w = worldRef.current;
    const p = planeRef.current;
    if (w) w.style.transform = `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.z})`;
    if (p) {
      const g = DOT * viewport.z;
      p.style.backgroundSize = `${g}px ${g}px, ${g * 5}px ${g * 5}px`;
      p.style.backgroundPosition = `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`;
    }
  }, [viewport]);

  /* 空格键 = 临时抓手 */
  useEffect(() => {
    const isTyping = (t: EventTarget | null) =>
      t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTyping(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* 以画布内某点为锚缩放：锚点在缩放前后保持不动，符合"放大我指的地方"的直觉 */
  const zoomAt = useCallback(
    (cx: number, cy: number, factor: number) => {
      const rect = planeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const v = useStore.getState().viewport;
      const z = clamp(v.z * factor, MIN_Z, MAX_Z);
      if (z === v.z) return;
      const px = cx - rect.left;
      const py = cy - rect.top;
      setViewport({
        z,
        x: px - ((px - v.x) / v.z) * z,
        y: py - ((py - v.y) / v.z) * z,
      });
    },
    [setViewport],
  );

  /* 滚轮缩放。挂在原生监听上并 passive:false —— React 的 onWheel 无法 preventDefault */
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.0016);
      zoomAt(e.clientX, e.clientY, factor);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const endGesture = useCallback(() => {
    const g = gesture.current;
    g.mode = "none";
    g.pointers.clear();
    setPanning(false);
    setMarquee(null);
  }, []);

  /* 惯性：松手后按最后速度继续滑，摩擦衰减。
     减少动效时直接跳过 —— 平滑滚动是前庭不适的主要来源之一。 */
  const flingRef = useRef<number | null>(null);
  const fling = useCallback(() => {
    const g = gesture.current;
    if (reduced) return;
    let { x: vx, y: vy } = g.velocity;
    const decay = isCoarse() ? 0.86 : 0.92;
    const cutoff = isCoarse() ? 4 : 1.5;
    const step = () => {
      vx *= decay;
      vy *= decay;
      if (Math.abs(vx) < cutoff && Math.abs(vy) < cutoff) {
        flingRef.current = null;
        return;
      }
      const v = useStore.getState().viewport;
      setViewport({ ...v, x: v.x + vx, y: v.y + vy });
      flingRef.current = requestAnimationFrame(step);
    };
    if (Math.abs(vx) > cutoff || Math.abs(vy) > cutoff) flingRef.current = requestAnimationFrame(step);
  }, [reduced, setViewport]);

  useEffect(
    () => () => {
      if (flingRef.current !== null) cancelAnimationFrame(flingRef.current);
    },
    [],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (flingRef.current !== null) {
      cancelAnimationFrame(flingRef.current);
      flingRef.current = null;
    }
    const g = gesture.current;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()];
      g.mode = "pinch";
      g.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      g.startVp = { ...useStore.getState().viewport };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    /* 落在交互元素上的按下不启动画布手势 —— 否则点输入框会变成拖画布 */
    const onInteractive =
      e.target instanceof HTMLElement && !!e.target.closest("input,textarea,button,select,a,[data-no-pan]");
    if (onInteractive) return;

    const hitCell = e.target instanceof HTMLElement && !!e.target.closest("[data-cell]");
    const wantPan = spaceDown || e.button === 1 || (!hitCell && !e.shiftKey);

    g.mode = wantPan ? "pan" : "marquee";
    g.start = { x: e.clientX, y: e.clientY };
    g.last = { x: e.clientX, y: e.clientY };
    g.lastT = performance.now();
    g.velocity = { x: 0, y: 0 };
    g.moved = false;
    g.startVp = { ...useStore.getState().viewport };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (g.mode === "pan") setPanning(true);
    else setMarquee({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (g.mode === "pinch" && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.pinchDist > 0) {
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        zoomAt(mid.x, mid.y, d / g.pinchDist);
        g.pinchDist = d;
      }
      return;
    }

    const dx = e.clientX - g.start.x;
    const dy = e.clientY - g.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;

    if (g.mode === "pan") {
      const now = performance.now();
      const dt = Math.max(1, now - g.lastT);
      g.velocity = { x: ((e.clientX - g.last.x) / dt) * 16, y: ((e.clientY - g.last.y) / dt) * 16 };
      g.last = { x: e.clientX, y: e.clientY };
      g.lastT = now;
      setViewport({ ...g.startVp, x: g.startVp.x + dx, y: g.startVp.y + dy });
    } else if (g.mode === "marquee") {
      setMarquee({ x0: g.start.x, y0: g.start.y, x1: e.clientX, y1: e.clientY });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    g.pointers.delete(e.pointerId);

    if (g.mode === "pinch") {
      if (g.pointers.size < 2) g.mode = "none";
      return;
    }

    const modeAtUp = g.mode;

    if (g.mode === "marquee" && marquee) {
      const world = worldRef.current;
      if (world) {
        const box = {
          l: Math.min(marquee.x0, marquee.x1),
          r: Math.max(marquee.x0, marquee.x1),
          t: Math.min(marquee.y0, marquee.y1),
          b: Math.max(marquee.y0, marquee.y1),
        };
        /* 用屏幕矩形做命中测试：不管缩放多少都不用换算世界坐标 */
        const hits: string[] = [];
        world.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.right > box.l && r.left < box.r && r.bottom > box.t && r.top < box.b) {
            const k = el.dataset.cell;
            if (k) hits.push(k);
          }
        });
        if (hits.length) select(hits, e.shiftKey || e.metaKey || e.ctrlKey);
        else if (!g.moved) clearSelection();
      }
    } else if (g.mode === "pan") {
      fling();
    }

    const wasMoved = g.moved;
    endGesture();
    /* modeAtUp 必须在 endGesture() 之前取 —— 它会把 mode 重置成 none */
    if (!wasMoved && modeAtUp !== "marquee" && onBackgroundClick) {
      const t = e.target as HTMLElement;
      if (!t.closest("[data-cell]") && !t.closest("input,button")) onBackgroundClick();
    }
  };

  const cursor = panning ? "grabbing" : spaceDown ? "grab" : "default";
  const m = marquee;

  const dotStyle = useMemo(
    () => ({
      backgroundImage:
        "radial-gradient(circle, rgb(255 255 255 / 0.10) 1px, transparent 1px)," +
        "radial-gradient(circle, rgb(255 255 255 / 0.16) 1.5px, transparent 1.5px)",
    }),
    [],
  );

  return (
    <div
      ref={planeRef}
      className={`relative h-full w-full overflow-hidden ${className}`}
      style={{ ...dotStyle, cursor, touchAction: "none", contain: "strict" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="application"
      aria-label="二维平面画布"
    >
      <div
        ref={worldRef}
        className="absolute left-0 top-0 origin-top-left will-change-transform"
        style={{ transform: `translate3d(${viewport.x}px, ${viewport.y}px, 0) scale(${viewport.z})` }}
      >
        {children}
      </div>

      {m && (
        <div
          className="pointer-events-none absolute rounded-sm border border-axis1/70 bg-axis1/10"
          style={{
            left: Math.min(m.x0, m.x1),
            top: Math.min(m.y0, m.y1),
            width: Math.abs(m.x1 - m.x0),
            height: Math.abs(m.y1 - m.y0),
          }}
        />
      )}

      <ViewportControls />
    </div>
  );
}

/** 缩放控件。刻意做得很小 —— 空间应用里它只是兜底，主交互是滚轮与捏合。 */
function ViewportControls() {
  const setViewport = useStore((s) => s.setViewport);
  const zoom = useStore((s) => s.viewport.z);
  const btn =
    "grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface/80 text-ink-dim backdrop-blur transition hover:border-line-strong hover:text-ink active:scale-95";
  return (
    <div className="absolute bottom-4 right-4 z-10 flex items-center gap-1.5" data-no-pan>
      <button className={btn} aria-label="缩小" onClick={() => setViewport({ ...useStore.getState().viewport, z: clamp(zoom / 1.25, MIN_Z, MAX_Z) })}>
        −
      </button>
      <button
        className={`${btn} w-14 font-mono text-tiny`}
        aria-label="重置视图"
        onClick={() => setViewport({ x: 0, y: 0, z: 1 })}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button className={btn} aria-label="放大" onClick={() => setViewport({ ...useStore.getState().viewport, z: clamp(zoom * 1.25, MIN_Z, MAX_Z) })}>
        ＋
      </button>
    </div>
  );
}
