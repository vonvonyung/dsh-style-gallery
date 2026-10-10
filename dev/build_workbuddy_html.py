#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 dsh-style-gallery 的完整图库打包成一个**自包含单文件 HTML**，
让 WorkBuddy AI（或任何浏览器）也能"看图选风格 + 一键复制提示词"。

为什么需要它：WorkBuddy 没有 dsh 那种原生 UI 插件机制，但能预览 HTML。
WorkBuddy 的预览面板只托管单个 HTML，任何外链资源都会 404 ——
所以图片必须 base64 内嵌，做成自包含。

提示词逻辑不在这里维护：脚本会从 ../client.js 里把 @prompt-core 标记之间的
代码**原样抽出来**内嵌进页面。这样 dsh 插件和这个单文件页面跑的永远是同一份
实现，不会各改各的。

用法:
  python build_workbuddy_html.py <插件目录> <输出html> [quality] [max_edge]

  例: python build_workbuddy_html.py . "C:/path/风格图库.html"

quality  : webp 质量，默认 78
max_edge : 可选的总旋钮。**不传**时每类图片各用自己的长边上限
           （styles/layouts 448、colors 300、groups 560，见 ENCODE_PLAN）；
           传了就**覆盖全部类别**；传 0 表示完全不缩放。
           一律不放大，只缩小。
"""

import base64
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

# 每类图片的编码参数。风格缩略图原生只有 ~302px，版式预览是 512px 宽的构图图，
# 组图是 1254px 的接触印相表 —— 各按用途给不同的长边上限，别用一套参数糟蹋。
ENCODE_PLAN = [
    # (资源目录, 数据里的键前缀, 长边上限)
    ("styles", "styles", 448),
    ("layouts", "layouts", 448),
    ("colors", "colors", 300),
    ("groups", "groups", 560),
]

PROMPT_CORE_START = "/* @prompt-core:start */"
PROMPT_CORE_END = "/* @prompt-core:end */"


def extract_prompt_core(plugin_dir: Path) -> str:
    """把 client.js 里的提示词实现整段搬过来，去掉模块缩进。

    这是本脚本唯一正确的做法：两处各写一份，早晚会分叉，而分叉的表现是
    「同一个风格在 dsh 里和在 WorkBuddy 里给出的提示词不一样」—— 很难被发现。
    """
    src = (plugin_dir / "client.js").read_text("utf-8")
    start = src.index(PROMPT_CORE_START) + len(PROMPT_CORE_START)
    end = src.index(PROMPT_CORE_END)
    body = src[start:end]

    lines = [ln for ln in body.split("\n")]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    # 去掉 factory 里的 4 空格缩进
    indents = [len(ln) - len(ln.lstrip(" ")) for ln in lines if ln.strip()]
    cut = min(indents) if indents else 0
    return "\n".join(ln[cut:] if ln.strip() else "" for ln in lines)


def encode(path: Path, max_edge: int, quality: int) -> str:
    with Image.open(path) as im:
        im = im.convert("RGB")
        if max_edge and max(im.size) > max_edge:
            r = max_edge / max(im.size)
            im = im.resize(
                (max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))),
                Image.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 1
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 78
    # Optional single knob for "make the whole file smaller". Omitted -> each
    # kind keeps the edge ENCODE_PLAN gives it (a 302px style thumb does not
    # want the same ceiling as a 1254px contact sheet). Given and > 0 -> that
    # edge wins for every kind. Given as 0 -> no downscaling at all.
    max_edge = int(sys.argv[4]) if len(sys.argv) > 4 else None

    catalog = json.loads((src / "data" / "catalog.json").read_text("utf-8"))
    core = extract_prompt_core(src)
    print("prompt core:", len(core.splitlines()), "lines from client.js")

    # 数据层：与 dsh 插件同一份 catalog，整包带过去。
    data = {
        "version": catalog.get("version"),
        "generatedFrom": catalog.get("generatedFrom"),
        "groups": catalog["groups"],
        "styles": catalog["styles"],
        "layouts": catalog["layouts"],
        "layoutCategories": catalog["layoutCategories"],
        "colors": catalog["colors"],
        "colorSheets": catalog["colorSheets"],
        "groupSheets": catalog["groupSheets"],
        "models": catalog["models"],
        "attribution": catalog["attribution"],
    }

    images = {}
    total_bytes = 0
    for kind, key, planned_edge in ENCODE_PLAN:
        edge = planned_edge if max_edge is None else max_edge
        files = sorted((src / "assets" / kind).glob("*.webp"))
        print(f"{kind}: {len(files)} files @ max_edge {edge or 'native'}")
        for i, p in enumerate(files, 1):
            uri = encode(p, edge, quality)
            images[key + "/" + p.stem] = uri
            total_bytes += len(uri)
            if i % 60 == 0:
                print(f"   encoded {i}/{len(files)}")
        if not files:
            print(f"   WARNING: no files under assets/{kind}")

    html = (
        HTML_TEMPLATE
        .replace("/*__PROMPT_CORE__*/", core)
        .replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))
        .replace("__IMAGES__", json.dumps(images, separators=(",", ":")))
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, "utf-8")
    print(
        "wrote", out, round(out.stat().st_size / 1024 / 1024, 2), "MB",
        "|", len(images), "images |", round(total_bytes / 1024 / 1024, 2), "MB of base64",
    )
    return 0


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>手绘风格图库 · 327 种风格 + 166 种版式</title>
<style>
:root{--fg:#1f2328;--bg:#fff;--mut:#6b7280;--bd:rgba(0,0,0,.12);--pri:#3b82f6;--soft:rgba(127,127,127,.08);--warn:#b45309}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}
.wrap{max-width:1180px;margin:0 auto;padding:20px 18px 40px}
h1{font-size:19px;margin:0 0 3px}
.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
.tabs{display:flex;gap:2px;border-bottom:1px solid var(--bd);margin-bottom:12px}
.tab{padding:6px 14px;font-size:13.5px;border:none;background:transparent;color:inherit;cursor:pointer;opacity:.6;border-bottom:2px solid transparent;margin-bottom:-1px;line-height:1.6}
.tab:hover{opacity:.85}
.tab.on{opacity:1;font-weight:600;border-bottom-color:var(--pri)}
.tab .n{opacity:.6;margin-left:5px;font-size:11px}
.bar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
input[type=text]{flex:1 1 260px;min-width:200px;padding:8px 11px;font-size:13.5px;border:1px solid var(--bd);border-radius:8px;outline:none;background:#fff;color:inherit}
input[type=text]:focus{border-color:var(--pri)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}
.chip{padding:4px 11px;font-size:12px;border:1px solid var(--bd);border-radius:999px;background:transparent;color:inherit;cursor:pointer;line-height:1.6}
.chip:hover{background:var(--soft)}
.chip.on{background:var(--pri);border-color:transparent;color:#fff}
.chip .n{opacity:.6;margin-left:4px;font-size:11px}
.chip.on .n{opacity:.85}
/* 主题色按钮：整体填成该颜色本身。必须排在 .chip.on 之后 ——
   两者同特异性，靠顺序取胜；而 background/color 走内联样式，
   天然压过 .chip.on 的蓝底白字。 */
.chip.c{border-color:rgba(0,0,0,.3);font-weight:600;text-shadow:none}
.chip.c:hover{filter:brightness(1.12)}
.chip.c.on{border-color:rgba(0,0,0,.6);box-shadow:0 0 0 2px var(--bg),0 0 0 4px var(--pri)}
.lab{font-size:12px;font-weight:600;color:var(--mut);margin:2px 0 6px}
.count{font-size:12.5px;color:var(--mut);margin:10px 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.card{border:1px solid var(--bd);border-radius:10px;overflow:hidden;display:flex;flex-direction:column;background:#fff}
.card:hover{border-color:var(--pri);box-shadow:0 2px 10px rgba(0,0,0,.09)}
.thumb{position:relative;cursor:pointer;background:var(--soft);line-height:0}
.thumb img{width:100%;height:auto;display:block}
.badge{position:absolute;left:6px;top:6px;padding:1px 6px;font-size:10px;font-weight:600;border-radius:5px;background:rgba(0,0,0,.62);color:#fff;letter-spacing:.3px}
.refbadge{position:absolute;right:6px;top:6px;padding:1px 6px;font-size:10px;font-weight:600;border-radius:5px;background:rgba(180,83,9,.88);color:#fff}
.meta{padding:7px 8px 0;display:flex;flex-direction:column;gap:3px}
.nm{font-size:11.5px;font-weight:600;line-height:1.35}
.tr{font-size:10.5px;color:var(--mut);line-height:1.35}
.acts{display:flex;gap:5px;padding:7px 8px 8px;margin-top:auto}
.btn{flex:1;padding:5px 6px;font-size:11px;border:1px solid var(--bd);border-radius:7px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
.btn:hover{background:var(--soft)}
.btn.pri{background:var(--pri);border-color:transparent;color:#fff}
.btn.ok{background:#16a34a;border-color:transparent;color:#fff}
.msg{padding:30px 12px;text-align:center;color:var(--mut)}
.mask{position:fixed;inset:0;background:rgba(0,0,0,.55);display:none;align-items:center;justify-content:center;padding:16px;z-index:50}
.mask.on{display:flex}
.modal{background:#fff;border-radius:12px;max-width:700px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.mhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--bd);position:sticky;top:0;background:#fff;z-index:1}
.mtitle{font-size:14px;font-weight:600;flex:1}
.seg{display:inline-flex;border:1px solid var(--bd);border-radius:7px;overflow:hidden}
.seg button{padding:3px 10px;font-size:11px;border:none;background:transparent;color:inherit;cursor:pointer;line-height:1.6}
.seg button+button{border-left:1px solid var(--bd)}
.seg button.on{background:var(--pri);color:#fff}
.x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:var(--mut);padding:2px 6px;border-radius:6px}
.x:hover{background:var(--soft)}
.mbody{padding:14px;display:flex;flex-direction:column;gap:12px}
.mimg{width:100%;max-height:320px;object-fit:contain;border-radius:8px;background:var(--soft);cursor:zoom-in;display:block}
.mimg.zoom{max-height:none;cursor:zoom-out}
.hint{font-size:11px;color:var(--mut);text-align:center;margin-top:-6px}
.field{display:flex;flex-direction:column;gap:5px}
.flab{font-size:12px;font-weight:600;color:var(--mut)}
.flabrow{display:flex;align-items:center;gap:8px}
.flabrow .flab{flex:1}
textarea{width:100%;min-height:170px;padding:9px 10px;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--bd);border-radius:8px;background:#fff;color:inherit;resize:vertical;outline:none;white-space:pre-wrap}
textarea:focus{border-color:var(--pri)}
.mfoot{display:flex;gap:8px;padding:0 14px 14px}
.note{font-size:11.5px;line-height:1.55;color:#4b5563;background:var(--soft);border-radius:7px;padding:7px 9px}
.note.warn{background:rgba(180,83,9,.13);color:#7c2d12}
.kv{font-size:12px;line-height:1.55}
.kws{display:flex;flex-wrap:wrap;gap:5px}
.kw{padding:2px 8px;font-size:11px;border-radius:999px;background:var(--soft)}
.pick{border:1px solid var(--bd);border-radius:8px;overflow:hidden}
.pick input{border:none;border-bottom:1px solid var(--bd);border-radius:0;font-size:12px;padding:6px 8px}
.picklist{max-height:150px;overflow:auto}
.pickitem{display:flex;gap:8px;align-items:center;width:100%;padding:5px 8px;font-size:12px;border:none;background:transparent;color:inherit;cursor:pointer;text-align:left;line-height:1.5}
.pickitem:hover{background:var(--soft)}
.pickitem.on{background:var(--pri);color:#fff}
.pickitem .pid{font:10.5px ui-monospace,Menlo,Consolas,monospace;opacity:.6}
.pickitem.on .pid{opacity:.9}
.pickitem .pnm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.credit{margin-top:26px;padding-top:12px;border-top:1px solid var(--bd);font-size:11.5px;color:var(--mut);text-align:center}
.credit a{color:inherit}
</style>
</head>
<body>
<div class="wrap">
  <h1>手绘风格图库</h1>
  <div class="sub">327 种手绘风格 + 166 种版式 · 看图选风格 · 一键复制提示词</div>

  <div class="tabs">
    <button class="tab on" id="tab-styles">风格<span class="n" id="n-styles"></span></button>
    <button class="tab" id="tab-layouts">版式<span class="n" id="n-layouts"></span></button>
    <button class="tab" id="tab-sheets">总览<span class="n" id="n-sheets"></span></button>
  </div>

  <div class="bar">
    <input type="text" id="q" placeholder="搜索风格名 / 编号 / 作者 / 特征，例如：蜡笔、041、Risograph">
  </div>
  <div class="chips" id="gchips"></div>
  <div id="colorBlock">
    <div class="lab">主题色 <span style="font-weight:400;opacity:.75">— 可选。选中后会把「主题色：xxx」写进提示词，不改变上方筛选结果</span></div>
    <div class="chips" id="cchips"></div>
  </div>
  <div class="count" id="count"></div>
  <div class="grid" id="grid"></div>

  <div class="credit">
    风格数据与预览图来自
    <a href="https://github.com/yang0/handraw-style" target="_blank" rel="noreferrer noopener">yang0/handraw-style</a>
    （MIT 授权，需署名）
  </div>
</div>

<div class="mask" id="mask">
  <div class="modal">
    <div class="mhead">
      <div class="mtitle" id="mtitle"></div>
      <div class="seg" id="mlang">
        <button data-lang="zh" class="on">中文</button>
        <button data-lang="en">EN</button>
      </div>
      <button class="x" id="mx">&times;</button>
    </div>
    <div class="mbody" id="mbody"></div>
    <div class="mfoot">
      <button class="btn pri" id="mcopy">复制提示词</button>
      <button class="btn" id="mcopy2">复制版式提示词</button>
    </div>
  </div>
</div>

<script>
/* ===================== 数据 ===================== */
var DATA = __DATA__;
var IMGS = __IMAGES__;

var S = DATA.styles, G = DATA.groups, C = DATA.colors;
var L = DATA.layouts, LC = DATA.layoutCategories, SH = DATA.groupSheets;
var byColor = {}, byStyle = {}, byLayout = {};
C.forEach(function (c) { byColor[c.id] = c; });
S.forEach(function (s) { byStyle[s.number] = s; });
L.forEach(function (x) { byLayout[x.id] = x; });

/* ===================== 提示词实现 =====================
 * 下面这段是从 ../client.js 的 @prompt-core 标记之间原样抽出来的，
 * 不要在这里改 —— 要改就改 client.js，然后重新跑构建脚本。
 */
/*__PROMPT_CORE__*/
/* ===================== 提示词实现结束 ===================== */

/** 库自己的文档用老编号（#041），卡片上显示的就是它。 */
function legacyOf(style) { return style.legacy ? '#' + style.legacy : style.number; }
function pad3(n) { return String(n).padStart(3, '0'); }

var st = { tab: 'styles', q: '', g: 'all', c: '', lc: 'all' };

function copy(text, btn, okText) {
  var done = function () {
    if (!btn) return;
    var old = btn.textContent;
    btn.textContent = okText;
    btn.classList.add('ok');
    setTimeout(function () { btn.textContent = old; btn.classList.remove('ok'); }, 1400);
  };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallback(text); done(); });
      return;
    }
  } catch (e) { /* fall through */ }
  fallback(text); done();
}
function fallback(text) {
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) { /* ignore */ }
}

/* WCAG 相对亮度，用来决定色块上的文字该用黑还是白。 */
function lum(hex) {
  var r = parseInt(hex.slice(1, 3), 16) / 255,
      g = parseInt(hex.slice(3, 5), 16) / 255,
      b = parseInt(hex.slice(5, 7), 16) / 255;
  function f(c) { return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
/* 黑/白里挑对比度更高的那个 —— 固定阈值会在中灰上翻车
   （暖灰 #ACA39A 用白字只有 2.5:1，用黑字有 8.4:1）。
   用纯黑纯白而非 #111/#eee：这样最坏情况也恰好落在两线交点
   L=0.179 上，对比度 4.58:1，稳过 WCAG AA 的 4.5:1。 */
function fgOn(hex) {
  var L = lum(hex);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/* ===================== 筛选 ===================== */
function styleHay(s) {
  return [s.number, s.legacy, s.name, s.reference, s.alias_zh, s.traits]
    .filter(Boolean).join(' ').toLowerCase();
}
function layoutHay(x) {
  return [x.id, x.name, x.name_en, (x.keywords || []).join(' '), x.prompt_zh]
    .filter(Boolean).join(' ').toLowerCase();
}
function filteredStyles() {
  var q = st.q.trim().toLowerCase();
  return S.filter(function (s) {
    if (st.g !== 'all' && s.group !== st.g) return false;
    // 主题色不是风格的属性，而是「配色参数」——它只影响生成的提示词，不参与筛选。
    if (!q) return true;
    return styleHay(s).indexOf(q) >= 0;
  });
}
function filteredLayouts() {
  var q = st.q.trim().toLowerCase();
  return L.filter(function (x) {
    if (st.lc !== 'all' && x.category !== st.lc) return false;
    if (!q) return true;
    return layoutHay(x).indexOf(q) >= 0;
  });
}

/* ===================== 渲染 ===================== */
function renderChips() {
  var gc = document.getElementById('gchips');
  gc.innerHTML = '';
  if (st.tab === 'sheets') { gc.style.display = 'none'; return; }
  gc.style.display = '';

  var all = el('button', 'chip' + (st.g === 'all' ? ' on' : ''), '全部');
  all.appendChild(el('span', 'n', String(S.length)));
  all.onclick = function () { st.g = 'all'; render(); };
  gc.appendChild(all);

  if (st.tab === 'styles') {
    G.forEach(function (g) {
      var b = el('button', 'chip' + (st.g === g.id ? ' on' : ''), g.label_zh || g.id);
      b.title = g.id + (g.label_en ? ' · ' + g.label_en : '');
      b.appendChild(el('span', 'n', String(g.count)));
      b.onclick = function () { st.g = g.id; render(); };
      gc.appendChild(b);
    });
  } else {
    LC.forEach(function (c) {
      var b = el('button', 'chip' + (st.lc === c.id ? ' on' : ''), c.label_zh || c.id);
      b.title = c.prefix + (c.label_en ? ' · ' + c.label_en : '');
      b.appendChild(el('span', 'n', String(c.count)));
      b.onclick = function () { st.lc = c.id; render(); };
      gc.appendChild(b);
    });
  }

  var cc = document.getElementById('cchips');
  cc.innerHTML = '';
  var any = el('button', 'chip' + (st.c === '' ? ' on' : ''), '不指定');
  any.onclick = function () { st.c = ''; render(); };
  cc.appendChild(any);
  C.forEach(function (c) {
    var b = el('button', 'chip c' + (st.c === c.id ? ' on' : ''), c.name_zh || c.id);
    if (c.hex) {
      b.style.background = c.hex;
      b.style.color = fgOn(c.hex);
      // 象牙白 / 奶油白这类近白色在白底上会糊成一片，跟「不指定」分不清 —— 加深描边。
      if (lum(c.hex) > 0.62) b.style.borderColor = 'rgba(0,0,0,.45)';
    }
    b.title = [c.name_en, c.hex, c.category_zh, c.quote_zh].filter(Boolean).join('　');
    b.onclick = function () { st.c = c.id; render(); };
    cc.appendChild(b);
  });
}

function render() {
  document.getElementById('tab-styles').className = 'tab' + (st.tab === 'styles' ? ' on' : '');
  document.getElementById('tab-layouts').className = 'tab' + (st.tab === 'layouts' ? ' on' : '');
  document.getElementById('tab-sheets').className = 'tab' + (st.tab === 'sheets' ? ' on' : '');
  document.getElementById('colorBlock').style.display = st.tab === 'styles' ? '' : 'none';
  document.getElementById('q').style.display = st.tab === 'sheets' ? 'none' : '';
  document.getElementById('q').placeholder = st.tab === 'styles'
    ? '搜索风格名 / 编号 / 作者 / 特征，例如：蜡笔、041、Risograph'
    : '搜索版式名 / 关键词，例如：九宫格、SC-001、分镜';

  renderChips();

  var grid = document.getElementById('grid');
  grid.innerHTML = '';

  if (st.tab === 'sheets') {
    document.getElementById('count').textContent =
      SH.length + ' 张拼图 · 按老编号 001–327 分段的全库拼图大表，和 STYLES.md 的 A–H 分组一致';
    SH.forEach(function (sh) {
      var card = el('div', 'card');
      var thumb = el('div', 'thumb');
      var img = document.createElement('img');
      img.src = IMGS['groups/' + sh.file.replace(/\.webp$/, '')] || '';
      img.alt = sh.file;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.appendChild(el('span', 'badge',
        sh.letter + ' · ' + pad3(sh.from) + '–' + pad3(sh.to)));
      thumb.onclick = function () { openSheet(sh); };
      card.appendChild(thumb);

      var meta = el('div', 'meta');
      meta.appendChild(el('div', 'nm', sh.section || sh.file));
      meta.appendChild(el('div', 'tr', '#' + pad3(sh.from) + ' – #' + pad3(sh.to)));
      card.appendChild(meta);
      grid.appendChild(card);
    });
    return;
  }

  if (st.tab === 'styles') {
    var list = filteredStyles();
    var cc = byColor[st.c];
    document.getElementById('count').textContent =
      list.length + ' / ' + S.length + ' 种风格' +
      (cc ? '　·　提示词将带上主题色：' + (cc.name_zh || cc.id) : '');
    if (!list.length) { grid.appendChild(el('div', 'msg', '没有匹配的风格')); return; }
    list.forEach(function (s) {
      var card = el('div', 'card');
      var thumb = el('div', 'thumb');
      var img = document.createElement('img');
      img.src = IMGS['styles/' + s.number] || '';
      img.alt = s.name;
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.appendChild(el('span', 'badge', legacyOf(s)));
      if (resolveActivation(DATA, s).useReference) {
        var rb = el('span', 'refbadge', '需参考图');
        rb.title = '此风格需要随提示词附上参考图，模型才能还原到位';
        thumb.appendChild(rb);
      }
      thumb.onclick = function () { openStyle(s); };
      card.appendChild(thumb);

      var meta = el('div', 'meta');
      meta.appendChild(el('div', 'nm', s.name));
      meta.appendChild(el('div', 'tr', (s.traits || '').slice(0, 42)));
      card.appendChild(meta);

      var acts = el('div', 'acts');
      var b1 = el('button', 'btn pri', '复制提示词');
      b1.onclick = function () {
        copy(stylePrompt(s, '', byColor[st.c] || null, { catalog: DATA, lang: 'zh' }), b1, '✓ 已复制');
      };
      acts.appendChild(b1);
      var b2 = el('button', 'btn', '看大图');
      b2.onclick = function () { openStyle(s); };
      acts.appendChild(b2);
      card.appendChild(acts);
      grid.appendChild(card);
    });
    return;
  }

  var layouts = filteredLayouts();
  document.getElementById('count').textContent = layouts.length + ' / ' + L.length + ' 种版式';
  if (!layouts.length) { grid.appendChild(el('div', 'msg', '没有匹配的版式')); return; }
  layouts.forEach(function (x) {
    var card = el('div', 'card');
    var thumb = el('div', 'thumb');
    var img = document.createElement('img');
    img.src = IMGS['layouts/' + x.id] || '';
    img.alt = x.name;
    img.loading = 'lazy';
    thumb.appendChild(img);
    thumb.appendChild(el('span', 'badge', x.id));
    thumb.onclick = function () { openLayout(x); };
    card.appendChild(thumb);

    var meta = el('div', 'meta');
    meta.appendChild(el('div', 'nm', x.name));
    meta.appendChild(el('div', 'tr', (x.keywords || []).join('、') || x.name_en || ''));
    card.appendChild(meta);

    var acts = el('div', 'acts');
    var b1 = el('button', 'btn pri', '看详情');
    b1.onclick = function () { openLayout(x); };
    acts.appendChild(b1);
    card.appendChild(acts);
    grid.appendChild(card);
  });
}

/* ===================== 弹窗 ===================== */
var cur = { kind: null, style: null, layout: null, sheet: null, lang: 'zh', theme: '', pick: '' };

function picker(items, value, haystack, placeholder, onPick) {
  var box = el('div', 'pick');
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder;
  box.appendChild(input);
  var list = el('div', 'picklist');
  box.appendChild(list);

  function draw() {
    var n = input.value.trim().toLowerCase();
    var shown = (n ? items.filter(function (it) { return haystack(it).indexOf(n) >= 0; }) : items).slice(0, 60);
    list.innerHTML = '';
    if (!shown.length) { list.appendChild(el('div', 'msg', '没有匹配项')); return; }
    shown.forEach(function (it) {
      var b = el('button', 'pickitem' + (it.id === value() ? ' on' : ''));
      b.appendChild(el('span', 'pid', it.id));
      b.appendChild(el('span', 'pnm', it.label));
      b.onclick = function () { onPick(it.id); };
      list.appendChild(b);
    });
  }
  input.addEventListener('input', draw);
  draw();
  return box;
}

function openModal() { document.getElementById('mask').classList.add('on'); }
function closeModal() {
  document.getElementById('mask').classList.remove('on');
  cur = { kind: null, style: null, layout: null, sheet: null, lang: cur.lang, theme: '', pick: '' };
}

function openStyle(s) {
  cur.kind = 'style'; cur.style = s; cur.layout = null; cur.sheet = null; cur.theme = ''; cur.pick = '';
  drawModal();
  openModal();
}
function openLayout(x) {
  cur.kind = 'layout'; cur.layout = x; cur.style = null; cur.sheet = null; cur.theme = ''; cur.pick = '';
  drawModal();
  openModal();
}
function openSheet(sh) {
  cur.kind = 'sheet'; cur.sheet = sh; cur.style = null; cur.layout = null; cur.theme = ''; cur.pick = '';
  drawModal();
  openModal();
}

function activeStyle() {
  if (cur.kind === 'style') return cur.style;
  return cur.pick ? byStyle[cur.pick] : null;
}
function activeLayout() {
  if (cur.kind === 'layout') return cur.layout;
  return cur.pick ? byLayout[cur.pick] : null;
}

function currentPrompt() {
  var s = activeStyle(), x = activeLayout();
  if (s) return stylePrompt(s, cur.theme, byColor[st.c] || null, { catalog: DATA, lang: cur.lang, layout: x });
  if (x) return layoutPrompt(x, cur.theme, cur.lang);
  return '';
}

function drawModal() {
  var body = document.getElementById('mbody');
  body.innerHTML = '';

  var s = cur.style, x = cur.layout, sh = cur.sheet;
  var head = s ? s.number + ' · ' + legacyOf(s) + ' · ' + s.name
    : x ? x.id + ' · ' + x.name
      : sh.letter + ' · #' + pad3(sh.from) + '–#' + pad3(sh.to) + (sh.section ? ' · ' + sh.section : '');
  document.getElementById('mtitle').textContent = head;
  Array.prototype.forEach.call(document.querySelectorAll('#mlang button'), function (b) {
    b.className = b.dataset.lang === cur.lang ? 'on' : '';
  });

  // 拼图总览只有一张大图，没有提示词可生成。
  document.getElementById('mlang').style.display = sh ? 'none' : '';
  document.getElementById('mcopy').style.display = sh ? 'none' : '';
  document.getElementById('mcopy2').style.display = sh ? 'none' : '';

  var main = document.createElement('img');
  main.id = 'mimg';
  main.className = 'mimg';
  main.src = s ? (IMGS['styles/' + s.number] || '')
    : x ? (IMGS['layouts/' + x.id] || '')
      : (IMGS['groups/' + sh.file.replace(/\.webp$/, '')] || '');
  main.alt = s ? s.name : x ? x.name : sh.file;
  main.onclick = function () { this.classList.toggle('zoom'); };
  body.appendChild(main);
  body.appendChild(el('div', 'hint', '点图片可放大 / 缩小'));
  if (sh) return;

  if (s) {
    var act = resolveActivation(DATA, s);
    var f1 = el('div', 'field');
    var row = el('div', 'flabrow');
    row.appendChild(el('span', 'flab', '风格特征'));
    row.appendChild(el('span', 'hint', '激活方式：' + (act.source === 'name+style' ? '仅风格名'
      : act.source === 'name+style+traits' ? '风格名 + 特征' : '需要参考图')));
    f1.appendChild(row);
    f1.appendChild(el('div', 'kv', act.traits || s.traits || '—'));
    body.appendChild(f1);

    if (s.reference && s.reference !== s.name) {
      var f2 = el('div', 'field');
      f2.appendChild(el('span', 'flab', '参考作者 / 风格名称'));
      f2.appendChild(el('div', 'kv', s.reference));
      body.appendChild(f2);
    }

    if (act.useReference) {
      // 页面是自包含的：参考图就在本文件里，所以直接给一个下载按钮，
      // 用户拿到文件后在生图模型里当垫图上传即可。
      var f3 = el('div', 'field');
      f3.appendChild(el('span', 'flab', '参考图（请随提示词一起上传）'));
      var rimg = document.createElement('img');
      rimg.className = 'mimg';
      rimg.src = IMGS['styles/' + referenceFile(s).replace(/\.webp$/, '')] || '';
      rimg.alt = s.name + ' 参考图';
      f3.appendChild(rimg);
      f3.appendChild(el('div', 'note warn', '此风格需要随提示词附上参考图，模型才能还原到位。'));
      var dl = el('a', 'btn', '下载参考图');
      dl.href = rimg.src;
      dl.download = referenceFile(s);
      dl.style.cssText = 'text-align:center;text-decoration:none;display:block;margin-top:6px';
      f3.appendChild(dl);
      body.appendChild(f3);
    }

    var f4 = el('div', 'field');
    f4.appendChild(el('span', 'flab', '版式（可选，选中后按图文模式拼接）'));
    f4.appendChild(picker(
      L.map(function (it) { return { id: it.id, label: it.name }; }),
      function () { return cur.pick; },
      function (it) { return layoutHay(byLayout[it.id]); },
      '搜索版式名 / 关键词',
      function (id) { cur.pick = (cur.pick === id ? '' : id); drawModal(); }
    ));
    body.appendChild(f4);
  } else {
    var note = el('div', 'note', x.category === 'ecommerce'
      ? '电商版式：不追加通用图文后缀。'
      : '已启用图文模式：版式提示词 + 固定图文后缀。');
    body.appendChild(note);

    if ((x.keywords || []).length) {
      var kf = el('div', 'field');
      kf.appendChild(el('span', 'flab', '关键词'));
      var kws = el('div', 'kws');
      x.keywords.forEach(function (k) { kws.appendChild(el('span', 'kw', k)); });
      kf.appendChild(kws);
      body.appendChild(kf);
    }

    var sf = el('div', 'field');
    sf.appendChild(el('span', 'flab', '画风（可选，选中后把风格拼进来）'));
    sf.appendChild(picker(
      S.map(function (it) { return { id: it.number, label: it.name }; }),
      function () { return cur.pick; },
      function (it) { return styleHay(byStyle[it.id]); },
      '搜索风格名 / 编号 / 作者',
      function (id) { cur.pick = (cur.pick === id ? '' : id); drawModal(); }
    ));
    body.appendChild(sf);
  }

  var tf = el('div', 'field');
  tf.appendChild(el('span', 'flab', '想画什么主题？（可留空，会留出占位符）'));
  var ti = document.createElement('input');
  ti.type = 'text';
  ti.id = 'mtheme';
  ti.value = cur.theme;
  ti.placeholder = '例如：春天的第一杯奶茶';
  ti.addEventListener('input', function () {
    cur.theme = ti.value;
    document.getElementById('mtext').value = currentPrompt();
  });
  tf.appendChild(ti);
  body.appendChild(tf);

  var pf = el('div', 'field');
  pf.appendChild(el('span', 'flab', '提示词（已按上游规则生成，可直接复制）'));
  var ta = document.createElement('textarea');
  ta.id = 'mtext';
  ta.readOnly = true;
  ta.value = currentPrompt();
  pf.appendChild(ta);
  body.appendChild(pf);
}

/* ===================== 事件 ===================== */
document.getElementById('tab-styles').onclick = function () { st.tab = 'styles'; st.q = ''; document.getElementById('q').value = ''; render(); };
document.getElementById('tab-layouts').onclick = function () { st.tab = 'layouts'; st.q = ''; document.getElementById('q').value = ''; render(); };
document.getElementById('tab-sheets').onclick = function () { st.tab = 'sheets'; st.q = ''; document.getElementById('q').value = ''; render(); };
document.getElementById('q').addEventListener('input', function (e) { st.q = e.target.value; render(); });
document.getElementById('mx').onclick = closeModal;
document.getElementById('mask').addEventListener('click', function (e) { if (e.target.id === 'mask') closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });
document.getElementById('mlang').addEventListener('click', function (e) {
  var b = e.target.closest('button');
  if (!b) return;
  cur.lang = b.dataset.lang;
  drawModal();
});
document.getElementById('mcopy').onclick = function () { copy(currentPrompt(), this, '✓ 已复制'); };
document.getElementById('mcopy2').onclick = function () {
  var x = activeLayout();
  if (!x) { this.textContent = '未选版式'; var b = this; setTimeout(function () { b.textContent = '复制版式提示词'; }, 1400); return; }
  copy(layoutPrompt(x, cur.theme, cur.lang), this, '✓ 已复制');
};

document.getElementById('n-styles').textContent = String(S.length);
document.getElementById('n-layouts').textContent = String(L.length);
document.getElementById('n-sheets').textContent = String(SH.length);
render();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    sys.exit(main())
