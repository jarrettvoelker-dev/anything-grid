import { useMemo, useState } from "react";
import { navigate } from "../lib/router";
import { SAMPLES } from "../lib/samples";
import { listMine, newId, saveDoc, deleteDoc, type MineEntry } from "../lib/storage";
import {
  cellCount,
  GRID_SIZES,
  GRID_STATUS_LABEL,
  JUDGE_MODE_LABEL,
  sizeLabel,
  type GridDoc,
  type GridSize,
} from "../lib/types";
import { AdSlot, Button, Card } from "../components/ui";
import { useStore } from "../state/store";
import { createDoc2D, createDoc3D } from "../state/store";

export function Home() {
  const resetHistory = useStore((s) => s.resetHistory);
  const [mine, setMine] = useState<MineEntry[]>(() => listMine());

  const startBlank = (size: GridSize) => {
    const doc: GridDoc = { ...createDoc2D(size), id: newId() };
    resetHistory(doc);
    saveDoc(doc);
    navigate(`/grid/${doc.id}/edit`);
  };

  const startBlank3D = () => {
    const doc: GridDoc = { ...createDoc3D(), id: newId() };
    resetHistory(doc);
    saveDoc(doc);
    navigate(`/grid/${doc.id}/edit`);
  };

  const openSample = (idx: number) => {
    const s = SAMPLES[idx];
    const doc: GridDoc = { ...s, id: newId(), cells: JSON.parse(JSON.stringify(s.cells)) };
    saveDoc(doc);
    navigate(`/grid/${doc.id}`);
  };

  const remove = (id: string) => {
    deleteDoc(id);
    setMine(listMine());
  };

  const total = useMemo(() => SAMPLES.reduce((n, s) => n + cellCount(s), 0), []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        {/* Hero */}
        <section className="animate-fade-up">
          <div className="mb-4 inline-flex items-center gap-2 rounded-pill border border-line bg-white/[0.03] px-3 py-1 text-micro text-ink-dim">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            平面 2×2 ～ 5×5 · 立体 3×3×3 · 可创建 · 可发布
          </div>
          <h1 className="max-w-2xl text-hero font-bold leading-[1.1] sm:text-[44px]">
            每格填一样
            <span className="bg-gradient-to-r from-axis1 to-axis2 bg-clip-text text-transparent"> 同时满足轴上所有条件 </span>
            的事物
          </h1>
          <p className="mt-4 max-w-xl text-lead text-ink-dim">
            平面题：两条轴交叉出 4～25 格。立体题：三条轴交叉出 27 格，可以转着看，也可以一层层看。
            出题时选「预设答案」让玩家猜，或选「开放造词」让大家自己发挥。
          </p>

          <div className="mt-7 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-xl border border-line bg-black/20 p-1">
              <span className="pl-2 text-tiny text-ink-faint">新建</span>
              {GRID_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => startBlank(s)}
                  className="h-9 rounded-lg px-3 text-small font-medium text-ink-dim transition hover:bg-white/[0.1] hover:text-ink"
                >
                  {s}×{s}
                </button>
              ))}
            </div>
            <button
              onClick={startBlank3D}
              className="h-11 rounded-xl border border-axis1/40 bg-axis1/[0.08] px-4 text-small font-medium text-ink transition hover:border-axis1/70 hover:bg-axis1/[0.14]"
            >
              新建 3D 题 · 27 格
            </button>
            <Button variant="ghost" onClick={() => document.getElementById("samples")?.scrollIntoView({ behavior: "smooth" })}>
              先玩示例 ↓
            </Button>
          </div>
        </section>

        {/* 示例 */}
        <section id="samples" className="mt-16 scroll-mt-6">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-title font-semibold">示例题</h2>
            <span className="text-tiny text-ink-faint">{SAMPLES.length} 套 · 共 {total} 格</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {SAMPLES.map((s, i) => (
              <button
                key={s.title}
                onClick={() => openSample(i)}
                className="glass group rounded-card p-4 text-left shadow-card transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-line-strong"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="font-medium">{s.title}</span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={`rounded-pill px-2 py-0.5 text-micro ${
                        s.judgeMode === "open" ? "bg-axis3/15 text-axis3" : "bg-white/[0.08] text-ink-dim"
                      }`}
                    >
                      {JUDGE_MODE_LABEL[s.judgeMode]}
                    </span>
                    <span className="rounded-pill bg-white/[0.08] px-2 py-0.5 font-mono text-micro text-ink-dim">
                      {sizeLabel(s)}
                    </span>
                  </span>
                </div>
                <p className="line-clamp-2 text-small text-ink-faint">{s.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.axes[0].values.slice(0, 3).map((label) => (
                    <span key={label} className="rounded-md border border-line bg-white/[0.03] px-1.5 py-0.5 text-micro text-ink-faint">
                      {label}
                    </span>
                  ))}
                  {s.axes[0].values.length > 3 && (
                    <span className="text-micro text-ink-faint">+{s.axes[0].values.length - 3}</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* 我的 */}
        <section className="mt-16">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-title font-semibold">我创建的</h2>
            <span className="text-tiny text-ink-faint">存在这台设备上</span>
          </div>
          {mine.length === 0 ? (
            <Card className="text-center text-small text-ink-faint">
              还没有作品。点上面的尺寸按钮开始创建第一套题。
            </Card>
          ) : (
            <div className="space-y-2">
              {mine.map((m) => (
                <div key={m.id} className="glass flex items-center gap-3 rounded-card px-4 py-3 shadow-card">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-small font-medium">{m.title || "未命名题"}</div>
                    <div className="text-micro text-ink-faint">
                      {m.dims === 3 ? `${m.size}×${m.size}×${m.size}` : `${m.size}×${m.size}`} · {GRID_STATUS_LABEL[m.status]}
                    </div>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/grid/${m.id}`)}>
                    游玩
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => navigate(`/grid/${m.id}/edit`)}>
                    编辑
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(m.id)} aria-label={`删除 ${m.title}`}>
                    ✕
                  </Button>
                </div>
              ))}
            </div>
          )}
        </section>

        <AdSlot className="mt-16" />
      </div>
    </div>
  );
}
