/**
 * Standalone preview server for the style-gallery UI.
 *
 * Reuses the REAL plugin pieces — the host half's route handler and the real
 * client.js bundle — so what you see here is exactly what DSH will render,
 * not a mockup. Serves:
 *   GET /                    → an HTML shell that mounts the real bundle
 *   GET /dsh-style-gallery/* → the real host routes (catalog + images)
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// dev/ only holds the harness — the plugin itself lives one level up.
const devDir = fileURLToPath(new URL('.', import.meta.url))
const here = join(devDir, '..')
const host = await import(pathToFileURL(join(here, 'lib', 'index.js')).href)

/** Capture the plugin's route handler through a stub ctx. */
let route = null
host.apply({
  inject: (deps, cb) => cb({
    webServer: { register: (r) => { route = r; return () => {} } },
    effect: (fn) => { fn(); return () => {} },
  }),
})

const PORT = Number(process.env.PORT || 3088)

const SHELL = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>风格图库 · 预览</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
       background:#f6f7f9;color:#1f2328;padding:20px}
  #note{max-width:900px;margin:0 auto 14px;padding:10px 14px;border-radius:10px;
        background:#fff8e1;border:1px solid #f0d68a;font-size:12.5px;color:#6b5300}
  #root{max-width:1200px;margin:0 auto;background:#fff;border:1px solid #e3e5e8;
        border-radius:12px;padding:16px;height:calc(100vh - 120px);display:flex;flex-direction:column}
</style>
</head>
<body>
<div id="note">
  <b>这是本地预览</b> — 页面里跑的就是 DSH 将会加载的真实 <code>client.js</code>，
  数据与图片走插件自己的 <code>/dsh-style-gallery</code> 路由。DSH 里它会出现在<b>设置 → 风格图库</b>，
  输入框左侧还有一个「风格图库」按钮可直接把提示词填进草稿。
</div>
<div id="root"></div>

<script>
  // Minimal CommonJS shim: the bundle is loaded by DSH's own __ModuleLoader__
  // with a require table holding react / react/jsx-runtime. Here we provide
  // the very same two modules from a CDN so the real bundle runs unmodified.
  window.__MODULE_TABLE__ = {};
</script>

<script crossorigin src="https://unpkg.com/react@18.3.1/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js"></script>

<script>
  // Build the loader table from the UMD globals, then execute the bundle's
  // factory exactly as DSH does.
  (function () {
    const React = window.React;
    const jsxRuntime = {
      jsx: function (type, props, key) {
        const p = Object.assign({}, props); if (key !== undefined) p.key = key;
        return React.createElement(type, p);
      },
      jsxs: function (type, props, key) {
        const p = Object.assign({}, props); if (key !== undefined) p.key = key;
        return React.createElement(type, p);
      },
      Fragment: React.Fragment,
    };
    const table = { 'react': React, 'react/jsx-runtime': jsxRuntime };
    let registeredModule = null;
    window.__ModuleLoader__ = {
      load: function (arg) { registeredModule = arg.factory(function (n) {
        if (table[n]) return table[n];
        throw new Error('module not in preview table: ' + n);
      }); },
    };

    // 1) load the real bundle
    const s = document.createElement('script');
    s.src = '/client.js';
    s.onload = function () {
      var mod = registeredModule;
      // 2) drive it with a preview ctx shaped like DSH's real one
      var t = function (k) { return (mod.__dict && mod.__dict[k]) || k; };
      var ctx = {
        effect: function (fn) { fn(); return function () {}; },
        locale: {
          register: function (ns, dicts) { mod.__dict = (dicts && (dicts.zh || dicts.en)) || {}; return function () {}; },
          bind: function () { return function (k) { return (mod.__dict && mod.__dict[k]) || k; }; },
        },
        slots: { inject: function (slot, cb) { cb(); return function () {}; },
                 register: function (meta, comp) { mod.__regs = mod.__regs || {};
                    mod.__regs[meta.name] = comp; return function () {}; } },
      };
      mod.apply(ctx);

      var Gallery = mod.__regs['settings.section'];
      var root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(React.createElement(Gallery, { close: function () {} }));

      // 3) also mount the composer launcher underneath, as a live demo
      var Launcher = mod.__regs['conversation.input.left'];
      if (Launcher) {
        var dock = document.createElement('div');
        dock.style.cssText = 'max-width:1200px;margin:14px auto 0;background:#fff;border:1px solid #e3e5e8;border-radius:12px;padding:12px';
        dock.innerHTML = '<div style="font-size:12px;opacity:.6;margin-bottom:8px">输入框启动器（DSH 里它位于输入框工具行的左侧，这里单独挂出来演示）</div><pre id="draft-out" style="white-space:pre-wrap;font-size:12px;background:#f6f7f9;border-radius:8px;padding:10px;margin:10px 0 0;display:none"></pre>';
        var inner = document.createElement('div');
        dock.appendChild(inner);
        document.body.appendChild(dock);
        var sent = [];
        ReactDOM.createRoot(inner).render(React.createElement(Launcher, {
          inputActions: {
            setDraft: function (text) {
              sent.push(text);
              // Record for inspection and show a non-blocking notice — an
              // alert() would freeze headless runs.
              window.__draftSeen = text;
              var box = document.getElementById('draft-out');
              if (box) { box.textContent = text; box.style.display = 'block'; }
            },
          },
        }));
      }
    };
    s.onerror = function () {
      document.getElementById('root').innerHTML =
        '<div style="padding:20px;color:#b00">client.js 加载失败</div>';
    };
    document.head.appendChild(s);
  })();
</script>
</body>
</html>`

const server = createServer(async (req, res) => {
  const url = (req.url || '/').split('?')[0]

  if (url === '/' || url === '/index.html') {
    const body = Buffer.from(SHELL, 'utf8')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': String(body.length) })
    res.end(body)
    return
  }

  if (url === '/client.js') {
    try {
      const body = await readFile(join(here, 'client.js'))
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8', 'content-length': String(body.length) })
      res.end(body)
    } catch {
      res.writeHead(404); res.end()
    }
    return
  }

  // everything else goes to the plugin's own host routes
  route.handler(req, res)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('style-gallery preview: http://127.0.0.1:' + PORT + '/')
})
