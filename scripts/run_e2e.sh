#!/usr/bin/env bash
# 端到端测试：零依赖，只用到 Windows 自带的 Edge。
#
#   bash scripts/run_e2e.sh
#
# 坑（都踩过）：
#  1. --virtual-time-budget 碰到页面里的 setInterval 会挂死，用例写成同步/显式 sleep。
#  2. Edge 跑完 --dump-dom 不保证自己退出，外面套 timeout，读输出文件而不是看退出码。
#  3. --dump-dom 只导出顶层文档，进不去 iframe —— 所以用例把结果写回父页面。
#  4. pkill -f msedge 会连自己这条 shell 一起杀掉（命令行里含 msedge），要写 "[m]sedge"。
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
EDGE="/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
PORT="${PORT:-8799}"

cd "$DIR"
npm run build >/dev/null 2>&1 || { echo "构建失败"; exit 1; }
cp scripts/e2e.html dist/__e2e.html

npx vite preview --port "$PORT" --strictPort --host 127.0.0.1 >/tmp/ag-preview.log 2>&1 &
PREVIEW=$!
trap 'kill $PREVIEW 2>/dev/null' EXIT
sleep 3

OUT="$(mktemp)"
timeout 180 "$EDGE" --headless=new --disable-gpu --no-sandbox \
  --user-data-dir="C:\\tmp\\ag-e2e-$$" --virtual-time-budget=30000 --dump-dom \
  "http://127.0.0.1:$PORT/__e2e.html" > "$OUT" 2>/dev/null

sed -n '/@@TEST_BEGIN@@/,/@@TEST_END@@/p' "$OUT"
rm -f "$OUT" dist/__e2e.html dist/__seed.html
