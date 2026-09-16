import { useEffect } from "react";
import { navigate, useRoute } from "./lib/router";
import { useStore } from "./state/store";
import { Button, Toaster } from "./components/ui";
import { Home } from "./views/Home";
import { Play } from "./views/Play";
import { Creator } from "./views/Creator";

export function App() {
  const route = useRoute();
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const selection = useStore((s) => s.selection);

  /* 全局快捷键。输入框里一律让路 —— 否则打字打到一半按 Ctrl+Z 会把整盘棋撤掉。 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable || t.tagName === "SELECT");
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "z") {
        if (typing && t?.tagName === "INPUT") return; // 输入框自己处理撤销
        e.preventDefault();
        e.shiftKey ? redo() : undo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && !typing && selection.length) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo, deleteSelected, selection.length]);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main className="min-h-0 flex-1">
        {route.name === "home" && <Home />}
        {route.name === "new" && <Creator key="new" />}
        {route.name === "edit" && <Creator key={route.id} id={route.id} />}
        {route.name === "play" && <Play key={route.id} id={route.id} />}
        {route.name === "notfound" && <NotFound path={route.path} />}
      </main>
      <Toaster />
    </div>
  );
}

function TopBar() {
  const route = useRoute();
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const undoText = useStore((s) => s.undoText);
  const redoText = useStore((s) => s.redoText);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);

  const iconBtn =
    "grid h-8 w-8 place-items-center rounded-lg border border-line bg-white/[0.03] text-ink-dim transition hover:border-line-strong hover:text-ink disabled:pointer-events-none disabled:opacity-30";

  return (
    <header className="glass z-30 flex h-14 shrink-0 items-center gap-3 border-b px-3 sm:px-4">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-2.5 rounded-lg px-1 py-1 transition hover:opacity-80"
        aria-label="回到首页"
      >
        <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-gradient-to-br from-axis1 to-axis2 text-base font-extrabold text-void">
          ▦
        </span>
        <span className="hidden text-small font-semibold tracking-tight sm:block">
          Anything <span className="text-axis1">Grid</span>
        </span>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <div className="hidden items-center gap-1.5 sm:flex">
          <button className={iconBtn} onClick={undo} disabled={!canUndo} title={undoText() ? `撤销：${undoText()}` : "撤销"} aria-label="撤销">
            ↶
          </button>
          <button className={iconBtn} onClick={redo} disabled={!canRedo} title={redoText() ? `重做：${redoText()}` : "重做"} aria-label="重做">
            ↷
          </button>
        </div>
        {(route.name === "play" || route.name === "edit") && (
          <Button size="sm" variant="outline" onClick={() => navigate(`/grid/${route.id}/edit`)} className="hidden sm:inline-flex">
            编辑这题
          </Button>
        )}
        <Button size="sm" variant="solid" onClick={() => navigate("/new")}>
          创建
        </Button>
      </div>
    </header>
  );
}

function NotFound({ path }: { path: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center">
      <div className="animate-fade-up">
        <div className="mb-3 text-hero">404</div>
        <p className="mb-5 text-base text-ink-dim">
          找不到 <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-small">{path}</code>
        </p>
        <Button variant="solid" onClick={() => navigate("/")}>
          回到首页
        </Button>
      </div>
    </div>
  );
}
