/* 线上验收：用 CDP 在真浏览器里驱动**已部署的站点**，而不是本地构建。

   为什么需要它：本地 E2E 证明的是"源码对"，`curl` 证明的是"文件传上去了"，
   两者都证明不了"用户打开那个网址时东西真的能用"。这里补上最后一段。

   重点是两条最危险的路径：
   1. 老用户的 v1 存档（M1 时期的 rows/cols 结构）在线上能不能迁移 —— 迁不动就是丢档。
   2. 3D 题的立方体与平面层在部署产物里是否真的渲染出来。

   用法：node scripts/verify_live.mjs [站点根 URL] */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "https://jarrettvoelker-dev.github.io/anything-grid").replace(/\/+$/, "");
const EDGE = "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const PORT = 9333;

const R = [];
const ok = (name, cond, extra) =>
  R.push(`${cond ? "PASS" : "FAIL"} :: ${name}${extra !== undefined ? `  [${extra}]` : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 启动浏览器并接上 CDP ---------- */
const profile = `/tmp/ag-live-${Date.now()}`;
const edge = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "aglive-"))}`,
    "about:blank",
  ],
  { stdio: "ignore", detached: false },
);
void profile;

let wsUrl = null;
for (let i = 0; i < 40 && !wsUrl; i++) {
  await sleep(500);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
  } catch {
    /* 浏览器还没起来 */
  }
}
if (!wsUrl) {
  console.error("连不上浏览器调试端口");
  edge.kill();
  process.exit(1);
}

const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { res, rej } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
  });

/**
 * 在页面里求值。
 * 页面里抛的异常会被包成 {__err} 带回来 —— 这里必须**重新抛出去**。
 * 否则 `{__err:...}` 是个真值对象，`ok(名字, cond)` 会把"元素根本不存在"
 * 判成 PASS（这个假阳性真的发生过，别改回去）。
 */
async function evalInPage(body) {
  const r = await send("Runtime.evaluate", {
    expression: `(() => { try { return JSON.stringify(${body}) } catch (e) { return JSON.stringify({ __err: String(e) }) } })()`,
    returnByValue: true,
    awaitPromise: true,
  });
  /* 语法错误发生在整个表达式上，进不了我们的 try —— 得单独认。
     以前这里不认，结果种子语句没跑成，后面一路"查不到元素"却看不出为什么。 */
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  const v = r.result?.value;
  if (v === undefined) return undefined; // 语句没有返回值（如 .click()）—— 正常
  const parsed = JSON.parse(v);
  if (parsed && typeof parsed === "object" && "__err" in parsed) throw new Error(parsed.__err);
  return parsed;
}

/** 求单个表达式的值 */
const js = evalInPage;

/** 跑一段语句（多行、带副作用）。自动补 return，省得每处都写 IIFE。 */
const run = (stmts) => evalInPage(`(() => { ${stmts} })()`);

/** 轮询直到表达式为真 */
async function until(expr, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await js(expr)) return true;
    await sleep(250);
  }
  return false;
}

async function open(path) {
  await send("Page.navigate", { url: BASE + path });
  await until(`document.readyState === "complete"`, 20000);
  await sleep(1200);
}

try {
  await send("Page.enable");
  await send("Runtime.enable");

  /* ---------- 1. 首页 ---------- */
  await open("/");
  ok("L1 线上首页渲染出内容", await js(`!!document.querySelector("#root > *")`));
  ok("L2 首页有 3D 入口与 3D 示例", await js(`document.body.textContent.includes("新建 3D 题") && document.body.textContent.includes("三维 · 物理三轴")`));

  /* ---------- 2. v1 存档迁移（最危险的一条） ---------- */
  const v1 = {
    v: 1, id: "livelegacy", title: "老存档", description: "", size: 2,
    rows: [{ label: "能吃" }, { label: "不能吃" }],
    cols: [{ label: "圆" }, { label: "方" }],
    cells: {
      "0,0": { x: 0, y: 0, status: "correct", guess: "橙子", answers: [{ id: "a", text: "橙子", aliases: ["橙"], synonyms: [] }] },
      "1,1": { x: 1, y: 1, status: "empty", answers: [{ id: "b", text: "书", aliases: [], synonyms: [] }] },
    },
    similarSearch: true, status: "unlisted", updatedAt: 0,
  };
  await run(`
    localStorage.setItem("ag.doc.livelegacy", ${JSON.stringify(JSON.stringify(v1))});
    return !!localStorage.getItem("ag.doc.livelegacy");
  `);
  await open("/grid/livelegacy");
  ok("L3 v1 老存档在线上被迁移并打开", await js(`document.body.textContent.includes("老存档")`));
  ok("L4 迁移后行列条件还在", await js(`document.body.textContent.includes("能吃") && document.body.textContent.includes("方")`));
  const cells2d = await js(`document.querySelectorAll("[data-cell]").length`);
  ok("L5 迁移后仍是 2×2 的 4 格", cells2d === 4, `count=${cells2d}`);
  ok("L6 迁移保留了老存档里已填的作答", await js(`document.body.textContent.includes("橙子")`));

  /* ---------- 3. 线上 3D 题的两种视图 ---------- */
  const d3 = {
    v: 2, id: "live3d", title: "线上三维", description: "", judgeMode: "open",
    axes: [
      { label: "尺寸", values: ["极小", "常规", "巨大"] },
      { label: "速度", values: ["静止", "中速", "极快"] },
      { label: "危险", values: ["无害", "有风险", "致命"] },
    ],
    cells: {}, similarSearch: false, status: "unlisted", updatedAt: 0,
  };
  for (let z = 0; z < 3; z++)
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) d3.cells[`${x},${y},${z}`] = { x, y, z, answers: [], status: "empty" };
  await run(`
    localStorage.removeItem("ag.judge.v1");
    localStorage.setItem("ag.doc.live3d", ${JSON.stringify(JSON.stringify(d3))});
    return !!localStorage.getItem("ag.doc.live3d");
  `);
  await open("/grid/live3d");

  ok("L7 线上三维题渲染出立方体", await js(`!!document.querySelector('[data-cube="1"]')`));
  const n3 = await js(`document.querySelectorAll("[data-cell]").length`);
  ok("L8 立方体有 27 个方块", n3 === 27, `count=${n3}`);
  const faces = await js(`document.querySelectorAll(".ag3d-face").length`);
  ok("L9 每个方块 6 个面（共 162）", faces === 162, `faces=${faces}`);
  /* CSS 3D 要靠 preserve-3d 才成立；这条同时证明 3D 那段样式进了线上的 CSS */
  ok(
    "L10 立方体真的应用了 preserve-3d",
    await js(`getComputedStyle(document.querySelector(".ag3d-world")).transformStyle === "preserve-3d"`),
  );
  ok("L11 立方体视图显示三条轴图例", await js(`document.body.textContent.includes("尺寸") && document.body.textContent.includes("致命")`));

  /* 开放模式 + 没配裁判 → 判定失败，且不能被画成"答错" */
  await js(`document.querySelector('[data-cell="0,0,0"]').dispatchEvent(new PointerEvent("pointerup", { bubbles: true }))`);
  await sleep(400);
  await run(`
    const el = document.querySelector('input[placeholder*="同时符合"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(el, "测试词");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return el.value;
  `);
  await sleep(900);
  const cls = await js(`document.querySelector('[data-cell="0,0,0"]').className`);
  ok("L12 没配裁判时是「判定失败」而不是「答错」", String(cls).includes("is-err") && !String(cls).includes("is-bad"), cls);

  /* 切平面层 */
  await js(`([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "平面层")).click()`);
  await sleep(600);
  const nf = await js(`document.querySelectorAll("[data-cell]").length`);
  const nl = await js(`document.querySelectorAll("[data-layer]").length`);
  ok("L13 线上平面层一次 9 格 + 3 个层页签", nf === 9 && nl === 3, `cells=${nf} layers=${nl}`);
  /* 这条要在切层**之前**查 —— 切到第 3 层后第 1 层的格子就不在 DOM 里了 */
  ok(
    "L14 平面层与立方体共用同一份作答",
    await js(`document.querySelector('[data-cell="0,0,0"]').textContent.includes("测试词")`),
  );
  await js(`document.querySelector('[data-layer="2"]').click()`);
  await sleep(500);
  ok(
    "L15 切到第 3 层看到的是 z=2 的格子，且 z=0 的已不在 DOM",
    (await js(`!!document.querySelector('[data-cell="0,0,2"]')`)) &&
      (await js(`!document.querySelector('[data-cell="0,0,0"]')`)),
  );
} catch (e) {
  R.push(`FAIL :: 异常 [${e?.message ?? e}]`);
} finally {
  for (const line of R) console.log(line);
  console.log(`\n@@SUMMARY@@ PASS=${R.filter((s) => s.startsWith("PASS")).length} FAIL=${R.filter((s) => s.startsWith("FAIL")).length}`);
  try {
    ws.close();
  } catch {
    /* 已经断了 */
  }
  edge.kill("SIGKILL");
}
process.exit(R.some((s) => s.startsWith("FAIL")) ? 1 : 0);
