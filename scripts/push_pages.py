#!/usr/bin/env python3
"""把 dist/ 作为一个提交推到 gh-pages 分支 —— 走 GitHub 的 Git Data API，不走 git push。

为什么需要这条备用路径：某些网络环境下 github.com 的 HTTPS 直接被掐断
（GnuTLS recv error / TLS unexpected eof），而 api.github.com 是通的。
deploy.sh 先试 git push，失败就落到这里，产物内容完全一样。

用法：python3 scripts/push_pages.py <dist目录> <owner/repo> [分支名]
Token 从 `gh auth token` 取（需要 repo 作用域）。
"""

import base64
import os
import sys

from _ghapi import call, call_or_none, token


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    dist, repo = os.path.abspath(sys.argv[1]), sys.argv[2]
    branch = sys.argv[3] if len(sys.argv) > 3 else "gh-pages"
    tok = token()

    # 1) 收集 dist 下的所有文件（跳过 .git —— dist 里可能残留上一次部署的仓库）
    entries = []
    for root, dirs, files in os.walk(dist):
        dirs[:] = [d for d in dirs if d != ".git"]
        for f in files:
            full = os.path.join(root, f)
            rel = os.path.relpath(full, dist).replace(os.sep, "/")
            entries.append((rel, full))
    if not entries:
        raise SystemExit("dist 是空的，先构建")
    print(f"准备推送 {len(entries)} 个文件到 {repo}@{branch}")

    # 2) 每个文件建 blob
    tree = []
    for rel, full in sorted(entries):
        with open(full, "rb") as fh:
            content = base64.b64encode(fh.read()).decode()
        blob = call(tok, "POST", f"/repos/{repo}/git/blobs", {"content": content, "encoding": "base64"})
        tree.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})

    # 3) 父提交：分支可能还不存在（首次部署）
    ref = call_or_none(tok, "GET", f"/repos/{repo}/git/ref/heads/{branch}")
    parents = [ref["object"]["sha"]] if ref else []
    if not ref:
        print("分支还不存在，将创建它")

    new_tree = call(tok, "POST", f"/repos/{repo}/git/trees", {"tree": tree})
    commit = call(
        tok,
        "POST",
        f"/repos/{repo}/git/commits",
        {"message": "deploy: GitHub API 推送", "tree": new_tree["sha"], "parents": parents},
    )

    # 4) 更新（或创建）分支引用
    if parents:
        call(tok, "PATCH", f"/repos/{repo}/git/refs/heads/{branch}", {"sha": commit["sha"], "force": True})
    else:
        call(tok, "POST", f"/repos/{repo}/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
    print(f"已推送 {commit['sha'][:8]} → {branch}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
