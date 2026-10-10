#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把未推送提交的日期归一化成 UTC，让本地 SHA 与 GitHub API 建出来的一致。

为什么需要它
------------
GitHub 的 `POST /git/commits` **只接受 ISO 8601，并把日期存成 UTC**。本地 git
提交记的是 `<epoch> +0800`，GitHub 记的是 `<epoch> +0000` —— 同一时刻，但字节不同，
所以 commit SHA 必然不同：

    本地: author vonyung <...> 1791177995 +0800
    API : author vonyung <...> 1791177995 +0000

如果直接推，本地和远程就成了**分叉**（内容一样、SHA 不同），你下一次 `git push`
会被拒为 non-fast-forward，只能 force。所以先把本地这几个提交的日期也写成 `+0000`，
两边 SHA 就逐字节一致了。

代价：时区标签从 `+0800` 变成 `+0000`。**时刻不变**，GitHub 本来也按浏览者时区显示。
只处理尚未推送的提交，所以没有已发布的历史被改写。

用法
----
    python dev/normalize-commit-dates.py            # 报告会改什么
    python dev/normalize-commit-dates.py --apply    # 真改
    python dev/normalize-commit-dates.py --apply --base origin/main --branch main
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent


def git(*args: str, env: dict | None = None, check: bool = True) -> str:
    import os
    e = dict(os.environ)
    if env:
        e.update(env)
    p = subprocess.run(["git"] + list(args), capture_output=True, env=e, check=check)
    return p.stdout.decode("utf-8")


def raw_commit(sha: str) -> tuple[str, str]:
    """`(header, body)` — body is the message exactly as stored."""
    raw = git("cat-file", "commit", sha)
    header, _, body = raw.partition("\n\n")
    return header, body


def fields(header: str) -> dict:
    out: dict = {"parents": []}
    for line in header.splitlines():
        for key in ("tree", "author", "committer"):
            if line.startswith(key + " "):
                out[key] = line[len(key) + 1:]
        if line.startswith("parent "):
            out["parents"].append(line[7:])
    return out


def split_ident(value: str) -> tuple[str, str, str]:
    """`vonyung <a@b> 1791177995 +0800` -> (name, email, 'epoch tz')."""
    name, _, rest = value.partition(" <")
    email, _, when = rest.partition("> ")
    return name, email, when.strip()


def to_utc(when: str) -> str:
    epoch, _tz = when.split()
    return f"{epoch} +0000"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="origin/main", help="first commit NOT to touch")
    ap.add_argument("--branch", default="main")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    todo = git("rev-list", "--reverse", f"{args.base}..{args.branch}").split()
    if not todo:
        print(f"nothing between {args.base} and {args.branch}")
        return 0

    print(f"range {args.base}..{args.branch}: {len(todo)} commit(s)")
    dirty = []
    for sha in todo:
        f = fields(raw_commit(sha)[0])
        a = split_ident(f["author"])[2]
        c = split_ident(f["committer"])[2]
        mark = "" if (a.endswith("+0000") and c.endswith("+0000")) else "  <- needs UTC"
        if mark:
            dirty.append(sha)
        print(f"  {sha[:8]}  {a} / {c}{mark}")

    if not dirty:
        print("\nnothing to normalise")
        return 0
    if len(dirty) != len(todo):
        # Rewriting a commit changes its SHA, which changes every descendant's
        # parent line, so the whole range has to be rebuilt — not just the
        # commits whose own dates were off.
        print(f"\n{len(dirty)}/{len(todo)} have non-UTC dates; "
              f"all {len(todo)} must be rebuilt because parents chain")
    if not args.apply:
        print(f"\n{len(todo)} commit(s) would be rewritten — pass --apply")
        return 0

    base_sha = git("rev-parse", args.base).strip()
    parent = base_sha
    new_head = None
    mapping = []
    for sha in todo:
        header, body = raw_commit(sha)
        f = fields(header)
        an, ae, aw = split_ident(f["author"])
        cn, ce, cw = split_ident(f["committer"])

        # newline="" is load-bearing: the default text mode translates \n to
        # \r\n on Windows, which would silently inject a CR into every line of
        # the commit message (and double them on each re-run).
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".msg",
                                         delete=False, newline="") as tf:
            tf.write(body)
            msg_path = tf.name
        try:
            new = git(
                "commit-tree", f["tree"], "-p", parent, "-F", msg_path,
                env={
                    "GIT_AUTHOR_NAME": an, "GIT_AUTHOR_EMAIL": ae,
                    "GIT_AUTHOR_DATE": to_utc(aw),
                    "GIT_COMMITTER_NAME": cn, "GIT_COMMITTER_EMAIL": ce,
                    "GIT_COMMITTER_DATE": to_utc(cw),
                },
            ).strip()
        finally:
            Path(msg_path).unlink(missing_ok=True)

        # The message must survive byte for byte. `commit-tree` normalises the
        # trailing newline, so compare with that accounted for.
        new_body = raw_commit(new)[1]
        if new_body.rstrip("\n") != body.rstrip("\n"):
            raise SystemExit(
                f"message changed while rewriting {sha[:8]} — aborting\n"
                f"  before: {body.rstrip(chr(10))[-120:]!r}\n"
                f"  after : {new_body.rstrip(chr(10))[-120:]!r}")

        # The content must not move either; only the ident lines change.
        old_tree = f["tree"]
        new_tree = fields(raw_commit(new)[0])["tree"]
        if old_tree != new_tree:
            raise SystemExit(f"tree changed while rewriting {sha[:8]} — aborting")
        mapping.append((sha, new))
        print(f"  {sha[:8]} -> {new[:8]}")
        parent, new_head = new, new

    # Nothing should have changed in the working tree.
    if git("diff", "--name-only", git("rev-parse", f"{args.branch}^{{tree}}").strip(),
           f"{new_head}^{{tree}}").strip():
        raise SystemExit("tree of the rewritten head differs from the original — aborting")

    git("update-ref", f"refs/heads/{args.branch}", new_head, git("rev-parse", args.branch).strip())
    print(f"\n{args.branch} -> {new_head[:8]}")
    for old, new in mapping:
        print(f"  {old} -> {new}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
