#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把 dsh-style-gallery 的 288 张预览图 + catalog 打包成一个**自包含单文件 HTML**，
让 WorkBuddy AI（或任何浏览器）也能"看图选风格 + 一键复制提示词"。

为什么需要它：WorkBuddy 没有 dsh 那种原生 UI 插件机制，但能预览 HTML。
WorkBuddy 的预览面板只托管单个 HTML，任何外链资源都会 404 ——
所以图片必须 base64 内嵌，做成自包含。

用法:
  python build_workbuddy_html.py <插件目录> <输出html> [quality] [max_edge]
  例: python build_workbuddy_html.py .. ../../风格图库.html 80 512

quality  : webp 质量，默认 80
max_edge : 长边封顶像素，默认 512（不放大，只缩小）。传 0 表示不缩放。
"""
import base64
import io
import json
import sys
from pathlib import Path

from PIL import Image


def build(catalog: dict, images: dict) -> str:
    data = json.dumps(
        {
            "groups": catalog["groups"],
            "styles": catalog["styles"],
            "colors": catalog["colors"],
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    imgs = json.dumps(images, separators=(",", ":"))

    return HTML_TEMPLATE.replace("__DATA__", data).replace("__IMAGES__", imgs)


def main() -> int:
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 80
    max_edge = int(sys.argv[4]) if len(sys.argv) > 4 else 512

    catalog = json.loads((src / "data" / "catalog.json").read_text("utf-8"))
    styles = catalog["styles"]
    print("styles:", len(styles), "| quality:", quality, "| max_edge:", max_edge)

    images = {}
    for i, s in enumerate(styles, 1):
        p = src / "assets" / (s["number"] + ".webp")
        if not p.exists():
            print("  MISSING", p.name)
            continue
        im = Image.open(p).convert("RGB")
        if max_edge and max(im.size) > max_edge:
            r = max_edge / max(im.size)
            im = im.resize(
                (max(1, round(im.size[0] * r)), max(1, round(im.size[1] * r))),
                Image.LANCZOS,
            )
        buf = io.BytesIO()
        im.save(buf, "WEBP", quality=quality, method=6)
        images[s["number"]] = "data:image/webp;base64," + base64.b64encode(
            buf.getvalue()
        ).decode("ascii")
        if i % 48 == 0:
            print("  encoded", i)

    html = build(catalog, images)
    out.write_text(html, "utf-8")
    print("wrote", out, round(out.stat().st_size / 1024 / 1024, 2), "MB")
    return 0


HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>手绘风格图库 · 288 种</title>
<style>
:root{--fg:#1f2328;--bg:#fff;--mut:#6b7280;--bd:rgba(0,0,0,.12);--pri:#3b82f6;--soft:rgba(127,127,127,.08)}
*{box-sizing:border-box}
body{margin:0;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg)}
.wrap{max-width:1180px;margin:0 auto;padding:20px 18px 40px}
h1{font-size:19px;margin:0 0 3px}
.sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}
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
.modal{background:#fff;border-radius:12px;max-width:660px;width:100%;max-height:88vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.mhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--bd)}
.mtitle{font-size:14px;font-weight:600;flex:1}
.x{border:none;background:transparent;font-size:20px;line-height:1;cursor:pointer;color:var(--mut);padding:2px 6px;border-radius:6px}
.x:hover{background:var(--soft)}
.mbody{padding:14px;display:flex;flex-direction:column;gap:12px}
.mimg{width:100%;max-height:320px;object-fit:contain;border-radius:8px;background:var(--soft);cursor:zoom-in;display:block}
.mimg.zoom{max-height:none;cursor:zoom-out}
.hint{font-size:11px;color:var(--mut);text-align:center;margin-top:-6px}
.field{display:flex;flex-direction:column;gap:5px}
.flab{font-size:12px;font-weight:600;color:var(--mut)}
textarea{width:100%;min-height:132px;padding:9px 10px;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;border:1px solid var(--bd);border-radius:8px;background:#fff;color:inherit;resize:vertical;outline:none}
textarea:focus{border-color:var(--pri)}
.mfoot{display:flex;gap:8px;padding:0 14px 14px}
.credit{margin-top:26px;padding-top:12px;border-top:1px solid var(--bd);font-size:11.5px;color:var(--mut);text-align:center}
.credit a{color:inherit}
</style>
</head>
<body>
<div class="wrap">
  <h1>手绘风格图库</h1>
  <div class="sub">288 种手绘风格 · 看图选风格 · 一键复制提示词</div>

  <div class="bar">
    <input type="text" id="q" placeholder="搜索风格名 / 编号 / 作者 / 特征，例如：蜡笔、FH-014、Risograph">
  </div>
  <div class="chips" id="gchips"></div>
  <div class="lab">主题色 <span style="font-weight:400;opacity:.75">— 可选。选中后会把「主题色：xxx」写进提示词，不改变上方筛选结果</span></div>
  <div class="chips" id="cchips"></div>
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
      <button class="x" id="mx">&times;</button>
    </div>
    <div class="mbody">
      <img class="mimg" id="mimg" alt="">
      <div class="hint">点图片可放大 / 缩小</div>
      <div class="field">
        <span class="flab">想画什么主题？（可留空）</span>
        <input type="text" id="mtheme" placeholder="例如：春天的第一杯奶茶">
      </div>
      <div class="field">
        <span class="flab">提示词（已按风格生成，可直接复制）</span>
        <textarea id="mtext" readonly></textarea>
      </div>
    </div>
    <div class="mfoot">
      <button class="btn pri" id="mcopy">复制提示词</button>
    </div>
  </div>
</div>

<script>
var DATA = __DATA__;
var IMGS = __IMAGES__;

var S = DATA.styles, G = DATA.groups, C = DATA.colors;
var byColor = {};
C.forEach(function (c) { byColor[c.id] = c; });

var st = { q: '', g: 'all', c: '' };

function prompt(style, theme, color) {
  var L = [];
  L.push('请用【' + style.name + '】的手绘插画风格创作一张图。');
  var tr = (style.traits || '').trim();
  if (tr) L.push('风格要点：' + tr + '。');
  if (style.reference && style.reference !== style.name) L.push('视觉参考方向：' + style.reference + '。');
  if (color && color.name_zh) L.push('主题色：' + color.name_zh + (color.name_en ? '（' + color.name_en + '）' : '') + '。');
  if (theme && theme.trim()) L.push('画面主题：' + theme.trim() + '。');
  L.push('要求：单幅插画，构图完整，风格统一，不要出现任何文字、编号或水印。');
  return L.join('\n');
}

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

function filtered() {
  var q = st.q.trim().toLowerCase();
  return S.filter(function (s) {
    if (st.g !== 'all' && s.group !== st.g) return false;
    // 主题色不是风格的属性，而是「配色参数」——它只影响生成的提示词，不参与筛选。
    if (!q) return true;
    return (s.number + ' ' + s.name + ' ' + (s.reference || '') + ' ' + (s.traits || '') + ' ' + (s.alias_zh || ''))
      .toLowerCase().indexOf(q) >= 0;
  });
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
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

function renderChips() {
  var gc = document.getElementById('gchips');
  gc.innerHTML = '';
  var all = el('button', 'chip' + (st.g === 'all' ? ' on' : ''), '全部');
  var n = el('span', 'n', String(S.length));
  all.appendChild(n);
  all.onclick = function () { st.g = 'all'; render(); };
  gc.appendChild(all);
  G.forEach(function (g) {
    var b = el('button', 'chip' + (st.g === g.id ? ' on' : ''), g.label_zh || g.id);
    b.title = g.id;
    b.appendChild(el('span', 'n', String(g.count)));
    b.onclick = function () { st.g = g.id; render(); };
    gc.appendChild(b);
  });

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
    b.title = (c.name_en || '') + (c.hex ? '　' + c.hex : '');
    b.onclick = function () { st.c = c.id; render(); };
    cc.appendChild(b);
  });
}

function render() {
  renderChips();
  var list = filtered();
  var cc = byColor[st.c];
  document.getElementById('count').textContent =
    list.length + ' / ' + S.length + ' 种风格' +
    (cc ? '　·　提示词将带上主题色：' + (cc.name_zh || cc.id) : '');

  var grid = document.getElementById('grid');
  grid.innerHTML = '';
  if (!list.length) {
    grid.appendChild(el('div', 'msg', '没有匹配的风格'));
    return;
  }
  list.forEach(function (s) {
    var card = el('div', 'card');

    var thumb = el('div', 'thumb');
    var img = document.createElement('img');
    img.src = IMGS[s.number] || '';
    img.alt = s.name;
    img.loading = 'lazy';
    thumb.appendChild(img);
    thumb.appendChild(el('span', 'badge', s.number));
    thumb.onclick = function () { openModal(s); };
    card.appendChild(thumb);

    var meta = el('div', 'meta');
    meta.appendChild(el('div', 'nm', s.name));
    meta.appendChild(el('div', 'tr', s.traits || ''));
    card.appendChild(meta);

    var acts = el('div', 'acts');
    var b1 = el('button', 'btn pri', '复制提示词');
    b1.onclick = function () { copy(prompt(s, '', byColor[st.c] || null), b1, '✓ 已复制'); };
    acts.appendChild(b1);
    var b2 = el('button', 'btn', '看大图');
    b2.onclick = function () { openModal(s); };
    acts.appendChild(b2);
    card.appendChild(acts);

    grid.appendChild(card);
  });
}

var cur = null;
function openModal(s) {
  cur = s;
  document.getElementById('mtitle').textContent = s.number + ' · ' + s.name;
  var mi = document.getElementById('mimg');
  mi.src = IMGS[s.number] || '';
  mi.classList.remove('zoom');
  document.getElementById('mtheme').value = '';
  refreshModal();
  document.getElementById('mask').classList.add('on');
}
function refreshModal() {
  if (!cur) return;
  var theme = document.getElementById('mtheme').value;
  document.getElementById('mtext').value = prompt(cur, theme, byColor[st.c] || null);
}
function closeModal() {
  document.getElementById('mask').classList.remove('on');
  cur = null;
}

document.getElementById('q').addEventListener('input', function (e) {
  st.q = e.target.value;
  render();
});
document.getElementById('mtheme').addEventListener('input', refreshModal);
document.getElementById('mimg').onclick = function () { this.classList.toggle('zoom'); };
document.getElementById('mx').onclick = closeModal;
document.getElementById('mask').addEventListener('click', function (e) {
  if (e.target.id === 'mask') closeModal();
});
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeModal();
});
document.getElementById('mcopy').onclick = function () {
  copy(document.getElementById('mtext').value, this, '✓ 已复制');
};

render();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    sys.exit(main())
