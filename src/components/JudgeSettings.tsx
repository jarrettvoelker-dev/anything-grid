import { useState } from "react";
import { isJudgeReady, judgeEntry, type JudgeConfig } from "../lib/judge";
import { useStore } from "../state/store";
import { Button, Card, Field } from "./ui";

/* AI 裁判设置。**开放造词模式没有标准答案**，判定必须由模型来做 —— 所以这里填的是
   **玩家自己的**接口（BYOK）。这不是偷懒：开放模式下题目里不存在正确答案，
   玩家的 key 能拿到的只有「特质组合 + 他自己刚敲的词」，没有任何可泄露的东西。
   （预设答案模式正相反，答案要藏，判定得走创建者/服务端那一侧。） */

const PRESETS: { name: string; base: string; model: string }[] = [
  { name: "DeepSeek", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  { name: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "智谱 GLM", base: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
];

export function JudgeSettings() {
  const cfg = useStore((s) => s.judgeConfig);
  const setJudgeConfig = useStore((s) => s.setJudgeConfig);
  const notify = useStore((s) => s.notify);

  const [draft, setDraft] = useState<JudgeConfig>(cfg);
  const [testing, setTesting] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const dirty =
    draft.base !== cfg.base || draft.model !== cfg.model || draft.key !== cfg.key;

  const test = async () => {
    setTesting(true);
    try {
      const r = await judgeEntry(draft, "轴 X：会飞的 ｜ 轴 Y：家里能养的 ｜ 轴 Z：不是生物", "鹦鹉");
      notify(r.ok === null ? `没通过：${r.reason}` : `通了 —— 判定「鹦鹉」${r.ok ? "符合" : "不符"}，冷门度 ${r.rarity}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-small font-semibold">AI 裁判</h3>
        <span
          className={`ml-auto rounded-pill px-2 py-0.5 text-micro ${
            isJudgeReady(cfg) ? "bg-ok/15 text-ok" : "bg-white/[0.06] text-ink-faint"
          }`}
        >
          {isJudgeReady(cfg) ? "已配置" : "未配置"}
        </span>
      </div>
      <p className="mb-3 text-micro text-ink-faint">
        开放造词没有标准答案，判定由模型来。填<span className="text-ink-dim">你自己的</span>接口和 key ——
        key 只存在这台设备的浏览器里，不会上传，也不会发给除你填的这个地址以外的任何地方。
      </p>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.name}
              onClick={() => setDraft({ ...draft, base: p.base, model: p.model })}
              className={`h-7 rounded-pill border px-2.5 text-micro transition ${
                draft.base === p.base
                  ? "border-axis1/60 bg-axis1/15 text-ink"
                  : "border-line text-ink-faint hover:text-ink-dim"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        <Field
          label="接口地址"
          value={draft.base}
          onChange={(e) => setDraft({ ...draft, base: e.target.value })}
          placeholder="https://api.deepseek.com/v1"
          hint="OpenAI 兼容的 chat/completions 接口，末尾不加 /chat/completions"
          autoComplete="off"
        />
        <Field
          label="模型"
          value={draft.model}
          onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          placeholder="deepseek-chat"
          autoComplete="off"
        />
        <Field
          label="API Key"
          type={showKey ? "text" : "password"}
          value={draft.key}
          onChange={(e) => setDraft({ ...draft, key: e.target.value })}
          placeholder="sk-…"
          hint="只存本机 localStorage。换设备要重填。"
          autoComplete="off"
        />

        <label className="flex cursor-pointer items-center gap-2 text-tiny text-ink-dim">
          <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} className="h-3.5 w-3.5 accent-axis1" />
          显示 key
        </label>

        <div className="flex gap-2">
          <Button size="sm" variant="solid" disabled={!dirty} onClick={() => setJudgeConfig(draft)}>
            保存
          </Button>
          <Button size="sm" variant="outline" disabled={!isJudgeReady(draft) || testing} onClick={test}>
            {testing ? "测试中…" : "测试连接"}
          </Button>
          {isJudgeReady(cfg) && (
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                const empty = { base: "", model: "", key: "" };
                setJudgeConfig(empty);
                setDraft(empty);
                notify("已清除本机的裁判配置");
              }}
            >
              清除
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
