import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "../components/CanvasPlane";
import { Board, boardMetrics } from "../components/Board";
import { Cube3D, DEFAULT_SPACE, MAX_SPACE, MIN_SPACE } from "../components/Cube3D";
import { AxisLegend, Flat3D } from "../components/Flat3D";
import { JudgeSettings } from "../components/JudgeSettings";
import { Button, Card, Field, Segmented, Sheet } from "../components/ui";
import { loadDoc, newId, saveDoc } from "../lib/storage";
import { gridUrl, navigate } from "../lib/router";
import {
  axisLen,
  cellCount,
  dimsOf,
  GRID_SIZES,
  GRID_STATUS_LABEL,
  JUDGE_MODE_LABEL,
  sizeLabel,
  type CellAnswer,
  type GridDoc,
  type GridSize,
  type GridStatus,
  type JudgeMode,
} from "../lib/types";
import { createDoc2D, useStore } from "../state/store";

export function Creator({ id }: { id?: string }) {
  const doc = useStore((s) => s.history.present);
  const resetHistory = useStore((s) => s.resetHistory);
  const setMeta = useStore((s) => s.setMeta);
  const setSize = useStore((s) => s.setSize);
  const setDims = useStore((s) => s.setDims);
  const setAxisLabel = useStore((s) => s.setAxisLabel);
  const setAxisValue = useStore((s) => s.setAxisValue);
  const addAnswer = useStore((s) => s.addAnswer);
  const updateAnswer = useStore((s) => s.updateAnswer);
  const removeAnswer = useStore((s) => s.removeAnswer);
  const selection = useStore((s) => s.selection);
  const notify = useStore((s) => s.notify);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);

  const planeRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [missing, setMissing] = useState(false);
  const [cubeView, setCubeView] = useState(false);
  const [space, setSpace] = useState(DEFAULT_SPACE);

  const dims = dimsOf(doc);
  const is3D = dims === 3;
  /* 开放造词模式下每格没有预设答案，格子面板只在预设答案模式出现 */
  const editsAnswers = doc.judgeMode === "answers";

  /* 载入：编辑已有题，或开一套新的 */
  useEffect(() => {
    if (!id) {
      resetHistory({ ...createDoc2D(3), id: newId() });
      return;
    }
    const d = loadDoc(id);
    if (!d) {
      setMissing(true);
      return;
    }
    resetHistory(d);
  }, [id, resetHistory]);

  /* 自动保存草稿：编辑停下 600ms 后落盘，并给个不易察觉的确认 */
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    setSaved(false);
    const t = setTimeout(() => {
      saveDoc(doc);
      setSaved(true);
    }, 600);
    return () => clearTimeout(t);
  }, [doc]);

  /* 2D 棋盘居中。3D 走各自的视图，不需要这里的视口。 */
  const n2d = axisLen(doc, 0);
  useEffect(() => {
    if (is3D) return;
    const el = planeRef.current;
    if (!el) return;
    const { w, h } = boardMetrics(n2d);
    const r = el.getBoundingClientRect();
    const z = Math.min(0.9, (r.width - 60) / w, (r.height - 60) / h);
    useStore.getState().setViewport({ z: Math.max(0.3, z), x: (r.width - w * z) / 2, y: (r.height - h * z) / 2 });
    // 只在尺寸变化时重新居中，编辑过程中不打断用户的平移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n2d, is3D]);

  const selKey = selection.length === 1 ? selection[0] : null;
  const selCell = selKey ? doc.cells[selKey] : null;

  const filled = useMemo(
    () => Object.values(doc.cells).filter((c) => c.answers.length > 0 || c.guess).length,
    [doc],
  );
  const total = cellCount(doc);

  if (missing) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="mb-4 text-lead text-ink-dim">找不到这套题。</p>
          <Button variant="solid" onClick={() => navigate("/")}>
            回首页
          </Button>
        </div>
      </div>
    );
  }

  const share = async () => {
    const url = gridUrl(doc.id);
    try {
      await navigator.clipboard.writeText(url);
      notify("链接已复制，发给别人就能玩");
    } catch {
      notify(url);
    }
  };

  const aside = (
    <>
      <Inspector
        doc={doc}
        setMeta={setMeta}
        setSize={setSize}
        setDims={setDims}
        setAxisLabel={setAxisLabel}
        setAxisValue={setAxisValue}
      />
      {editsAnswers && selCell && selKey && (
        <Answers
          answers={selCell.answers}
          cellLabel={selKey}
          onAdd={(t) => addAnswer(selKey, t)}
          onUpdate={(aid, patch) => updateAnswer(selKey, aid, patch)}
          onRemove={(aid) => removeAnswer(selKey, aid)}
        />
      )}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      {/* 工具条 */}
      <div className="glass z-20 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2.5 sm:px-4">
        <Segmented
          size="sm"
          value={preview ? "play" : "edit"}
          onChange={(v) => setPreview(v === "play")}
          options={[
            { value: "edit", label: "编辑" },
            { value: "play", label: "预览" },
          ]}
        />
        {is3D && (
          <Segmented
            size="sm"
            value={cubeView ? "cube" : "flat"}
            onChange={(v) => setCubeView(v === "cube")}
            options={[
              { value: "flat", label: "平面层" },
              { value: "cube", label: "立方体" },
            ]}
          />
        )}
        <span className="text-tiny text-ink-faint">
          {filled}/{total} 格{editsAnswers ? "已设答案" : "已填"}
        </span>
        <span className={`text-micro ${saved ? "text-ink-faint" : "text-warn"}`}>{saved ? "草稿已存" : "保存中…"}</span>

        <div className="ml-auto flex items-center gap-1.5">
          <div className="hidden items-center gap-1.5 sm:flex">
            <Button size="sm" variant="ghost" onClick={undo} disabled={!canUndo}>
              ↶
            </Button>
            <Button size="sm" variant="ghost" onClick={redo} disabled={!canRedo}>
              ↷
            </Button>
          </div>
          <Button size="sm" variant="outline" onClick={share}>
            复制链接
          </Button>
          <Button size="sm" variant="solid" onClick={() => navigate(`/grid/${doc.id}`)}>
            开始游玩
          </Button>
          <Button size="sm" variant="outline" className="lg:hidden" onClick={() => setPanelOpen(true)}>
            设置
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {is3D ? (
          <div className="relative min-w-0 flex-1 overflow-y-auto">
            {cubeView ? (
              <div className="relative h-full min-h-[420px]">
                <Cube3D doc={doc} mode={preview ? "play" : "edit"} space={space} />
                <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                  <div className="glass pointer-events-auto flex items-center gap-3 rounded-pill px-3 py-1.5 text-micro text-ink-dim">
                    <span>分离</span>
                    <input
                      type="range"
                      min={MIN_SPACE}
                      max={MAX_SPACE}
                      value={space}
                      onChange={(e) => setSpace(Number(e.target.value))}
                      className="w-28 accent-axis1"
                      aria-label="方块间距"
                    />
                    <span className="text-ink-faint">拖拽旋转 · 滚轮缩放</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-3xl px-4 py-6">
                <Flat3D doc={doc} mode={preview ? "play" : "edit"} />
              </div>
            )}
            <div className="pointer-events-none absolute left-4 top-3 z-10 flex flex-col items-start gap-2">
              <AxisLegend doc={doc} />
              {!preview && (
                <Card className="py-2">
                  <p className="text-tiny text-ink-dim">
                    {editsAnswers
                      ? "点一个格子设置它的正确答案 · 右侧改三条轴的特质"
                      : "点一个格子后到右边「三条轴」里改条件；开放造词模式没有预设答案"}
                  </p>
                </Card>
              )}
            </div>
          </div>
        ) : (
          <div ref={planeRef} className="relative min-w-0 flex-1">
            <CanvasPlane onBackgroundClick={() => useStore.getState().clearSelection()}>
              <Board doc={doc} mode={preview ? "play" : "edit"} />
            </CanvasPlane>
            {!preview && selection.length === 0 && (
              <div className="pointer-events-none absolute left-4 top-4 z-10">
                <Card className="py-2">
                  <p className="text-tiny text-ink-dim">点一个格子开始设置它的正确答案 · 拖动可换位 · Shift 拖拽框选</p>
                </Card>
              </div>
            )}
            {selection.length > 1 && (
              <div className="absolute left-4 top-4 z-10">
                <Card className="py-2">
                  <p className="text-tiny text-ink-dim">
                    已选 {selection.length} 格 · Delete 清空 · 方向键组合拖动换位
                  </p>
                </Card>
              </div>
            )}
          </div>
        )}

        {/* 设置面板：桌面常驻，移动端收进抽屉 */}
        <aside className="hidden w-[350px] shrink-0 overflow-y-auto border-l border-line bg-surface/40 p-3 lg:block">
          {aside}
        </aside>
      </div>

      <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title="题目设置" wide>
        {aside}
      </Sheet>
    </div>
  );
}

/* ---------------- 题目设置 ---------------- */

type InspectorProps = {
  doc: GridDoc;
  setMeta: (
    patch: { title?: string; description?: string; status?: GridStatus; similarSearch?: boolean; judgeMode?: JudgeMode },
    label: string,
  ) => void;
  setSize: (s: GridSize) => void;
  setDims: (d: 2 | 3, judgeMode?: JudgeMode) => void;
  setAxisLabel: (axis: number, label: string) => void;
  setAxisValue: (axis: number, index: number, label: string) => void;
};

/** 两条轴的题叫「行/列」，三条轴叫「X/Y/Z」—— 同一个概念的两种叫法，按维度切换。 */
const AXIS_NAMES = [
  { short: "列", tag: "X", hint: "横向排列，每列一个", color: "axis1" },
  { short: "行", tag: "Y", hint: "纵向排列，每行一个", color: "axis2" },
  { short: "层", tag: "Z", hint: "纵深分三层，每层一个", color: "axis3" },
];
const AXIS_NAMES_3D = [
  { short: "X 轴", tag: "X", hint: "横向", color: "axis1" },
  { short: "Y 轴", tag: "Y", hint: "纵向", color: "axis2" },
  { short: "Z 轴", tag: "Z", hint: "纵深 · 决定分几层", color: "axis3" },
];

function Inspector({ doc, setMeta, setSize, setDims, setAxisLabel, setAxisValue }: InspectorProps) {
  const [confirmSize, setConfirmSize] = useState<GridSize | null>(null);
  const [confirmDims, setConfirmDims] = useState<2 | 3 | null>(null);

  const dims = dimsOf(doc);
  const is3D = dims === 3;
  const n = axisLen(doc, 0);
  const names = is3D ? AXIS_NAMES_3D : AXIS_NAMES;
  const hasContent = Object.values(doc.cells).some((c) => c.answers.length > 0 || c.guess);

  const switchDims = (target: 2 | 3) => {
    if (target === dims) return;
    /* 2D → 3D 会把已有格子对齐到第 1 层保留；3D → 2D 只留第 1 层。
       有内容时先问一声，因为后者是有损的。 */
    if (hasContent) setConfirmDims(target);
    else setDims(target, target === 3 ? "open" : "answers");
  };

  return (
    <div className="space-y-3">
      <Card>
        <h3 className="mb-3 text-small font-semibold">题面</h3>
        <div className="space-y-3">
          <Field label="标题" value={doc.title} onChange={(e) => setMeta({ title: e.target.value }, "改标题")} placeholder="给这套题起个名字" />
          <Field
            label="描述"
            value={doc.description}
            onChange={(e) => setMeta({ description: e.target.value }, "改描述")}
            placeholder="一句话说明玩法或主题"
          />

          <div>
            <span className="mb-1.5 block text-tiny font-medium text-ink-dim">维度</span>
            <Segmented
              size="sm"
              value={String(dims)}
              onChange={(v) => switchDims(Number(v) as 2 | 3)}
              options={[
                { value: "2", label: "2D · 行 × 列" },
                { value: "3", label: "3D · 三轴 27 格" },
              ]}
            />
          </div>

          {!is3D && (
            <div>
              <span className="mb-1.5 block text-tiny font-medium text-ink-dim">尺寸</span>
              <div className="flex gap-1.5">
                {GRID_SIZES.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      if (s < n && hasContent) setConfirmSize(s);
                      else setSize(s);
                    }}
                    className={`h-8 flex-1 rounded-lg border text-tiny font-medium transition ${
                      s === n ? "border-axis1/60 bg-axis1/15 text-ink" : "border-line text-ink-faint hover:text-ink"
                    }`}
                  >
                    {s}×{s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="mb-1.5 block text-tiny font-medium text-ink-dim">判定方式</span>
            <Segmented
              size="sm"
              value={doc.judgeMode}
              onChange={(v) => setMeta({ judgeMode: v }, "改判定方式")}
              options={[
                { value: "answers", label: JUDGE_MODE_LABEL.answers },
                { value: "open", label: JUDGE_MODE_LABEL.open },
              ]}
            />
            <p className="mt-1.5 text-micro text-ink-faint">
              {doc.judgeMode === "answers"
                ? "每格由你预设答案，玩家猜；走精确 / 别名 / 同义词匹配，不需要联网。"
                : "不设标准答案，玩家自己造词；由 AI 判是否符合三条特质并给冷门度。"}
            </p>
          </div>

          <div>
            <span className="mb-1.5 block text-tiny font-medium text-ink-dim">发布状态</span>
            <Segmented
              size="sm"
              value={doc.status}
              onChange={(v) => setMeta({ status: v }, "改发布状态")}
              options={(["draft", "private", "unlisted", "public"] as GridStatus[]).map((s) => ({
                value: s,
                label: GRID_STATUS_LABEL[s],
              }))}
            />
          </div>

          {doc.judgeMode === "answers" && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-black/20 p-3">
              <input
                type="checkbox"
                checked={doc.similarSearch}
                onChange={(e) => setMeta({ similarSearch: e.target.checked }, "切换相似搜索")}
                className="mt-0.5 h-4 w-4 accent-axis1"
              />
              <span>
                <span className="block text-small font-medium">开启相似搜索</span>
                <span className="block text-micro text-ink-faint">接受别名与同义词；关闭则只认完全一致的答案。</span>
              </span>
            </label>
          )}
        </div>
      </Card>

      {doc.judgeMode === "open" && <JudgeSettings />}

      {/* 轴编辑：2D 两条、3D 三条，同一套 UI —— 维度只是轴的条数 */}
      {doc.axes.map((axis, a) => {
        const meta = names[a] ?? names[0];
        return (
          <Card key={a}>
            <div className="mb-1 flex items-center gap-2">
              <span className={`grid h-5 w-5 place-items-center rounded-md bg-${meta.color}/20 text-micro font-bold text-${meta.color}`}>
                {meta.tag}
              </span>
              <h3 className="text-small font-semibold">{meta.short}</h3>
              <span className="ml-auto text-micro text-ink-faint">{meta.hint}</span>
            </div>
            <input
              value={axis.label}
              onChange={(e) => setAxisLabel(a, e.target.value)}
              className="mb-2 h-8 w-full rounded-lg border border-line bg-black/25 px-2.5 text-small font-medium outline-none transition focus:border-line-strong"
              placeholder="这条轴叫什么（如「尺寸」「能吃」）"
            />
            <div className="space-y-2">
              {axis.values.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white/[0.06] text-micro font-semibold text-ink-faint">
                    {i + 1}
                  </span>
                  <input
                    value={v}
                    onChange={(e) => setAxisValue(a, i, e.target.value)}
                    className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/25 px-2.5 text-small outline-none transition focus:border-axis1/60"
                    placeholder={`第 ${i + 1} 个特质`}
                  />
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      <Sheet
        open={confirmSize !== null}
        onClose={() => setConfirmSize(null)}
        title="缩小尺寸会丢弃内容"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmSize(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmSize) setSize(confirmSize);
                setConfirmSize(null);
              }}
            >
              继续缩小
            </Button>
          </>
        }
      >
        <p className="text-small text-ink-dim">
          改成 {confirmSize}×{confirmSize} 会删掉超出范围的格子及其答案，且这一步可以撤销。
        </p>
      </Sheet>

      <Sheet
        open={confirmDims !== null}
        onClose={() => setConfirmDims(null)}
        title={confirmDims === 2 ? "改回 2D 会丢掉两层" : "升级成 3D"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDims(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDims) setDims(confirmDims, confirmDims === 3 ? "open" : "answers");
                setConfirmDims(null);
              }}
            >
              继续
            </Button>
          </>
        }
      >
        <p className="text-small text-ink-dim">
          {confirmDims === 2
            ? `改回 2D 只保留第 1 层的 ${sizeLabel({ axes: doc.axes.slice(0, 2) })} 共 ${axisLen(doc, 0) * axisLen(doc, 1)} 格，另外两层的内容会丢失。这一步可以撤销。`
            : `升级成 3D 会新增两层，已有内容保留在第 1 层。同时判定方式切到「开放造词」—— 27 格预设答案负担太重。`}
        </p>
      </Sheet>
    </div>
  );
}

/* ---------------- 格子答案 ---------------- */

function Answers({
  answers,
  cellLabel,
  onAdd,
  onUpdate,
  onRemove,
}: {
  answers: CellAnswer[];
  cellLabel: string;
  onAdd: (text: string) => void;
  onUpdate: (id: string, patch: Partial<CellAnswer>) => void;
  onRemove: (id: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const list = (s: string) =>
    s
      .split(/[,，、\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  return (
    <Card className="mt-3">
      <h3 className="mb-1 text-small font-semibold">格子的正确答案</h3>
      <p className="mb-3 text-micro text-ink-faint">
        选中的是 <span className="font-mono text-ink-dim">{cellLabel}</span>。可填多个；别名用于缩写/译名（MC → Minecraft），
        同义词用于不同的说法。
      </p>

      <div className="space-y-2">
        {answers.map((a) => (
          <div key={a.id} className="rounded-xl border border-line bg-black/20 p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={a.text}
                onChange={(e) => onUpdate(a.id, { text: e.target.value })}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/30 px-2.5 text-small font-medium outline-none focus:border-ok/60"
                placeholder="主答案"
              />
              <button
                onClick={() => onRemove(a.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-faint transition hover:bg-bad/15 hover:text-bad"
                aria-label={`删除答案 ${a.text}`}
              >
                ✕
              </button>
            </div>
            <input
              value={a.aliases.join("、")}
              onChange={(e) => onUpdate(a.id, { aliases: list(e.target.value) })}
              className="mt-1.5 h-7 w-full rounded-lg border border-line bg-black/20 px-2.5 text-micro outline-none focus:border-axis1/50"
              placeholder="别名，逗号分隔（MC、麦块）"
            />
            <input
              value={a.synonyms.join("、")}
              onChange={(e) => onUpdate(a.id, { synonyms: list(e.target.value) })}
              className="mt-1.5 h-7 w-full rounded-lg border border-line bg-black/20 px-2.5 text-micro outline-none focus:border-axis2/50"
              placeholder="同义词，逗号分隔（我的世界）"
            />
            <input
              value={a.note ?? ""}
              onChange={(e) => onUpdate(a.id, { note: e.target.value })}
              className="mt-1.5 h-7 w-full rounded-lg border border-line bg-black/20 px-2.5 text-micro outline-none focus:border-line-strong"
              placeholder="答案描述（可选，显示在结果里）"
            />
            <input
              value={a.image ?? ""}
              onChange={(e) => onUpdate(a.id, { image: e.target.value })}
              className="mt-1.5 h-7 w-full rounded-lg border border-line bg-black/20 px-2.5 text-micro outline-none focus:border-line-strong"
              placeholder="配图 URL（可选）"
            />
          </div>
        ))}
      </div>

      <div className="mt-2.5 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-black/25 px-2.5 text-small outline-none focus:border-ok/60"
          placeholder="加一个答案，回车确认"
        />
        <Button
          size="sm"
          onClick={() => {
            if (draft.trim()) {
              onAdd(draft.trim());
              setDraft("");
            }
          }}
        >
          添加
        </Button>
      </div>
    </Card>
  );
}
