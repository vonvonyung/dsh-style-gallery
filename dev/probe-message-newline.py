#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""探针：GitHub 的 create-commit API 会不会保留消息末尾的换行。

git 的 commit 对象**总是**以换行结尾；如果 API 把它剥掉，SHA 就永远对不上。
这里对同一个提交发两次（带 / 不带结尾换行），看哪个能命中本地 SHA。

用法: python dev/probe-message-newline.py [commit]
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("push", HERE / "push-via-api.py")
push = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push)


def main() -> int:
    commit = sys.argv[1] if len(sys.argv) > 1 else "98454a94"
    token = push.token_from_git_credential()
    full = push.git("rev-parse", commit).strip()
    meta = push.commit_meta(full)
    raw_body = push.raw_commit(full)[1]

    common = {
        "tree": meta["tree"],
        "parents": meta["parents"],
        "author": {**meta["author"], "date": push.iso(meta["author"]["date"])},
        "committer": {**meta["committer"], "date": push.iso(meta["committer"]["date"])},
    }
    print(f"local commit: {full}")
    print(f"raw body tail: {raw_body[-16:]!r}\n")

    for label, msg in (("message WITH trailing \\n", raw_body),
                       ("message WITHOUT trailing \\n", raw_body.rstrip("\n"))):
        built = push.api("POST", f"/repos/{push.REPO}/git/commits",
                         {**common, "message": msg}, token=token)
        path = f"/repos/{push.REPO}/git/commits/{built['sha']}"
        stored = push.api("GET", path, token=token)["message"]
        hit = "HIT local sha" if built["sha"] == full else "no match"
        print(f"{label:32} built={built['sha'][:8]}  {hit}")
        print(f"{'':32} stored tail: ...{stored[-16:]!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
