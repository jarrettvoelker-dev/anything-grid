#!/usr/bin/env bash
# 发布到 GitHub Pages（gh-pages 分支）。
#
#   bash scripts/deploy.sh
#
# 为什么不用 GitHub Actions：本机 gh token 没有 workflow 作用域，推不了 .github/workflows。
# 所以走「本地构建 + 推产物」这条路。仓库里 dist/ 是 gitignore 的，
# 下面是在 dist 里另起一个仓库推到 gh-pages 分支，与源码仓库互不干扰。
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO="https://github.com/jarrettvoelker-dev/anything-grid.git"
SLUG="anything-grid"

cd "$DIR"
VITE_BASE="/$SLUG/" npm run build

cd dist
rm -rf .git
git init -q -b gh-pages
git add -A
git -c user.email="noreply@github.com" -c user.name="deploy" commit -q -m "deploy: $(date '+%Y-%m-%d %H:%M')"
git remote add origin "$REPO"
git push -q --force origin gh-pages

echo "已推送 gh-pages，等待 Pages 构建…"
for _ in $(seq 1 30); do
  [ "$(gh api "repos/jarrettvoelker-dev/$SLUG/pages" --jq .status 2>/dev/null)" = "built" ] && break
  sleep 10
done
echo "线上地址：https://jarrettvoelker-dev.github.io/$SLUG/"
