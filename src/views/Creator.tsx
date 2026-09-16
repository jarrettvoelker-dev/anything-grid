import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "../components/CanvasPlane";
import { Board, boardMetrics } from "../components/Board";
import { Button, Card, Field, Segmented, Sheet } from "../components/ui";
import { loadDoc, newId, saveDoc } from "../lib/storage";
import { gridUrl, navigate } from "../lib/router";
import { GRID_SIZES, GRID_STATUS_LABEL, type CellAnswer, type GridSize, type GridStatus } from "../lib/types";
import { createDoc, useStore } from "../state/store";

export function Creator({ id }: { id?: string }) {
  const doc = useStore((s) => s.history.present);
  const resetHistory = useStore((s) => s.resetHistory);
  const replaceDoc = useStore((s) => s.replaceDoc);
  const setMeta = useStore((s) => s.setMeta);
  const setSize = useStore((s) => s.setSize);
  const setRowLabel = useStore((s) => s.setRowLabel);
  const setColLabel = useStore((s) => s.setColLabel);
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

  /* 载入：编辑已有题，或开一套新的 */
  useEffect(() => {
    if (!id) {
      resetHistory({ ...createDoc(3), id: newId() });
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

  /* 棋盘居中 */
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;
    const { w, h } = boardMetrics(doc.size);
    const r = el.getBoundingClientRect();
    const z = Math.min(0.9, (r.width - 60) / w, (r.height - 60) / h);
    useStore.getState().setViewport({ z: Math.max(0.3, z), x: (r.width - w * z) / 2, y: (r.height - h * z) / 2 });
    // 只在尺寸变化时重新居中，编辑过程中不打断用户的平移
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.size]);

  const selKey = selection.length === 1 ? selection[0] : null;
  const selCell = selKey ? doc.cells[selKey] : null;

  const filled = useMemo(
    () => Object.values(doc.cells).filter((c) => c.answers.length > 0).length,
    [doc],
  );
  const total = doc.size * doc.size;

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
        <span className="text-tiny text-ink-faint">
          {filled}/{total} 格已设答案
        </span>
        <span className={`text-micro ${saved ? "text-ink-faint" : "text-warn"}`}>
          {saved ? "草稿已存" : "保存中…"}
        </span>

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
        {/* 画布 */}
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

        {/* 设置面板：桌面常驻，移动端收进抽屉 */}
        <aside className="hidden w-[350px] shrink-0 overflow-y-auto border-l border-line bg-surface/40 p-3 lg:block">
          <Inspector
            doc={doc}
            selKey={selKey}
            setMeta={setMeta}
            setSize={setSize}
            setRowLabel={setRowLabel}
            setColLabel={setColLabel}
            replaceDoc={replaceDoc}
          />
          {selCell && selKey && (
            <Answers
              answers={selCell.answers}
              onAdd={(t) => addAnswer(selCell.x, selCell.y, t)}
              onUpdate={(aid, patch) => updateAnswer(selCell.x, selCell.y, aid, patch)}
              onRemove={(aid) => removeAnswer(selCell.x, selCell.y, aid)}
            />
          )}
        </aside>
      </div>

      <Sheet open={panelOpen} onClose={() => setPanelOpen(false)} title="题目设置" wide>
        <Inspector
          doc={doc}
          selKey={selKey}
          setMeta={setMeta}
          setSize={setSize}
          setRowLabel={setRowLabel}
          setColLabel={setColLabel}
          replaceDoc={replaceDoc}
        />
        {selCell && selKey && (
          <Answers
            answers={selCell.answers}
            onAdd={(t) => addAnswer(selCell.x, selCell.y, t)}
            onUpdate={(aid, patch) => updateAnswer(selCell.x, selCell.y, aid, patch)}
            onRemove={(aid) => removeAnswer(selCell.x, selCell.y, aid)}
          />
        )}
      </Sheet>
    </div>
  );
}

/* ---------------- 题目设置 ---------------- */

type InspectorProps = {
  doc: ReturnType<typeof createDoc>;
  selKey: string | null;
  setMeta: (patch: { title?: string; description?: string; status?: GridStatus; similarSearch?: boolean }, label: string) => void;
  setSize: (s: GridSize) => void;
  setRowLabel: (i: number, v: string) => void;
  setColLabel: (i: number, v: string) => void;
  replaceDoc: (doc: ReturnType<typeof createDoc>, label: string, coalesce?: boolean) => void;
};

function Inspector({ doc, setMeta, setSize, setRowLabel, setColLabel }: InspectorProps) {
  const [confirmSize, setConfirmSize] = useState<GridSize | null>(null);

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
            <span className="mb-1.5 block text-tiny font-medium text-ink-dim">尺寸</span>
            <div className="flex gap-1.5">
              {GRID_SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (s < doc.size && Object.values(doc.cells).some((c) => c.answers.length > 0)) setConfirmSize(s);
                    else setSize(s);
                  }}
                  className={`h-8 flex-1 rounded-lg border text-tiny font-medium transition ${
                    s === doc.size ? "border-axis1/60 bg-axis1/15 text-ink" : "border-line text-ink-faint hover:text-ink"
                  }`}
                >
                  {s}×{s}
                </button>
              ))}
            </div>
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

          <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-black/20 p-3">
            <input
              type="checkbox"
              checked={doc.similarSearch}
              onChange={(e) => setMeta({ similarSearch: e.target.checked }, "切换相似搜索")}
              className="mt-0.5 h-4 w-4 accent-axis1"
            />
            <span>
              <span className="block text-small font-medium">开启相似搜索</span>
              <span className="block text-micro text-ink-faint">
                接受别名与同义词；关闭则只认完全一致的答案。
              </span>
            </span>
          </label>
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 text-small font-semibold">行条件</h3>
        <p className="mb-3 text-micro text-ink-faint">纵向排列，每行一个</p>
        <div className="space-y-2">
          {doc.rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-axis2/20 text-micro font-semibold text-axis2">
                {i + 1}
              </span>
              <input
                value={r.label}
                onChange={(e) => setRowLabel(i, e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/25 px-2.5 text-small outline-none transition focus:border-axis2/60"
                placeholder={`第 ${i + 1} 行的条件`}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="mb-1 text-small font-semibold">列条件</h3>
        <p className="mb-3 text-micro text-ink-faint">横向排列，每列一个</p>
        <div className="space-y-2">
          {doc.cols.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-axis1/20 text-micro font-semibold text-axis1">
                {i + 1}
              </span>
              <input
                value={c.label}
                onChange={(e) => setColLabel(i, e.target.value)}
                className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-black/25 px-2.5 text-small outline-none transition focus:border-axis1/60"
                placeholder={`第 ${i + 1} 列的条件`}
              />
            </div>
          ))}
        </div>
      </Card>

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
    </div>
  );
}

/* ---------------- 格子答案 ---------------- */

function Answers({
  answers,
  onAdd,
  onUpdate,
  onRemove,
}: {
  answers: CellAnswer[];
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
      <h3 className="mb-1 text-small font-semibold">这一格的正确答案</h3>
      <p className="mb-3 text-micro text-ink-faint">
        可填多个。别名用于缩写/译名（MC → Minecraft），同义词用于不同的说法。
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
