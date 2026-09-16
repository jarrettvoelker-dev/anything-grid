import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "../components/CanvasPlane";
import { Board, boardMetrics } from "../components/Board";
import { Cube3D, DEFAULT_SPACE } from "../components/Cube3D";
import { AxisLegend, Flat3D } from "../components/Flat3D";
import { JudgeSettings } from "../components/JudgeSettings";
import { Button, Card, Segmented, Sheet } from "../components/ui";
import { loadDoc, saveDoc } from "../lib/storage";
import { gridUrl, navigate } from "../lib/router";
import { isJudgeReady } from "../lib/judge";
import {
  allCoords,
  axisLen,
  cellKey,
  CELL_STATUS_LABEL,
  comboText,
  dimsOf,
  sizeLabel,
  type GridDoc,
} from "../lib/types";
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
  const judgeAll = useStore((s) => s.judgeAll);
  const notify = useStore((s) => s.notify);
  const judgeConfig = useStore((s) => s.judgeConfig);
  const planeRef = useRef<HTMLDivElement>(null);

  const [missing, setMissing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [done, setDone] = useState(false);
  const [cubeView, setCubeView] = useState(false);
  const [space, setSpace] = useState(DEFAULT_SPACE);
  const [judgingAll, setJudgingAll] = useState(false);
  const startedAt = useRef<number | null>(null);

  const is3D = dimsOf(doc) === 3;

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
    /* 3D 题默认开立方体（旧版的主视图），平面层是给转不明白的人的备选 */
    setCubeView(dimsOf(d) === 3);
  }, [id, resetHistory]);

  useCenterBoard(axisLen(doc, 0), planeRef);

  const stats = useMemo(() => {
    const cells = Object.values(doc.cells);
    const total = cells.length;
    const answered = cells.filter((c) => c.status === "correct" || c.status === "auto").length;
    const wrong = cells.filter((c) => c.status === "incorrect").length;
    const near = cells.filter((c) => c.status === "similar").length;
    const auto = cells.filter((c) => c.status === "auto").length;
    const failed = cells.filter((c) => c.status === "error").length;
    return { total, answered, wrong, near, auto, failed };
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

  /* 开放造词模式下「全部重判」是常用动作 —— 换了模型或改了提示词后要能一键重来 */
  const rejudge = async () => {
    setJudgingAll(true);
    try {
      const n = await judgeAll();
      notify(n ? `已重新判定 ${n} 格` : "还没有可判定的格子");
    } finally {
      setJudgingAll(false);
    }
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* 头部信息条 */}
      <div className="glass z-20 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b px-3 py-2.5 sm:px-4">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lead font-semibold">{doc.title}</h1>
          {doc.description && <p className="truncate text-micro text-ink-faint">{doc.description}</p>}
        </div>

        {is3D && (
          <Segmented
            size="sm"
            value={cubeView ? "cube" : "flat"}
            onChange={(v) => setCubeView(v === "cube")}
            options={[
              { value: "cube", label: "立方体" },
              { value: "flat", label: "平面层" },
            ]}
          />
        )}

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

        {doc.judgeMode === "answers" && doc.similarSearch && (
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
        {doc.judgeMode === "open" && (
          <Button size="sm" variant="ghost" disabled={judgingAll} onClick={rejudge}>
            {judgingAll ? "重判中…" : "全部重判"}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => navigate(`/grid/${id}/edit`)}>
          编辑
        </Button>
      </div>

      {/* 画布 / 立方体 */}
      {is3D ? (
        <div className="relative min-h-0 flex-1">
          {cubeView ? (
            <>
              <Cube3D doc={doc} mode="play" space={space} />
              <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center">
                <div className="glass pointer-events-auto flex items-center gap-3 rounded-pill px-3 py-1.5 text-micro text-ink-dim">
                  <span>分离</span>
                  <input
                    type="range"
                    min={60}
                    max={170}
                    value={space}
                    onChange={(e) => setSpace(Number(e.target.value))}
                    className="w-24 accent-axis1"
                    aria-label="方块间距"
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="h-full overflow-y-auto">
              <div className="mx-auto max-w-3xl px-4 py-5">
                <Flat3D doc={doc} mode="play" />
              </div>
            </div>
          )}

          {!startedAt.current && (
            <div className="pointer-events-none absolute bottom-4 left-4 z-10 max-w-[46ch] animate-fade-up">
              <Card className="pointer-events-none py-2.5">
                <p className="text-tiny text-ink-dim">
                  {cubeView ? "点方块输入答案 · 拖动旋转 · 滚轮/双指缩放" : "点格子输入答案 · 上方切换层"}
                </p>
              </Card>
            </div>
          )}

          {/* 立方体上只有颜色没有文字，轴名与特质得摆在这儿 */}
          <div className="absolute left-4 top-3 z-10 flex flex-col items-start gap-2">
            <AxisLegend doc={doc} />
            <StatusPills stats={stats} />
          </div>
        </div>
      ) : (
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

          <div className="absolute left-4 top-3 z-10">
            <StatusPills stats={stats} />
          </div>
        </div>
      )}

      <ResultSheet
        open={done}
        onClose={() => setDone(false)}
        doc={doc}
        elapsed={elapsed}
        id={id}
        autoCount={stats.auto}
      />

      {/* 开放模式没配裁判就玩不动，直接把设置摆到台面上 */}
      {doc.judgeMode === "open" && !isJudgeReady(judgeConfig) && (
        <div className="glass fixed inset-x-0 bottom-0 z-30 border-t p-3 sm:p-4">
          <div className="mx-auto max-w-3xl">
            <JudgeSettings />
          </div>
        </div>
      )}
    </div>
  );
}

/** 不符 / 接近 / 判定失败三种计数。error 单独列 —— 它不是"答错了"。 */
function StatusPills({
  stats,
}: {
  stats: { wrong: number; near: number; failed: number };
}) {
  if (!stats.wrong && !stats.near && !stats.failed) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {stats.wrong > 0 && <span className="glass rounded-pill px-2.5 py-1 text-micro text-bad">{stats.wrong} 格不符</span>}
      {stats.near > 0 && <span className="glass rounded-pill px-2.5 py-1 text-micro text-warn">{stats.near} 格接近</span>}
      {stats.failed > 0 && (
        <span className="glass rounded-pill px-2.5 py-1 text-micro text-ink-faint">{stats.failed} 格没判成</span>
      )}
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
  const is3D = dimsOf(doc) === 3;

  const resultText = useMemo(() => {
    const lines = [
      `我在 Anything Grid 完成了《${doc.title}》`,
      `${sizeLabel(doc)} · 用时 ${fmt(elapsed)}`,
      "",
    ];
    /* 平面层视图那样按层分组导出 —— 27 格平铺成一行没法看 */
    for (const [x, y, z] of allCoords(doc)) {
      const cell = doc.cells[cellKey(x, y, z)];
      if (z !== undefined && x === 0) {
        if (z > 0) lines.push("");
        lines.push(`— 第 ${z + 1} 层 · ${doc.axes[2].values[z]} —`);
      }
      if (x === 0) lines.push(`${doc.axes[1].values[y]}：`);
      lines.push(`  ${comboText(doc, [x, y, z])} → ${cell?.guess ?? "—"}`);
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
      wide={is3D}
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
          {sizeLabel(doc)} · {Object.keys(doc.cells).length} 格全部填对
          {autoCount > 0 && ` · 其中 ${autoCount} 格为自动填充`}
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        {allCoords(doc).map(([x, y, z]) => {
          const k = cellKey(x, y, z);
          const c = doc.cells[k];
          return (
            <div key={k} className="flex items-center gap-2 text-tiny">
              <span className="w-10 shrink-0 font-mono text-ink-faint">
                {z === undefined ? `${y + 1}-${x + 1}` : `${z + 1}-${y + 1}-${x + 1}`}
              </span>
              <span className="w-40 shrink-0 truncate text-ink-faint" title={comboText(doc, [x, y, z])}>
                {comboText(doc, [x, y, z])}
              </span>
              <span className="truncate font-medium">{c?.guess || "—"}</span>
              <span className="ml-auto shrink-0 text-ink-faint">
                {c?.rarity != null && c.status === "correct" && <span className="mr-2 text-ok">冷门 {c.rarity}</span>}
                {CELL_STATUS_LABEL[c?.status ?? "empty"]}
              </span>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}
