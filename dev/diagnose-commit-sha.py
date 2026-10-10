#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""诊断：为什么 API 建出来的 commit SHA 与本地不一致。

`push-via-api.py` 会在 SHA 不匹配时中止（而不是把错的提交推上去）。这个脚本
把「本地对象」和「API 建出来的对象」逐字段摆在一起，定位差异 —— 因为 commit
对象的 SHA 由 tree / parent / author / committer / message 五部分共同决定，
差一个字节就换 SHA。

用法: python dev/diagnose-commit-sha.py [commit]
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("push", HERE / "push-via-api.py")
push = importlib.util.module_from_spec(spec)
spec.loader.exec_module(push)


def main() -> int:
    commit = sys.argv[1] if len(sys.argv) > 1 else "b022616"
    token = push.token_from_git_credential()
    full = push.git("rev-parse", commit).strip()
    meta = push.commit_meta(full)

    print("=== 本地 commit 对象 ===")
    print(push.git("cat-file", "-p", full))
    print("--- 解析结果 ---")
    for k in ("tree", "parents", "author", "committer"):
        print(f"  {k}: {meta[k]}")
    print(f"  message repr: {meta['message']!r}")

    print("\n=== 按 push-via-api.py 的方式建一次 ===")
    parent = meta["parents"][0]
    entries = push.changed_entries(parent, full)
    print(f"  changed entries: {len(entries)}")
    tree = push.api("POST", f"/repos/{push.REPO}/git/trees",
                    {"base_tree": push.git("rev-parse", parent + "^{tree}").strip(),
                     "tree": entries}, token=token)
    print(f"  tree: built {tree['sha']}  local {meta['tree']}  "
          f"{'OK' if tree['sha'] == meta['tree'] else 'MISMATCH'}")

    payload = {
        "message": meta["message"],
        "tree": tree["sha"],
        "parents": [parent],
        "author": {**meta["author"], "date": push.iso(meta["author"]["date"])},
        "committer": {**meta["committer"], "date": push.iso(meta["committer"]["date"])},
    }
    print(f"  author.date sent:    {payload['author']['date']}")
    print(f"  committer.date sent: {payload['committer']['date']}")
    built = push.api("POST", f"/repos/{push.REPO}/git/commits", payload, token=token)
    print(f"  commit: built {built['sha']}  local {full}  "
          f"{'OK' if built['sha'] == full else 'MISMATCH'}")

    print("\n=== API 建出来的对象（原始字段）===")
    fetched = push.api("GET", f"/repos/{push.REPO}/git/commits/{built['sha']}", token=token)
    print(f"  tree: {fetched['tree']['sha']}")
    print(f"  parents: {[p['sha'] for p in fetched['parents']]}")
    print(f"  author:    {fetched['author']}")
    print(f"  committer: {fetched['committer']}")
    print(f"  message repr: {fetched['message']!r}")

    print("\n=== 逐字段比对 ===")
    def cmp(label, a, b):
        print(f"  {label:24} {'OK' if a == b else 'DIFF'}")
        if a != b:
            print(f"      local: {a!r}")
            print(f"      built: {b!r}")

    cmp("tree", meta["tree"], fetched["tree"]["sha"])
    cmp("parents", meta["parents"], [p["sha"] for p in fetched["parents"]])
    cmp("message", meta["message"], fetched["message"])
    for who in ("author", "committer"):
        cmp(f"{who}.name", meta[who]["name"], fetched[who]["name"])
        cmp(f"{who}.email", meta[who]["email"], fetched[who]["email"])
        print(f"    local {who}.date = {meta[who]['date']!r}")
        print(f"    built {who}.date = {fetched[who]['date']!r}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
