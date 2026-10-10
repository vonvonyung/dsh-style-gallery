#!/usr/bin/env python3
"""Rebuild assets/ from the upstream handraw-style image library.

Why this exists
---------------
The first release shipped a flat `assets/` with only the 288 style previews,
copied by hand. That lost three things:

  * the 36 `{id}_grid.webp` reference sheets — the fallback art for models that
    cannot activate a style from its name alone (`SKILL.md` gives them the
    highest reference priority);
  * the whole layout library (165 previews);
  * the colour swatches (36 + 6 contact sheets) and the per-group sheets.

Everything now lands in `assets/<kind>/<id>.<ext>`, one folder per asset kind,
and the host half routes `/dsh-style-gallery/preview/<kind>/<file>` against a
strict filename allowlist. Run this any time the upstream library is updated.

Usage:
  python dev/build_assets.py <upstream-repo-root> [--catalog data/catalog.json]

  <upstream-repo-root> is a checkout of https://github.com/yang0/handraw-style
  (the directory containing `version.json` and `images/`).

Re-running is safe: `assets/` is rebuilt from scratch, so files dropped
upstream disappear here too rather than lingering as dead weight.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

# Layout previews live in folders named after the plural category; the catalog
# uses the singular. Only used for reporting — ids carry the category prefix.
LAYOUT_DIRS = [
    "social-cards",
    "infographics",
    "comic-storyboards",
    "ip-characters",
    "ecommerce",
]

STYLE_ID = re.compile(r"^[A-Z]{2}-\d{3}$")
GRID_ID = re.compile(r"^[A-Z]{2}-\d{3}_grid$")
COLOR_ID = re.compile(r"^C-\d{2}$")
SHEET_ID = re.compile(r"^sheet_\d{2}$")
CHARACTER_ID = re.compile(r"^CH-\d{3}$")
GROUP_ID = re.compile(r"^[A-H]_\d{3}-\d{3}$")


class Missing(Exception):
    """Raised when an upstream file the catalog promises is absent."""


def copy_checked(src: Path, dst_dir: Path, name: str) -> None:
    if not src.is_file():
        raise Missing(f"{src} (expected as {name})")
    dst = dst_dir / name
    shutil.copyfile(src, dst)


def collect(src_dir: Path, pattern: re.Pattern, label: str, problems: list[str]) -> list[Path]:
    out = []
    for p in sorted(src_dir.iterdir()):
        if not p.is_file():
            continue
        if pattern.match(p.stem):
            out.append(p)
        else:
            problems.append(f"{label}: unexpected file {p.name}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("upstream", type=Path, help="path to the handraw-style checkout")
    ap.add_argument("--catalog", type=Path, default=Path("data/catalog.json"),
                    help="catalog to validate coverage against")
    ap.add_argument("--out", type=Path, default=Path("assets"))
    args = ap.parse_args()

    root: Path = args.upstream.resolve()
    images = root / "images"
    if not images.is_dir():
        print(f"not an upstream checkout: {images} is missing", file=sys.stderr)
        return 2

    catalog = json.loads(args.catalog.read_text(encoding="utf-8")) if args.catalog.exists() else {}
    want_styles = {s["number"] for s in catalog.get("styles", [])}
    want_layouts = {x["id"] for x in catalog.get("layouts", [])}
    want_colors = {c["id"] for c in catalog.get("colors", [])}

    out: Path = args.out
    if out.exists():
        shutil.rmtree(out)
    styles_dir = out / "styles"
    layouts_dir = out / "layouts"
    colors_dir = out / "colors"
    groups_dir = out / "groups"
    characters_dir = out / "characters"
    for d in (styles_dir, layouts_dir, colors_dir, groups_dir, characters_dir):
        d.mkdir(parents=True, exist_ok=True)

    problems: list[str] = []
    counts: dict[str, int] = {}

    # ---- styles: 327 previews + 36 `_grid` reference sheets -----------------
    n_style = n_grid = 0
    for group_dir in sorted((images / "individual").iterdir()):
        if not group_dir.is_dir():
            continue
        for p in sorted(group_dir.iterdir()):
            if not p.is_file():
                continue
            if GRID_ID.match(p.stem):
                copy_checked(p, styles_dir, p.name)
                n_grid += 1
            elif STYLE_ID.match(p.stem):
                copy_checked(p, styles_dir, p.name)
                n_style += 1
            else:
                problems.append(f"individual/{group_dir.name}: unexpected file {p.name}")
    counts["styles"] = n_style
    counts["styles_grid"] = n_grid

    # ---- layouts: 165 previews ---------------------------------------------
    n_layout = 0
    for sub in LAYOUT_DIRS:
        d = images / "layouts" / sub
        if not d.is_dir():
            problems.append(f"layouts/{sub}: missing directory")
            continue
        for p in sorted(d.iterdir()):
            if not p.is_file():
                continue
            if not STYLE_ID.match(p.stem):
                problems.append(f"layouts/{sub}: unexpected file {p.name}")
                continue
            copy_checked(p, layouts_dir, p.name)
            n_layout += 1
    counts["layouts"] = n_layout

    # ---- colours: 36 swatches + 6 contact sheets ---------------------------
    n_color = n_sheet = 0
    for p in sorted((images / "colors").iterdir()):
        if not p.is_file():
            continue
        if COLOR_ID.match(p.stem):
            copy_checked(p, colors_dir, p.name)
            n_color += 1
        elif SHEET_ID.match(p.stem):
            copy_checked(p, colors_dir, p.name)
            n_sheet += 1
        else:
            problems.append(f"colors: unexpected file {p.name}")
    counts["colors"] = n_color
    counts["color_sheets"] = n_sheet

    # ---- group contact sheets ----------------------------------------------
    n_group = 0
    for p in sorted(images.iterdir()):
        if p.is_file() and GROUP_ID.match(p.stem):
            copy_checked(p, groups_dir, p.name)
            n_group += 1
    counts["groups"] = n_group

    # ---- characters ---------------------------------------------------------
    n_char = 0
    char_dir = images / "characters"
    if char_dir.is_dir():
        for p in sorted(char_dir.iterdir()):
            if p.is_file() and CHARACTER_ID.match(p.stem):
                copy_checked(p, characters_dir, p.name)
                n_char += 1
    counts["characters"] = n_char

    # ---- coverage: the catalog must not promise art we do not ship ----------
    have_styles = {p.stem for p in styles_dir.glob("*.webp") if STYLE_ID.match(p.stem)}
    have_layouts = {p.stem for p in layouts_dir.glob("*.webp")}
    have_colors = {p.stem for p in colors_dir.glob("*.webp") if COLOR_ID.match(p.stem)}

    for label, want, have in (
        ("style", want_styles, have_styles),
        ("layout", want_layouts, have_layouts),
        ("color", want_colors, have_colors),
    ):
        missing = sorted(want - have)
        if missing:
            problems.append(f"{len(missing)} {label}(s) in the catalog have no image: {missing[:8]}")
        extra = sorted(have - want)
        if extra:
            problems.append(f"{len(extra)} {label} image(s) have no catalog entry: {extra[:8]}")

    # ---- report -------------------------------------------------------------
    total = sum(p.stat().st_size for p in out.rglob("*.webp"))
    print(f"upstream   {root}")
    print(f"styles     {n_style:>4}   + {n_grid} grid sheets")
    print(f"layouts    {n_layout:>4}")
    print(f"colors     {n_color:>4}   + {n_sheet} contact sheets")
    print(f"groups     {n_group:>4}")
    print(f"characters {n_char:>4}")
    print(f"total      {total / 1024 / 1024:.1f} MB in {n_style + n_grid + n_layout + n_color + n_sheet + n_group + n_char} files")

    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  -", p)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
