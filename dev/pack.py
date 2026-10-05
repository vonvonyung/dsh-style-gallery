#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""打一个可以直接发给别人的 zip。

只装运行时真正需要的文件 —— dev/（测试与构建工具）和 node_modules/ 一律不进包。
zip 内顶层目录固定为 dsh-style-gallery/，解压后直接就是插件本体。

用法:
  python dev/pack.py [输出zip路径]
  默认: <仓库上一级>/dsh-style-gallery-<version>.zip
"""
import json
import sys
import zipfile
from pathlib import Path

# 白名单，不是黑名单 —— 新增目录时不会因为忘记加排除规则而误打包
INCLUDE_FILES = ["client.js", "package.json", "cordis.patch.yml", "LICENSE", "README.md"]
INCLUDE_DIRS = ["lib", "assets", "data"]

# 编辑器/手工备份的残渣。这类文件混进包里的成本极高（用户拿到 296 个文件却看不出多的是哪个），
# 所以宁可在这里多拦一道 —— 白名单也可能漏，因为备份文件是"就地"生成的。
JUNK_SUFFIXES = (".bak", ".orig", ".rej", ".swp", ".tmp", "~")
JUNK_MARKERS = (".bak-", ".bak.", ".orig-", ".copy")


def is_junk(name: str) -> bool:
    if name.startswith("."):
        return True
    if name.endswith(JUNK_SUFFIXES):
        return True
    return any(m in name for m in JUNK_MARKERS)


def main() -> int:
    root = Path(__file__).resolve().parent.parent
    pkg = json.loads((root / "package.json").read_text("utf-8"))
    version = pkg.get("version", "0.0.0")

    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root.parent / f"dsh-style-gallery-{version}.zip"
    out.parent.mkdir(parents=True, exist_ok=True)

    entries = []
    for name in INCLUDE_FILES:
        p = root / name
        if not p.exists():
            print("  缺少必需文件:", name)
            return 1
        entries.append((p, f"dsh-style-gallery/{name}"))
    for d in INCLUDE_DIRS:
        base = root / d
        if not base.is_dir():
            print("  缺少必需目录:", d)
            return 1
        for p in sorted(base.rglob("*")):
            if p.is_file() and not is_junk(p.name):
                entries.append((p, "dsh-style-gallery/" + p.relative_to(root).as_posix()))

    # 白名单 + junk 过滤之后，assets 必须一张不少 —— 少图是最难被发现的回归
    n_assets = sum(1 for _, arc in entries if arc.startswith("dsh-style-gallery/assets/"))
    catalog = json.loads((root / "data" / "catalog.json").read_text("utf-8"))
    if n_assets != len(catalog["styles"]):
        print("  assets 数量与 catalog 不一致: %d vs %d" % (n_assets, len(catalog["styles"])))
        return 1

    if out.exists():
        out.unlink()

    # 固定时间戳，保证同样的输入产出逐字节一致的 zip（便于比对与校验）
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for src, arc in entries:
            info = zipfile.ZipInfo(arc, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, src.read_bytes())

    with zipfile.ZipFile(out) as z:
        names = z.namelist()
        bad = [n for n in names if "/dev/" in n or "node_modules" in n or n.endswith("/")]
        print("打包完成:", out)
        print("  %d 个文件  %.2f MB" % (len(names), out.stat().st_size / 1048576))
        print("  顶层目录:", sorted({n.split("/")[0] for n in names}))
        print("  目录清单:", sorted({n.split("/")[1] for n in names if n.count("/") >= 2}))
        print("  误入 dev/ 或 node_modules 的条目:", len(bad) or "0 ✓")
        if bad:
            print("   ", bad[:5])
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
