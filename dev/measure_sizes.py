#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实测不同「长边封顶 + webp 质量」下的总体积，用来挑画质/体积平衡点。

用法: python dev/measure_sizes.py [插件目录] [--scan]

默认只出两张汇总表（改参数前真正要看的东西），几秒钟就跑完。
加 `--scan` 再逐类扫一遍长边候选 —— 那是 594 张 × 7 组参数 ≈ 4000 次编码，
要跑几分钟，只有想单独调某一类时才需要。

`assets/` 是五个子目录，各类图片原生尺寸差得很远（风格缩略图 ~302px、
版式预览 512px、A–H 拼图 1254px），所以先按 `ENCODE_PLAN` 的默认参数算一遍
基准，再逐类单独扫一遍 —— 只用一个全局长边会把小图放大、大图压糊。
"""
import io
import json
import sys
from pathlib import Path

from PIL import Image

# 与 build_workbuddy_html.py 的 ENCODE_PLAN 保持一致。
PLAN = [
    ("styles", 448),
    ("layouts", 448),
    ("colors", 300),
    ("groups", 560),
]
QUALITY = 78
# 逐类扫描的长边候选；None 表示不缩放
CAPS = [None, 640, 560, 448, 384, 320, 256]
# 全局总旋钮的候选（覆盖全部类别），即 build_workbuddy_html.py 的第 4 个参数。
# 只留两点：`448` 证明「跟默认的每类值差不多」（styles/layouts 本来就在 448），
# `320` 给出真正变小之后的量级。想扫更多就用 --scan 逐类看。
# 每多一个候选就多跑一遍全部 594 张的 method=6 编码，约 20 秒。
GLOBAL_CAPS = [448, 320]


def files_of(src: Path, kind: str) -> list[Path]:
    return sorted((src / "assets" / kind).glob("*.webp"))


def measure(paths: list[Path], cap: int | None, q: int) -> int:
    """Return total encoded bytes for one kind under one (cap, q)."""
    total = 0
    for p in paths:
        with Image.open(p) as im:
            im = im.convert("RGB")
            if cap and max(im.size) > cap:
                r = cap / max(im.size)
                im = im.resize(
                    (max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))),
                    Image.LANCZOS,
                )
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=q, method=6)
            total += buf.tell()
    return total


def mb(n: int) -> str:
    return "%.2f MB" % (n / 1048576)


def b64(n: int) -> str:
    return "%.2f MB" % (n * 4 / 3 / 1048576)


def main() -> int:
    argv = [a for a in sys.argv[1:] if a != "--scan"]
    do_scan = "--scan" in sys.argv[1:]
    src = Path(argv[0] if argv else ".").resolve()
    kinds = {kind: files_of(src, kind) for kind, _ in PLAN}
    missing = [k for k, v in kinds.items() if not v]
    if missing:
        print("缺资源目录:", ", ".join(missing))
        return 1

    orig = sum(p.stat().st_size for v in kinds.values() for p in v)
    print("原文件合计 %s  (%d 张, base64 %s)" % (mb(orig), sum(len(v) for v in kinds.values()), b64(orig)))

    print("\n--- 各类默认参数下的实际贡献 ---")
    plan_total = 0
    for kind, cap in PLAN:
        n = measure(kinds[kind], cap, QUALITY)
        plan_total += n
        print(f"  {kind:10} {len(kinds[kind]):>4} 张  长边<={cap or '原生':>4}  {mb(n):>10}")
    print(f"  {'合计':10} {'':>4}      base64 {b64(plan_total)}")

    print(f"\n--- 全局总旋钮（覆盖全部类别，q{QUALITY}）---")
    print("    这是 build_workbuddy_html.py 的第 4 个参数")
    for gcap in GLOBAL_CAPS:
        total = sum(measure(kinds[kind], gcap, QUALITY) for kind, _ in PLAN)
        label = "不缩放" if gcap is None else "长边<=%d" % gcap
        print(f"  {label:>12}  base64 {b64(total):>10}   (当前默认的 {total / plan_total * 100:.0f}%)")
        sys.stdout.flush()

    if do_scan:
        print("\n--- 逐类扫描（q%d，挑某一类时才看这里）---" % QUALITY)
        for kind, _ in PLAN:
            print(f"  {kind}  ({len(kinds[kind])} 张)")
            for cap in CAPS:
                label = "不缩放" if cap is None else "长边<=%d" % cap
                print(f"    {label:>12}  {mb(measure(kinds[kind], cap, QUALITY)):>10}")
            sys.stdout.flush()
    else:
        print("\n(加 --scan 可逐类扫长边候选，较慢)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
