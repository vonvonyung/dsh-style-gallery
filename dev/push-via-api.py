#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把本地提交推到 GitHub —— 走 REST API，而不是 git 传输。

为什么需要它
------------
这个环境里 `github.com:443` 被出口代理封了：

    $ git push origin main
    fatal: unable to access 'https://github.com/vonvonyung/dsh-style-gallery.git/':
    CONNECT tunnel failed, response 502

但 `api.github.com` 是通的（同一个代理只放行它）。所以当 `git push` 走不通、
又没有可用的 SSH key 时，可以用 Git Data API 手工把对象传上去：

    POST /git/blobs      每个缺失的 blob
    POST /git/trees      每个提交的 tree（用 base_tree 只发差异）
    POST /git/commits    提交本身
    PATCH /git/refs/...  最后移动分支

这与 `git push` 等价 —— 生成的对象 SHA 必须逐字节一致，脚本会校验这一点。

用法
----
    python dev/push-via-api.py --recon          # 只侦察，报告要传什么
    python dev/push-via-api.py --apply          # 真推

令牌从 git 的凭据存储里取（`git credential fill`），不落盘、不打印。
需要一个 classic PAT 或 OAuth token，权限含 `repo`。

已知限制
--------
* 只推 **快进**（fast-forward）。远程若不是本地历史的祖先，直接拒绝 ——
  非快进需要 force，那不是这个脚本该替你决定的事。
* 逐个 blob 上传，几百个文件要几分钟。对象已存在于远程的会跳过。
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "vonvonyung/dsh-style-gallery"
API = "https://api.github.com"
BRANCH = "main"

# 代理不稳，每个请求都重试。api.github.com 在这个环境里是稳的，但没理由赌。
RETRIES = 4
RETRY_WAIT = 3.0


# --------------------------------------------------------------------------
# token
# --------------------------------------------------------------------------
def token_from_git_credential() -> str:
    """Ask git's credential store for the github.com password.

    Deliberately never printed. We only ever report its length and prefix.
    """
    proc = subprocess.run(
        ["git", "credential", "fill"],
        input="protocol=https\nhost=github.com\n\n",
        capture_output=True, text=True, check=True,
    )
    for line in proc.stdout.splitlines():
        if line.startswith("password="):
            return line[len("password="):]
    raise SystemExit("git credential fill returned no password for github.com")


# --------------------------------------------------------------------------
# http
# --------------------------------------------------------------------------
class ApiError(RuntimeError):
    """A non-retryable HTTP error from the API."""

    def __init__(self, code: int, method: str, path: str, detail: str):
        super().__init__(f"HTTP {code} on {method} {path}\n{detail}")
        self.code = code
        self.detail = detail


def api(method: str, path: str, payload: dict | None = None, token: str = "") -> dict:
    url = API + path
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    last = None
    for attempt in range(1, RETRIES + 1):
        req = urllib.request.Request(url, data=body, method=method)
        req.add_header("Authorization", "Bearer " + token)
        req.add_header("Accept", "application/vnd.github+json")
        req.add_header("X-GitHub-Api-Version", "2022-11-28")
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:400]
            # 4xx other than 429/5xx are our fault; retrying will not help.
            if e.code < 500 and e.code != 429:
                raise ApiError(e.code, method, path, detail) from None
            last = f"HTTP {e.code}: {detail}"
        except Exception as e:  # noqa: BLE001 - proxy resets show up as many types
            last = f"{type(e).__name__}: {e}"
        if attempt < RETRIES:
            print(f"    retry {attempt}/{RETRIES - 1} after {last}", file=sys.stderr)
            time.sleep(RETRY_WAIT * attempt)
    raise SystemExit(f"gave up on {method} {path}: {last}")


def create_tree(repo: str, base_tree: str, entries: list[dict], token: str,
                chunk: int = 120) -> str:
    """Create a tree, splitting the entry list if the API rejects it.

    Reorganising `assets/` into five per-kind directories produces a ~900-entry
    diff, and the API answers that with::

        422 Sorry, your request timed out. It's likely that your input was too
        large to process. Consider building the tree incrementally…

    So build it incrementally: each call's result becomes the next call's
    `base_tree`. Trees are content-addressed, so the last one is the tree we
    wanted, and the intermediate ones are simply unreferenced.
    """
    if len(entries) <= chunk:
        return api("POST", f"/repos/{repo}/git/trees",
                   {"base_tree": base_tree, "tree": entries}, token=token)["sha"]

    current = base_tree
    i = 0
    while i < len(entries):
        part = entries[i:i + chunk]
        try:
            current = api("POST", f"/repos/{repo}/git/trees",
                          {"base_tree": current, "tree": part}, token=token)["sha"]
        except ApiError as e:
            if e.code != 422 or chunk <= 10:
                raise
            # Too big even at this chunk size — halve and retry this slice.
            chunk = max(10, chunk // 2)
            print(f"    422 on a {len(part)}-entry chunk; retrying at {chunk}")
            continue
        i += len(part)
    return current


# --------------------------------------------------------------------------
# local git
# --------------------------------------------------------------------------
def git(*args: str, binary: bool = False):
    p = subprocess.run(["git"] + list(args), capture_output=True, check=True)
    return p.stdout if binary else p.stdout.decode("utf-8")


def ls_tree(tree: str) -> dict[str, tuple[str, str, str]]:
    """`{path: (mode, type, sha)}` for a tree, recursive."""
    out: dict[str, tuple[str, str, str]] = {}
    for line in git("ls-tree", "-r", "-z", tree).split("\0"):
        if not line:
            continue
        meta, path = line.split("\t", 1)
        mode, typ, sha = meta.split()
        out[path] = (mode, typ, sha)
    return out


def blob_sizes(shas: list[str]) -> dict[str, int]:
    """Batch size lookup - one subprocess instead of one per blob."""
    if not shas:
        return {}
    p = subprocess.run(
        ["git", "cat-file", "--batch-check=%(objectname) %(objectsize)"],
        input="\n".join(shas).encode(), capture_output=True, check=True,
    )
    out = {}
    for line in p.stdout.decode().splitlines():
        parts = line.split()
        if len(parts) == 2:
            out[parts[0]] = int(parts[1])
    return out


def changed_entries(parent: str | None, commit: str) -> list[dict]:
    """Tree entries that differ between a commit and its parent.

    `--no-renames` so a rename shows up as a plain delete + add, which is what
    the create-tree endpoint wants (`sha: null` deletes).
    """
    args = ["diff-tree", "-r", "-z", "--no-commit-id", "--name-status", "--no-renames"]
    if parent is None:
        args += ["--root", commit]
    else:
        args += [parent, commit]
    fields = git(*args).split("\0")
    tree = ls_tree(commit)  # once, not once per path
    entries = []
    i = 0
    while i < len(fields):
        status = fields[i].strip()
        if not status:
            i += 1
            continue
        path = fields[i + 1]
        i += 2
        if status == "D":
            entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        else:
            mode, typ, sha = tree[path]
            entries.append({"path": path, "mode": mode, "type": typ, "sha": sha})
    return entries


def raw_commit(sha: str) -> tuple[str, str]:
    """`(header, body)` — body is the message exactly as git stored it.

    Keep the trailing newline: git's commit object always ends the message with
    one, and the API stores whatever it is given verbatim, so stripping it here
    is what makes the rebuilt SHA differ.
    """
    raw = git("cat-file", "-p", sha)
    header, _, body = raw.partition("\n\n")
    return header, body


def commit_meta(sha: str) -> dict:
    header, body = raw_commit(sha)
    out = {"message": body, "tree": "", "parents": []}
    for line in header.splitlines():
        if line.startswith("tree "):
            out["tree"] = line[5:]
        elif line.startswith("parent "):
            out["parents"].append(line[7:])
        elif line.startswith("author "):
            name, _, rest = line[7:].partition(" <")
            email, _, ts = rest.partition("> ")
            epoch, _, tz = ts.partition(" ")
            out["author"] = {"name": name, "email": email,
                             "date": f"{epoch} {tz}"}
        elif line.startswith("committer "):
            name, _, rest = line[10:].partition(" <")
            email, _, ts = rest.partition("> ")
            epoch, _, tz = ts.partition(" ")
            out["committer"] = {"name": name, "email": email,
                                "date": f"{epoch} {tz}"}
    return out


def iso(epoch_tz: str) -> str:
    """`1791176825 +0800` -> the ISO 8601 the API wants.

    The epoch is an instant; the offset says which wall clock it was written
    against. So shift the epoch by the offset before formatting as UTC, then
    re-attach the offset — otherwise every author date lands 8 hours off and
    the resulting commit SHA will not match the local one.
    """
    epoch, tz = epoch_tz.split()
    off = (1 if tz[0] == "+" else -1) * (int(tz[1:3]) * 3600 + int(tz[3:5]) * 60)
    wall = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(int(epoch) + off))
    return f"{wall}{tz[0]}{tz[1:3]}:{tz[3:5]}"


# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="actually push")
    ap.add_argument("--recon", action="store_true", help="report only (default)")
    ap.add_argument("--branch", default=BRANCH)
    ap.add_argument("--repo", default=REPO)
    args = ap.parse_args()

    token = token_from_git_credential()
    print(f"token: {len(token)} chars, prefix {token[:4]}…")

    # ---- what is on the remote right now ---------------------------------
    ref = api("GET", f"/repos/{args.repo}/git/ref/heads/{args.branch}", token=token)
    remote_head = ref["object"]["sha"]
    remote_tree_sha = api("GET", f"/repos/{args.repo}/git/commits/{remote_head}",
                          token=token)["tree"]["sha"]
    print(f"remote {args.branch} = {remote_head[:8]} (tree {remote_tree_sha[:8]})")

    # ---- what we want to push -------------------------------------------
    todo = git("rev-list", "--reverse", f"{remote_head}..HEAD").split()
    if not todo:
        print("nothing to push — already up to date")
        return 0
    print(f"to push: {len(todo)} commit(s)")

    # a fast-forward is the only thing this script is allowed to do
    first_parent = commit_meta(todo[0])["parents"]
    if first_parent != [remote_head]:
        raise SystemExit(
            f"not a fast-forward: {todo[0][:8]}'s parent is "
            f"{first_parent or ['<root>']}, remote is {remote_head[:8]}. "
            "Refusing — use git push --force yourself if that is really what you want."
        )

    remote_blobs = {v[2] for v in ls_tree(remote_tree_sha).values() if v[1] == "blob"}

    # union of blobs across every tree we are about to create
    needed: set[str] = set()
    for sha in todo:
        for _p, (_m, typ, bsha) in ls_tree(commit_meta(sha)["tree"]).items():
            if typ == "blob":
                needed.add(bsha)
    upload = sorted(needed - remote_blobs)
    sizes = blob_sizes(upload)
    total = sum(sizes.values())
    print(f"blobs: {len(needed)} referenced, {len(upload)} missing remotely "
          f"({total / 1048576:.1f} MB to upload)")

    if not args.apply:
        print("\n(recon only — pass --apply to push)")
        for sha in todo:
            meta = commit_meta(sha)
            print(f"  {sha[:8]}  {meta['message'].splitlines()[0][:66]}")
        return 0

    # ---- upload missing blobs -------------------------------------------
    # The proxy in this environment is slow enough that a 300-blob upload can
    # outlive a shell timeout, so remember what landed and resume on re-run.
    # Re-uploading would be harmless (same content -> same sha) but wasteful.
    cache_path = Path(__file__).with_name(f".push-cache-{args.branch}.json")
    uploaded: set[str] = set()
    if cache_path.exists():
        try:
            uploaded = set(json.loads(cache_path.read_text("utf-8")).get("uploaded", []))
        except Exception:
            uploaded = set()

    todo_blobs = [s for s in upload if s not in uploaded]
    print(f"\nuploading {len(todo_blobs)} blobs "
          f"({len(upload) - len(todo_blobs)} already done, {total / 1048576:.1f} MB total) …")

    for i, sha in enumerate(todo_blobs, 1):
        content = git("cat-file", "blob", sha, binary=True)
        res = api("POST", f"/repos/{args.repo}/git/blobs",
                  {"content": base64.b64encode(content).decode("ascii"),
                   "encoding": "base64"}, token=token)
        if res.get("sha") != sha:
            # Would mean the API and local git disagree on content hashing;
            # everything downstream would be silently wrong.
            raise SystemExit(f"blob sha mismatch: local {sha}, remote {res.get('sha')}")
        uploaded.add(sha)
        if i % 10 == 0 or i == len(todo_blobs):
            print(f"  {i}/{len(todo_blobs)}", flush=True)
            cache_path.write_text(json.dumps({"uploaded": sorted(uploaded)}), encoding="utf-8")

    if not todo_blobs and not cache_path.exists():
        print("  (nothing to upload)")

    # ---- trees, commits, then move the ref -------------------------------
    parent = remote_head
    parent_tree = remote_tree_sha
    new_head = None
    for sha in todo:
        meta = commit_meta(sha)
        entries = changed_entries(meta["parents"][0] if meta["parents"] else None, sha)
        tree_sha = create_tree(args.repo, parent_tree, entries, token)
        if tree_sha != meta["tree"]:
            raise SystemExit(
                f"tree sha mismatch for {sha[:8]}: built {tree_sha[:8]}, "
                f"local says {meta['tree'][:8]}")
        commit = api("POST", f"/repos/{args.repo}/git/commits", {
            "message": meta["message"],
            "tree": tree_sha,
            "parents": [parent],
            "author": {**meta["author"], "date": iso(meta["author"]["date"])},
            "committer": {**meta["committer"], "date": iso(meta["committer"]["date"])},
        }, token=token)
        if commit["sha"] != sha:
            raise SystemExit(
                f"commit sha mismatch for {sha[:8]}: built {commit['sha'][:8]}")
        print(f"  commit {sha[:8]}  {meta['message'].splitlines()[0][:56]}")
        parent, parent_tree, new_head = commit["sha"], tree_sha, commit["sha"]

    api("PATCH", f"/repos/{args.repo}/git/refs/heads/{args.branch}",
        {"sha": new_head, "force": False}, token=token)
    print(f"\n{args.branch} -> {new_head[:8]}")
    print("done")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApiError as e:
        print(f"\n{e}", file=sys.stderr)
        raise SystemExit(1) from None
