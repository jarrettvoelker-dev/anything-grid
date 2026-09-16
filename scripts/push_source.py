#!/usr/bin/env python3
"""把本地已有的提交镜像到 GitHub —— 走 Git Data API，不走 git push。

用途：网络把 github.com 的 HTTPS 掐了、`git push` 一律失败时，源码与标签照样能上去。
提交内容是从**本地 git 对象库**读出来的，所以推上去的和本地 `git log` 看到的是同一个东西，
不是"把工作区文件再打包一份"。

用法：
    python3 scripts/push_source.py <owner/repo> [本地ref] [远程分支] [--tag 标签名]

例如：
    python3 scripts/push_source.py jarrettvoelker-dev/anything-grid HEAD main --tag v0.3.0
"""

import base64
import subprocess
import sys
from collections import defaultdict

from _ghapi import call, call_or_none, token


def git(*args: str) -> str:
    return subprocess.run(
        ["git", *args], capture_output=True, text=True, check=True, cwd=_ROOT
    ).stdout


_ROOT = "."


def parse_commit(sha: str):
    """从原始 commit 对象里取字段 —— 一个字节都不改。

    不能用 `git show --format=%B` 之类的：格式化输出会在末尾多加一个换行，
    去掉它会让 message 少一个字节，于是**远端算出来的 sha 与本地对不上**。
    内容明明一样，历史却分叉成两条，以后每次 push 都要强制。这里返回的
    message 原样喂给 API，remote 才会得到与本地相同的 sha。
    """
    raw = subprocess.run(
        ["git", "cat-file", "commit", sha], capture_output=True, text=True, check=True, cwd=_ROOT
    ).stdout
    head, _, message = raw.partition("\n\n")
    parents, ident = [], {}
    for line in head.splitlines():
        key, _, value = line.partition(" ")
        if key == "parent":
            parents.append(value)
        elif key in ("author", "committer"):
            name, _, rest = value.rpartition(" <")
            email, _, date = rest.rstrip(">").partition("> ")
            ident[key] = {"name": name, "email": email, "date": iso8601(date)}
    return parents, ident["author"], ident["committer"], message


def iso8601(git_date: str) -> str:
    """`1737000000 +0800` → `2025-01-16T12:00:00+08:00`（API 要的格式）。"""
    from datetime import datetime, timezone, timedelta

    ts, _, tz = git_date.partition(" ")
    sign = 1 if tz.startswith("+") else -1
    offset = timedelta(hours=int(tz[1:3]), minutes=int(tz[3:5])) * sign
    return datetime.fromtimestamp(int(ts), timezone(offset)).isoformat()


def upload_tree(tok: str, repo: str, commit_sha: str) -> str:
    """把该提交的整棵树搬到远端，返回远端的新 tree sha。

    文件内容相同的 blob 会得到同一个 sha（内容是寻址的），所以远端已有的对象
    会自动命中，不会重复占空间 —— 不需要额外的增量判断。
    """
    entries = []  # (path, mode, blob_sha)
    for line in git("ls-tree", "-r", "-z", commit_sha).split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        mode, _type, sha = meta.split()
        entries.append((path, mode, sha))

    # 逐个上传 blob
    sha_map = {}
    print(f"上传 {len(entries)} 个文件对象…")
    for path, _mode, sha in entries:
        raw = subprocess.run(
            ["git", "cat-file", "blob", sha], capture_output=True, check=True, cwd=_ROOT
        ).stdout
        res = call(
            tok, "POST", f"/repos/{repo}/git/blobs",
            {"content": base64.b64encode(raw).decode(), "encoding": "base64"},
        )
        sha_map[sha] = res["sha"]

    # 自底向上拼目录树：按路径前缀分组，深的先建
    tree: dict = defaultdict(dict)  # 目录前缀 → {名字: entry}
    for path, mode, sha in entries:
        parts = path.split("/")
        prefix = ""
        for d in parts[:-1]:
            tree[prefix][d] = None  # 占位，等子目录建好再回填
            prefix = f"{prefix}{d}/"
        tree[prefix][parts[-1]] = {"path": parts[-1], "mode": mode, "type": "blob", "sha": sha_map[sha]}

    for prefix in sorted(tree, key=lambda p: -p.count("/")):
        items = []
        for name, entry in tree[prefix].items():
            if entry is None:  # 子目录：用刚建好的 tree sha 填
                items.append({"path": name, "mode": "040000", "type": "tree", "sha": tree[f"{prefix}{name}/"]["__sha"]})
            else:
                items.append(entry)
        built = call(tok, "POST", f"/repos/{repo}/git/trees", {"tree": items})
        tree[prefix]["__sha"] = built["sha"]
    return tree[""]["__sha"]


def main() -> int:
    global _ROOT
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tag = sys.argv[sys.argv.index("--tag") + 1] if "--tag" in sys.argv else None
    if len(args) < 1:
        print(__doc__)
        return 2
    repo = args[0]
    ref = args[1] if len(args) > 1 else "HEAD"
    branch = args[2] if len(args) > 2 else "main"

    _ROOT = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
    ).stdout.strip()

    commit_sha = git("rev-parse", ref).strip()
    parents, author, committer, message = parse_commit(commit_sha)

    tok = token()
    print(f"镜像 {commit_sha[:8]} → {repo}@{branch}")
    tree_sha = upload_tree(tok, repo, commit_sha)
    commit = call(
        tok, "POST", f"/repos/{repo}/git/commits",
        {"message": message, "tree": tree_sha, "parents": parents, "author": author, "committer": committer},
    )

    # 先看远端分支现在指哪儿：是这一条历史就快进，否则强制对齐（本地才是权威）
    remote_ref = call_or_none(tok, "GET", f"/repos/{repo}/git/ref/heads/{branch}")
    if remote_ref:
        call(tok, "PATCH", f"/repos/{repo}/git/refs/heads/{branch}", {"sha": commit["sha"], "force": True})
    else:
        call(tok, "POST", f"/repos/{repo}/git/refs", {"ref": f"refs/heads/{branch}", "sha": commit["sha"]})
    print(f"  {branch} → {commit['sha'][:8]}")

    if tag:
        tag_obj = call(
            tok, "POST", f"/repos/{repo}/git/tags",
            {"tag": tag, "message": f"{tag}\n\n{message}", "object": commit["sha"], "type": "commit",
             "tagger": committer},
        )
        existing = call_or_none(tok, "GET", f"/repos/{repo}/git/ref/tags/{tag}")
        if existing:
            call(tok, "PATCH", f"/repos/{repo}/git/refs/tags/{tag}", {"sha": tag_obj["sha"], "force": True})
        else:
            call(tok, "POST", f"/repos/{repo}/git/refs", {"ref": f"refs/tags/{tag}", "sha": tag_obj["sha"]})
        print(f"  标签 {tag} → {tag_obj['sha'][:8]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
