#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地 git 标签推到远程 —— 走 REST API，而不是 git 传输。

为什么需要它
------------
和提交一样：这个环境里 `github.com:443` 被出口代理封了，`git push --tags` 与
`git push origin v1.0.1` 都会撞上 `Empty reply from server`，而 `api.github.com`
是通的。所以用 Git Data API 手工对齐标签：

    GET   /repos/{repo}/git/refs/tags              远程现有标签
    POST  /repos/{repo}/git/refs                   创建缺失的
    PATCH /repos/{repo}/git/refs/tags/{name}       移动指向不同的（需 --force）

凭据与 api() 直接复用 push-via-api.py，不另起一套 —— 两份各写各的，早晚会在
重试策略或认证头上分叉。

只处理**轻量标签**
------------------
轻量标签在远程就是一个直接指向 commit 的 ref，与 `git tag <name>` 的默认行为一致。
附注标签（`git tag -a`）在远程是一个独立的 tag 对象，必须先 `POST /git/tags` 建出
对象再让 ref 指向它 —— 本仓库的标签都是轻量的，真要用附注标签请先在这里补那一支。
脚本遇到附注标签会**明确拒绝**，而不是悄悄建一个遮蔽它的轻量 ref。

用法
----
    python dev/tag-via-api.py --recon            # 只报告差异
    python dev/tag-via-api.py --apply            # 创建远程缺失的标签
    python dev/tag-via-api.py --apply --force    # 同时移动指向不同的标签

安全默认
--------
「指向不同」不等于「该自动修」。不加 `--force` 就只列出来 —— 移动一个已发布的
标签是在改写别人可能已经引用的标记，那不该是脚本替你决定的事。
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path


def load_push_tool():
    """复用 push-via-api.py 的凭据读取与 api()，而不是复制一份。"""
    path = Path(__file__).with_name("push-via-api.py")
    spec = importlib.util.spec_from_file_location("push_via_api", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PUSH = load_push_tool()
REPO = PUSH.REPO


def local_tags() -> dict[str, tuple[str, str]]:
    """`{name: (object_type, sha)}` —— 覆盖全部本地标签。

    轻量标签的 object type 是 `commit`，附注标签是 `tag`（此时 sha 是 tag 对象
    的 sha，不是 commit 的）。
    """
    out = PUSH.git("for-each-ref",
                   "--format=%(refname:short) %(objecttype) %(objectname)",
                   "refs/tags")
    tags: dict[str, tuple[str, str]] = {}
    for line in out.splitlines():
        name, typ, sha = line.split()
        tags[name] = (typ, sha)
    return tags


def remote_tags(token: str) -> dict[str, tuple[str, str]]:
    refs = PUSH.api("GET", f"/repos/{REPO}/git/refs/tags", token=token)
    return {
        r["ref"].split("refs/tags/", 1)[1]: (r["object"]["type"], r["object"]["sha"])
        for r in refs
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually create/move tags")
    ap.add_argument("--recon", action="store_true", help="report only (default)")
    ap.add_argument("--force", action="store_true",
                    help="also move tags whose remote target differs (rewrites a published marker)")
    args = ap.parse_args()

    token = PUSH.token_from_git_credential()
    print(f"token: {len(token)} chars, prefix {token[:4]}…")

    local = local_tags()
    remote = remote_tags(token)
    print(f"local {len(local)} tag(s), remote {len(remote)} tag(s)\n")

    to_create = sorted(set(local) - set(remote))
    to_move = sorted(n for n in set(local) & set(remote) if local[n][1] != remote[n][1])
    remote_only = sorted(set(remote) - set(local))

    for name in to_create:
        typ, sha = local[name]
        print(f"  CREATE       {name} -> {sha[:8]} ({typ})")
    for name in to_move:
        print(f"  MOVE         {name}: {remote[name][1][:8]} -> {local[name][1][:8]}")
    for name in remote_only:
        print(f"  remote-only  {name} -> {remote[name][1][:8]}  (this script never deletes)")

    if not to_create and not to_move:
        print("nothing to do — tags already in sync")
        return 0

    if not args.apply:
        print("\n(recon only — pass --apply to create; add --force to also move)")
        return 0

    if to_move and not args.force:
        print(f"\nrefusing to move {len(to_move)} tag(s) without --force: "
              f"{', '.join(to_move)}", file=sys.stderr)
        return 1

    # An annotated tag's ref points at a tag object that must exist first.
    # Refuse loudly rather than create a lightweight ref that shadows it.
    annotated = [n for n in to_create + to_move if local[n][0] != "commit"]
    if annotated:
        raise SystemExit(
            "these are annotated tags and this script only handles lightweight ones: "
            + ", ".join(annotated)
            + ". Create the tag object first (POST /git/tags), then point the ref at it."
        )

    for name in to_create:
        sha = local[name][1]
        PUSH.api("POST", f"/repos/{REPO}/git/refs",
                 {"ref": f"refs/tags/{name}", "sha": sha}, token=token)
        print(f"  created {name} -> {sha[:8]}")

    for name in to_move:
        sha = local[name][1]
        PUSH.api("PATCH", f"/repos/{REPO}/git/refs/tags/{name}",
                 {"sha": sha, "force": True}, token=token)
        print(f"  moved   {name} -> {sha[:8]}")

    # Read the refs back: a 200 on PATCH does not by itself prove the target
    # is what we asked for.
    print("\nverifying …")
    after = remote_tags(token)
    bad = 0
    for name in to_create + to_move:
        want = local[name][1]
        got = after.get(name, ("", ""))[1]
        ok = got == want
        bad += 0 if ok else 1
        print(f"  {'OK ' if ok else 'BAD'} {name} = {got[:8] or '<missing>'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
