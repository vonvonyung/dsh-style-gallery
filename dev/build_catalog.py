#!/usr/bin/env python3
"""Rebuild data/catalog.json from the upstream handraw-style reference JSON.

Why this exists
---------------
The gallery's catalog was first assembled by hand from `styles_200_reorganized.md`,
the human-readable rendering of the upstream library. That is the wrong source:

  * it only ever carried the *first* few traits of each style (the `.md` table is
    a summary; the full text lives in `references/styles.json`), so 257 of 288
    styles shipped with truncated feature text;
  * the layouts library (`references/layouts.json` + `layouts/*.md`) was missed
    entirely;
  * the colors lost 8 of their 12 fields.

The authoritative data is `skills/handdraw-style-prompter/references/*.json`
inside the upstream repo. This script reads those and emits one catalog that the
host half serves and the browser half renders.

Usage:
  python dev/build_catalog.py <upstream-repo-root> [--out data/catalog.json]

  <upstream-repo-root> is a checkout of https://github.com/yang0/handraw-style
  (the directory containing `version.json`).

  git clone --depth 1 https://github.com/yang0/handraw-style.git /c/tmp/handraw-upstream
  python dev/build_catalog.py /c/tmp/handraw-upstream

Re-running is safe: `hex` values added locally to colors are preserved, because
upstream ships color names only.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The upstream layout categories, in the order the library presents them, with
# the label and id prefix the docs use. Derived from LAYOUTS.md's section list.
LAYOUT_CATEGORIES = [
    ("social-card", "SC", "社媒卡", "Social Cards"),
    ("infographic", "IG", "信息图", "Infographics"),
    ("comic-storyboard", "SB", "漫画分镜", "Comic Storyboards"),
    ("ip-character", "IP", "IP设计", "IP Design"),
    ("ecommerce", "EC", "电商", "E-commerce"),
]

# Fallback palette, used only when a color has no hex yet (a fresh checkout has
# none). Keys are upstream color ids.
HEX_FALLBACK = {
    "C-01": "#002FA7", "C-02": "#6050DC", "C-03": "#003153", "C-04": "#0047AB",
    "C-05": "#3F00FF", "C-06": "#0E7C7B", "C-07": "#0ABAB5", "C-08": "#007BA7",
    "C-09": "#98FF98", "C-10": "#9CAF88", "C-11": "#50C878", "C-12": "#808000",
    "C-13": "#009B7D", "C-14": "#228B22", "C-15": "#E34234", "C-16": "#E60000",
    "C-17": "#800020", "C-18": "#D2411D", "C-19": "#FF033E", "C-20": "#FF00FF",
    "C-21": "#F88379", "C-22": "#C9A9A6", "C-23": "#B57EDC", "C-24": "#66023C",
    "C-25": "#F37021", "C-26": "#EC5800", "C-27": "#FADA5E", "C-28": "#D4A017",
    "C-29": "#CC7722", "C-30": "#FFFFF0", "C-31": "#536878", "C-32": "#36454F",
    "C-33": "#ACA39A", "C-34": "#FFFDD0", "C-35": "#708090", "C-36": "#B9A281",
}

# `SC-001` -> `social-card`, for recovering orphans that have no index entry.
LAYOUT_CATEGORY_BY_PREFIX = {prefix: cid for cid, prefix, _, _ in LAYOUT_CATEGORIES}

# The library ships 23 contact sheets named after the legacy ranges they cover
# (`A_001-016.webp`). They are the illustrations for STYLES.md's A-H 图鉴
# grouping, which is a *different* cut of the library from the FA-FH thematic
# groups in styles.json — same styles, ordered by legacy number instead.
SHEET_FILE = re.compile(r"^([A-H])_(\d{3})-(\d{3})$")
SHEET_SECTION = re.compile(r"^##\s+([A-H])\s*·\s*(.+?)（(\d{3})[–-](\d{3})）", re.M)

# A style id, used to spot calibration entries that escaped their container.
STYLE_ID = re.compile(r"^[A-Z]{2}-\d{3}$")

# Non-fatal divergences worth printing: they mean the catalog no longer mirrors
# upstream's index exactly, which is exactly the kind of drift that is easy to
# ship unnoticed.
warn_unindexed: list[str] = []

CJK = re.compile(r"[\u4e00-\u9fff]")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def split_group(raw: str) -> tuple[str, str, str]:
    """`"FA 国际社论幽默 / Editorial & Humor Doodle"` -> (FA, zh, en)."""
    head, _, tail = raw.partition("/")
    head = head.strip()
    label_zh = head[2:].strip() if len(head) > 2 else head
    return head[:2].strip(), label_zh, tail.strip()


def read_layout_prompts(layouts_dir: Path) -> dict[str, dict[str, str]]:
    """`layouts/SC-001.md` -> {"SC-001": {"zh": ..., "en": ...}}."""
    out: dict[str, dict[str, str]] = {}
    for path in sorted(layouts_dir.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        parts = re.split(r"<!--\s*(zh|en)\s*-->", text)
        # parts = ['', 'zh', '<body>', 'en', '<body>']
        got: dict[str, str] = {}
        for i in range(1, len(parts) - 1, 2):
            got[parts[i]] = parts[i + 1].strip()
        if got:
            out[path.stem] = got
    return out


# Layout prompt files open with their own title: `排版：<name>。` / `Layout: <name>.`
# (`IG-035.md` -> "排版：2.5D等距轴测微缩场景。" == its layouts.json `name`).
TITLE_ZH = re.compile(r"^\s*排版[：:]\s*(.+?)\s*。")
TITLE_EN = re.compile(r"^\s*Layout[：:]\s*(.+?)\s*\.")


def title_of(prompt: dict[str, str]) -> tuple[str, str]:
    """Recover (name, name_en) from a prompt file that has no index entry."""
    zh = TITLE_ZH.match(prompt.get("zh", ""))
    en = TITLE_EN.match(prompt.get("en", ""))
    return (zh.group(1) if zh else ""), (en.group(1) if en else "")


def normalize_model_caps(caps: dict) -> dict:
    """Hoist per-style calibration entries that leaked to the file's top level.

    Upstream 1.8.5's `model_capabilities.json` ends like this::

        "models": { "gpt-image-2": { ..., "styles": { ..., "FG-021": {...} } } },
        "FG-019": { "name_activation": "weak", "traits_activation": "strong" },
        "FG-020": { ... },
        "FG-021": { "name_activation": "strong", "traits_activation": "none" }

    So `FG-019` never made it into any model's `styles` map, while `FG-020` and
    `FG-021` are listed twice — once correctly nested, once at the top level with
    an identical value. They are plainly meant to be siblings of the other
    entries (same shape, and two of them already are), so the edit that added
    them just closed one brace too many.

    Left as-is the defect is nearly invisible: an uncalibrated model silently
    falls back to the reference image for that one style, which costs an attach
    step the library says it does not need. So hoist the strays where they
    belong and report both the hoist and the duplicates, the same way an
    unindexed layout is reported.
    """
    caps = json.loads(json.dumps(caps))  # don't mutate the caller's object
    strays = {k: v for k, v in caps.items() if STYLE_ID.match(k)}
    if not strays:
        return caps

    models = caps.get("models") or {}
    if not models:
        # Nothing to hoist into; leave the entries reachable via the flat lookup
        # the client already has, and just say so.
        warn_unindexed.append(
            "model calibration entries outside `models` and no model to adopt them: "
            + ", ".join(sorted(strays)))
        return caps

    redundant: list[str] = []
    for model_name, model in models.items():
        styles = model.setdefault("styles", {})
        for sid, entry in strays.items():
            existing = styles.get(sid)
            if existing is None:
                styles[sid] = entry
                warn_unindexed.append(
                    f"model calibration for {sid} was outside `models`; "
                    f"hoisted into {model_name}")
            elif existing != entry:
                # A real conflict: two different calibrations for one style.
                # Keep the nested one (it is the indexed, intended location) and
                # shout, because silently picking either could be wrong.
                warn_unindexed.append(
                    f"CONFLICT: {sid} calibrated twice with different values — "
                    f"kept {model_name}.styles[{sid}]={existing!r}, "
                    f"ignored top-level {entry!r}")
            elif sid not in redundant:
                # Same entry in both places: harmless, but it is still evidence
                # that the upstream file is malformed, so say so rather than
                # dropping it silently.
                redundant.append(sid)
    if redundant:
        warn_unindexed.append(
            "model calibration duplicated at the top level (same value, ignored): "
            + ", ".join(redundant))
    for sid in sorted(strays):
        caps.pop(sid, None)
    return caps


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("upstream", type=Path, help="path to the handraw-style checkout")
    ap.add_argument("--out", type=Path, default=Path("data/catalog.json"))
    ap.add_argument("--previous", type=Path, default=Path("data/catalog.json"),
                    help="existing catalog, read only to carry over locally added hex values")
    args = ap.parse_args()

    root: Path = args.upstream.resolve()
    refs = root / "skills" / "handdraw-style-prompter" / "references"
    if not refs.is_dir():
        print(f"not an upstream checkout: {refs} is missing", file=sys.stderr)
        return 2

    upstream_version = read_json(root / "version.json").get("version", "?")

    # ---- colors: carry over any hex already chosen locally -------------------
    hexes = dict(HEX_FALLBACK)
    if args.previous.exists():
        try:
            for c in read_json(args.previous).get("colors", []):
                if c.get("hex"):
                    hexes[c["id"]] = c["hex"]
        except Exception:
            pass

    # ---- styles -------------------------------------------------------------
    raw_styles = read_json(refs / "styles.json")
    alias = read_json(refs / "style_alias_map.json")
    new_to_legacy = alias.get("new_to_legacy", {})

    images = root / "images" / "individual"

    styles = []
    for s in raw_styles:
        gid, gzh, gen = split_group(s["group"])
        ref = (s.get("reference") or "").strip()
        styles.append({
            "number": s["number"],
            "legacy": new_to_legacy.get(s["number"], ""),
            "group": gid,
            # short Chinese label, kept for the group chips
            "group_zh": gzh,
            "group_en": gen,
            "name": s["generation_name"],
            "reference": ref,
            # the Chinese alias is just the reference name when that name is
            # Chinese; the UI shows it as a secondary label
            "alias_zh": ref if CJK.search(ref) else "",
            "traits": (s.get("traits") or "").strip(),
            # `{id}_grid.webp` is the reference sheet the skill ranks above the
            # single preview when a model cannot activate the style by name, so
            # the UI has to know which styles have one.
            "grid": (images / gid / (s["number"] + "_grid.webp")).is_file(),
        })

    groups = []
    for gid, gzh, gen in dict.fromkeys(
        (st["group"], st["group_zh"], st["group_en"]) for st in styles
    ):
        groups.append({
            "id": gid,
            "label_zh": gzh,
            "label_en": gen,
            "count": sum(1 for st in styles if st["group"] == gid),
        })

    # ---- layouts ------------------------------------------------------------
    raw_layouts = read_json(refs / "layouts.json")
    prompts = read_layout_prompts(refs / "layouts")

    layouts = []
    indexed = set()
    for x in raw_layouts:
        p = prompts.get(x["id"], {})
        indexed.add(x["id"])
        layouts.append({
            "id": x["id"],
            "category": x["category"],
            "name": x["name"],
            "name_en": x.get("name_en", ""),
            "keywords": x.get("keywords", []),
            "prompt_zh": p.get("zh", ""),
            "prompt_en": p.get("en", ""),
            "unindexed": False,
        })

    # Upstream ships art + a prompt file for a few layouts it never added to
    # `layouts.json` (IG-036 as of 1.8.5). Dropping them would silently lose
    # real content, so recover the title from the prompt file itself and flag
    # the entry — the flag is what makes the divergence visible rather than
    # hidden. Keywords stay empty because upstream never wrote them; inventing
    # them would be worse than the gap.
    orphans = []
    for lid, p in sorted(prompts.items()):
        if lid in indexed:
            continue
        name, name_en = title_of(p)
        if not name and not name_en:
            warn_unindexed.append(f"{lid} has a prompt file with no recoverable title")
            continue
        orphans.append(lid)
        layouts.append({
            "id": lid,
            "category": LAYOUT_CATEGORY_BY_PREFIX.get(lid[:2], ""),
            "name": name or name_en,
            "name_en": name_en,
            "keywords": [],
            "prompt_zh": p.get("zh", ""),
            "prompt_en": p.get("en", ""),
            "unindexed": True,
        })

    # An indexed layout whose prompt file is missing is a real regression: the
    # UI would show a layout that produces no prompt.
    for x in raw_layouts:
        if not prompts.get(x["id"]):
            warn_unindexed.append(f"{x['id']} is indexed but has no prompt file")

    layout_categories = [
        {
            "id": cid,
            "prefix": prefix,
            "label_zh": zh,
            "label_en": en,
            "count": sum(1 for x in layouts if x["category"] == cid),
        }
        for cid, prefix, zh, en in LAYOUT_CATEGORIES
        if any(x["category"] == cid for x in layouts)
    ]

    # ---- colors -------------------------------------------------------------
    colors = []
    for c in read_json(refs / "colors.json"):
        colors.append({
            "id": c["id"],
            "sheet": c["sheet"],
            "category": c["category"],
            "category_zh": c["category_zh"],
            "category_en": c["category_en"],
            "name_zh": c["name_zh"],
            "name_en": c["name_en"],
            "quote_zh": c.get("quote_zh", ""),
            "quote_en": c.get("quote_en", ""),
            "prompt_zh": c.get("prompt_zh", ""),
            "prompt_en": c.get("prompt_en", ""),
            "hex": hexes.get(c["id"], ""),
        })

    color_sheets = []
    for c in colors:
        if not any(s["sheet"] == c["sheet"] for s in color_sheets):
            color_sheets.append({
                "sheet": c["sheet"],
                "category_zh": c["category_zh"],
                "category_en": c["category_en"],
                "count": sum(1 for x in colors if x["sheet"] == c["sheet"]),
            })
    color_sheets.sort(key=lambda s: s["sheet"])

    # ---- model capabilities + attribution -----------------------------------
    caps = normalize_model_caps(read_json(refs / "model_capabilities.json"))
    attribution = read_json(refs / "attribution.json")

    # ---- contact sheets -----------------------------------------------------
    # Section titles come from STYLES.md so the UI can label the sheets the way
    # the library documents them, instead of inventing a caption.
    sections: dict[str, str] = {}
    styles_md = root / "STYLES.md"
    if styles_md.is_file():
        for m in SHEET_SECTION.finditer(styles_md.read_text(encoding="utf-8")):
            sections[m.group(1)] = m.group(2).strip()

    group_sheets = []
    for p in sorted((root / "images").glob("*.webp")):
        m = SHEET_FILE.match(p.stem)
        if not m:
            continue
        letter, lo, hi = m.group(1), int(m.group(2)), int(m.group(3))
        group_sheets.append({
            "file": p.name,
            "letter": letter,
            "from": lo,
            "to": hi,
            "section": sections.get(letter, ""),
        })
    group_sheets.sort(key=lambda s: s["from"])
    missing_sections = sorted({s["letter"] for s in group_sheets if not s["section"]})
    if missing_sections:
        warn_unindexed.append(
            "contact sheets with no STYLES.md section title: " + ", ".join(missing_sections))

    catalog = {
        "version": "2.0.0",
        "generatedFrom": {
            "repo": "https://github.com/yang0/handraw-style",
            "upstreamVersion": upstream_version,
            "license": "MIT with Attribution Requirement",
        },
        "counts": {
            "styles": len(styles),
            "groups": len(groups),
            "layouts": len(layouts),
            "layoutCategories": len(layout_categories),
            "colors": len(colors),
            "groupSheets": len(group_sheets),
        },
        "groups": groups,
        "styles": styles,
        "layoutCategories": layout_categories,
        "layouts": layouts,
        "colors": colors,
        "colorSheets": color_sheets,
        "groupSheets": group_sheets,
        "models": caps,
        "attribution": attribution,
    }

    out: Path = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(catalog, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    # ---- report -------------------------------------------------------------
    def longest(key, rows):
        return max((len(r.get(key) or "") for r in rows), default=0)

    print(f"upstream       {upstream_version}  ({root})")
    print(f"styles         {len(styles):>4}   traits: avg "
          f"{sum(len(s['traits']) for s in styles) // max(1, len(styles))} chars, "
          f"longest {longest('traits', styles)}")
    print(f"  grid sheets  {sum(1 for s in styles if s['grid']):>4}   "
          "(styles whose name alone may not activate the look)")
    print(f"  legacy ids   {sum(1 for s in styles if s['legacy']):>4}   mapped from 001-327")
    print(f"groups         {len(groups):>4}")
    print(f"layouts        {len(layouts):>4}   "
          f"with prompt_zh: {sum(1 for x in layouts if x['prompt_zh'])}"
          + (f", unindexed upstream: {orphans}" if orphans else ""))
    print(f"layout cats    {len(layout_categories):>4}   "
          + ", ".join(f"{c['id']}={c['count']}" for c in layout_categories))
    print(f"colors         {len(colors):>4}   with hex: {sum(1 for c in colors if c['hex'])}")
    print(f"group sheets   {len(group_sheets):>4}   "
          + ", ".join(f"{s['letter']}:{s['from']}-{s['to']}" for s in group_sheets[:4]) + " …")
    print(f"models         {len(caps.get('models', {})):>4} calibrated   "
          + ", ".join(f"{name}={len(m.get('styles', {}))} styles"
                      for name, m in caps.get("models", {}).items()))
    print(f"attribution    {len(attribution):>4} entries")
    print(f"\nwrote {out}  ({out.stat().st_size / 1024:.0f} KB)")

    if warn_unindexed:
        print("\nDRIFT (catalog no longer mirrors upstream's index exactly):")
        for w in warn_unindexed:
            print("  -", w)

    # Cheap invariants — these are the regressions this script exists to prevent.
    bad = []
    if not styles:
        bad.append("no styles")
    trunc = [s["number"] for s in styles if len(s["traits"]) > 0 and len(s["traits"]) < 8]
    if trunc:
        bad.append(f"{len(trunc)} styles with suspiciously short traits: {trunc[:5]}")
    missing_prompt = [x["id"] for x in layouts if not x["prompt_zh"]]
    if missing_prompt:
        bad.append(f"{len(missing_prompt)} layouts without a Chinese prompt: {missing_prompt[:5]}")
    if not all(c["hex"] for c in colors):
        bad.append("some colors have no hex")
    left_behind = [k for k in caps if STYLE_ID.match(k)]
    if left_behind:
        bad.append(f"calibration entries still outside `models`: {left_behind}")
    for name, m in caps.get("models", {}).items():
        unknown = [sid for sid in m.get("styles", {}) if not any(s["number"] == sid for s in styles)]
        if unknown:
            bad.append(f"{name} calibrates unknown styles: {unknown[:5]}")
    if bad:
        print("\nWARNINGS:")
        for b in bad:
            print("  -", b)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
