import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "../components/CanvasPlane";
import { Board, boardMetrics } from "../components/Board";
import { Button, Card, Sheet } from "../components/ui";
import { loadDoc, saveDoc } from "../lib/storage";
import { gridUrl, navigate } from "../lib/router";
import { CELL_STATUS_LABEL, type GridDoc } from "../lib/types";
import { useStore } from "../state/store";

/** 把棋盘摆到画布正中。留出 HUD 的边距，别让标题压住格子。 */
function useCenterBoard(size: number, ref: React.RefObject<HTMLDivElement>) {
  const setViewport = useStore((s) => s.setViewport);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { w, h } = boardMetrics(size);
    const r = el.getBoundingClientRect();
    const pad = r.width < 720 ? 20 : 48;
    const z = Math.min(1, (r.width - pad * 2) / w, (r.height - 150) / h);
    setViewport({ z: Math.max(0.3, z), x: (r.width - w * z) / 2, y: (r.height - h * z) / 2 + 20 });
  }, [size, ref, setViewport]);
}

const fmt = (ms: number) => {
  const t = Math.floor(ms / 1000);
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

export function Play({ id }: { id: string }) {
  const resetHistory = useStore((s) => s.resetHistory);
  const doc = useStore((s) => s.history.present);
  const autoFill = useStore((s) => s.autoFill);
  const notify = useStore((s) => s.notify);
  const planeRef = useRef<HTMLDivElement>(null);

  const [missing, setMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    const d = loadDoc(id);
    if (!d) {
      setMissing(true);
      return;
    }
    resetHistory(d);
    startedAt.current = null;
    setElapsed(0);
    setDone(false);
  }, [id, resetHistory]);

  useCenterBoard(doc.size, planeRef);

  const stats = useMemo(() => {
    const cells = Object.values(doc.cells);
    const total = cells.length;
    const answered = cells.filter((c) => c.status === "correct" || c.status === "auto").length;
    const wrong = cells.filter((c) => c.status === "incorrect").length;
    const near = cells.filter((c) => c.status === "similar").length;
    const auto = cells.filter((c) => c.status === "auto").length;
    return { total, answered, wrong, near, auto };
  }, [doc]);

  /* 首次作答开始计时 */
  useEffect(() => {
    if (startedAt.current === null && stats.answered + stats.wrong + stats.near > 0) startedAt.current = Date.now();
  }, [stats]);

  useEffect(() => {
    if (startedAt.current === null || done) return;
    const t = setInterval(() => setElapsed(Date.now() - (startedAt.current ?? Date.now())), 500);
    return () => clearInterval(t);
  }, [done, stats.answered]);

  useEffect(() => {
    if (stats.total > 0 && stats.answered === stats.total && !done) setDone(true);
  }, [stats, done]);

  /* 作答就落盘，刷新不丢 */
  useEffect(() => {
    const t = setTimeout(() => saveDoc(doc), 400);
    return () => clearTimeout(t);
  }, [doc]);

  if (missing) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="mb-4 text-lead text-ink-dim">这套题不在这台设备上。</p>
          <Button variant="solid" onClick={() => navigate("/")}>
            回首页
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* 头部信息条 */}
      <div className="glass z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lead font-semibold">{doc.title}</h1>
          {doc.description && <p className="truncate text-micro text-ink-faint">{doc.description}</p>}
        </div>

        {/* 进度条：用一条细线代替数字堆砌，一眼看出还差多少 */}
        <div className="flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-pill bg-white/10 sm:w-36">
            <div
              className="h-full rounded-pill bg-gradient-to-r from-axis1 to-ok transition-all duration-500 ease-out"
              style={{ width: `${(stats.answered / Math.max(1, stats.total)) * 100}%` }}
            />
          </div>
          <span className="font-mono text-tiny text-ink-dim">
            {stats.answered}/{stats.total}
          </span>
        </div>

        <span className="font-mono text-tiny text-ink-faint">{fmt(elapsed)}</span>

        {doc.similarSearch && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const n = autoFill();
              notify(n ? `条件重合，自动填入 ${n} 格` : "没有可自动填充的格子");
            }}
          >
            自动填充
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => navigate(`/grid/${id}/edit`)}>
          编辑
        </Button>
      </div>

      {/* 画布 */}
      <div ref={planeRef} className="relative min-h-0 flex-1">
        <CanvasPlane>
          <Board doc={doc} mode="play" />
        </CanvasPlane>

        {!startedAt.current && (
          <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[52ch] animate-fade-up">
            <Card className="pointer-events-none py-2.5">
              <p className="text-tiny text-ink-dim">
                点格子开始作答 · 滚轮缩放 · 空格 + 拖拽平移 · Shift 拖拽框选 · 拖动方块可换位
              </p>
            </Card>
          </div>
        )}

        {(stats.wrong > 0 || stats.near > 0) && (
          <div className="absolute left-4 top-3 z-10 flex gap-2">
            {stats.wrong > 0 && (
              <span className="glass rounded-pill px-2.5 py-1 text-micro text-bad">{stats.wrong} 格不符</span>
            )}
            {stats.near > 0 && (
              <span className="glass rounded-pill px-2.5 py-1 text-micro text-warn">{stats.near} 格接近</span>
            )}
          </div>
        )}
      </div>

      <ResultSheet
        open={done}
        onClose={() => setDone(false)}
        doc={doc}
        elapsed={elapsed}
        id={id}
        autoCount={stats.auto}
      />
    </div>
  );
}

function ResultSheet({
  open,
  onClose,
  doc,
  elapsed,
  id,
  autoCount,
}: {
  open: boolean;
  onClose: () => void;
  doc: GridDoc;
  elapsed: number;
  id: string;
  autoCount: number;
}) {
  const notify = useStore((s) => s.notify);
  const url = gridUrl(id);

  const resultText = useMemo(() => {
    const lines = [`我在 Anything Grid 完成了《${doc.title}》`, `${doc.size}×${doc.size} · 用时 ${fmt(elapsed)}`];
    lines.push("");
    for (let y = 0; y < doc.size; y++) {
      const row: string[] = [];
      for (let x = 0; x < doc.size; x++) row.push(doc.cells[`${x},${y}`]?.guess ?? "—");
      lines.push(`${doc.rows[y]?.label ?? ""}: ${row.join(" ｜ ")}`);
    }
    lines.push("", url);
    return lines.join("\n");
  }, [doc, elapsed, url]);

  const copy = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(msg);
    } catch {
      notify("复制失败，请手动选择文本");
    }
  };

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: doc.title, text: `来玩玩《${doc.title}》`, url });
        return;
      } catch {
        /* 用户取消分享是正常路径，退回复制 */
      }
    }
    void copy(url, "链接已复制");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="🎉 全部完成"
      footer={
        <>
          <Button variant="ghost" onClick={() => copy(resultText, "成绩已复制")}>
            复制成绩
          </Button>
          <Button variant="outline" onClick={() => copy(url, "链接已复制")}>
            复制链接
          </Button>
          <Button variant="solid" onClick={share}>
            分享
          </Button>
        </>
      }
    >
      <div className="rounded-card border border-ok/30 bg-gradient-to-br from-ok/[0.12] to-axis1/[0.08] p-5 text-center">
        <div className="text-hero font-bold tabular-nums">{fmt(elapsed)}</div>
        <div className="mt-1 text-small text-ink-dim">
          {doc.size}×{doc.size} · {doc.size * doc.size} 格全部填对
          {autoCount > 0 && ` · 其中 ${autoCount} 格为自动填充`}
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {Object.values(doc.cells)
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((c) => (
            <div key={`${c.x},${c.y}`} className="flex items-center gap-2 text-tiny">
              <span className="w-10 shrink-0 font-mono text-ink-faint">
                {c.y + 1}-{c.x + 1}
              </span>
              <span className="w-24 shrink-0 truncate text-ink-faint">
                {doc.cols[c.x]?.label} × {doc.rows[c.y]?.label}
              </span>
              <span className="truncate font-medium">{c.guess || "—"}</span>
              <span className="ml-auto shrink-0 text-ink-faint">{CELL_STATUS_LABEL[c.status]}</span>
            </div>
          ))}
      </div>
    </Sheet>
  );
}
