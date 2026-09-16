"""GitHub API 的最小封装。给 push_pages.py 与 push_source.py 共用。

存在的原因是链路：某些网络下 github.com 的 HTTPS 被掐断（GnuTLS recv error /
TLS unexpected eof），而 api.github.com 是通的 —— 于是 `git push` 必然失败，
只能改走 Git Data API。这不是代码问题，是网络问题，所以放在脚本里兜底。
"""

import json
import subprocess
import urllib.error
import urllib.request

API = "https://api.github.com"


def token() -> str:
    """从 gh 取 token（需要 repo 作用域）。绝不落盘、绝不打印。"""
    return subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, check=True).stdout.strip()


def call(tok: str, method: str, path: str, body: dict | None = None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {tok}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "anything-grid-deploy",
            **({"Content-Type": "application/json"} if body is not None else {}),
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:500]
        raise SystemExit(f"{method} {path} → HTTP {e.code}\n{detail}") from None


def call_or_none(tok: str, method: str, path: str):
    """只在 404（资源不存在）时返回 None，别的错误照常炸 —— 否则认证失败会被
    误判成"分支不存在"，然后去建一个本来该更新的分支。"""
    try:
        return call(tok, method, path)
    except SystemExit as e:
        if "HTTP 404" in str(e):
            return None
        raise
