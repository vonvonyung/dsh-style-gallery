#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""实测不同「长边封顶 + webp 质量」下的总体积，用来挑画质/体积平衡点。

用法: python dev/measure_sizes.py [插件目录]
"""
import io
import json
import sys
from pathlib import Path

from PIL import Image

CONFIGS = [(512, 85), (512, 80), (448, 82), (384, 85), (384, 80), (320, 82)]


def main() -> int:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
    catalog = json.loads((src / "data" / "catalog.json").read_text("utf-8"))
    nums = [s["number"] for s in catalog["styles"]]

    orig = sum((src / "assets" / (n + ".webp")).stat().st_size for n in nums)
    print("原文件合计 %.2f MB  (base64 %.2f MB)" % (orig / 1048576, orig * 4 / 3 / 1048576))

    # 只解码一次，缓存到内存（288 张，几百 MB 以内）
    cache = {}
    for n in nums:
        cache[n] = Image.open(src / "assets" / (n + ".webp")).convert("RGB")

    for cap, q in CONFIGS:
        total = 0
        for n in nums:
            im = cache[n]
            if max(im.size) > cap:
                r = cap / max(im.size)
                im = im.resize(
                    (max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))),
                    Image.LANCZOS,
                )
            buf = io.BytesIO()
            im.save(buf, "WEBP", quality=q, method=6)
            total += buf.tell()
        print(
            "长边<=%3d q%-3d  %.2f MB  (base64 %.2f MB)"
            % (cap, q, total / 1048576, total * 4 / 3 / 1048576)
        )
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
