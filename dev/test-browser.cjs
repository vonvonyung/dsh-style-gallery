/**
 * Headless verification of the running preview: drives the real Chromium over
 * the DevTools protocol, waits for the gallery to fetch its catalog and paint
 * its cards, then asserts on the live DOM and captures a screenshot.
 *
 * This is what proves the UI actually works — not just that files are served.
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')

const CHROME = 'C:/Users/19980/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
// The page URL is taken from DSG_URL when set, so the harness can be pointed at
// any running instance (the preview server picks its port from PORT). Without
// this the test silently targets a fixed port and reports 0 cards even when the
// UI is perfectly healthy.
const PAGE_URL = (process.env.DSG_URL || 'http://127.0.0.1:3088/').replace(/\/+$/, '') + '/'
const OUT = path.join(__dirname, 'preview-screenshot.png')
const CDP_PORT = Number(process.env.DSG_CDP_PORT || 9222)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = ''
      res.on('data', (c) => (d += c))
      res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

/** Tiny CDP client over a websocket (Node 22 ships a global WebSocket). */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const WebSocket = globalThis.WebSocket
    if (!WebSocket) { reject(new Error('no WebSocket impl')); return }

    const ws = new WebSocket(wsUrl)
    let id = 0
    const pending = new Map()
    const events = []
    ws.addEventListener('open', () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const msgId = ++id
          pending.set(msgId, { res, rej })
          ws.send(JSON.stringify({ id: msgId, method, params }))
        })
      },
      on(fn) { events.push(fn) },
      close() { ws.close() },
    }))
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      } else if (msg.method) {
        for (const fn of events) fn(msg)
      }
    })
    ws.addEventListener('error', reject)
  })
}

;(async () => {
  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

  ok('chromium binary exists', fs.existsSync(CHROME), CHROME)

  const profileDir = path.join(require('os').tmpdir(), 'dsg-chrome-' + Date.now())
  const chrome = spawn(CHROME, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--no-first-run',
    '--disable-extensions',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' })

  // wait for the CDP endpoint
  let version = null
  for (let i = 0; i < 40; i++) {
    try { version = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break } catch { await sleep(250) }
  }
  ok('chrome devtools endpoint is up', !!version, version && version.Browser)

  const tabs = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list')
  const page = tabs.find((t) => t.type === 'page')
  ok('a page target exists', !!page)

  const cdp = await connect(page.webSocketDebuggerUrl)
  const consoleErrors = []
  const failedRequests = []
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
    }
    if (msg.method === 'Network.loadingFailed') {
      failedRequests.push(msg.params.errorText + ' ' + (msg.params.requestId || ''))
    }
  })

  await cdp.send('Runtime.enable')
  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: PAGE_URL })

  // poll until the gallery grid paints real cards (or time out)
  const probe = `(() => {
    const cards = document.querySelectorAll('.dsg-card');
    const imgs = document.querySelectorAll('.dsg-thumb img');
    let loaded = 0;
    let painted = 0;
    imgs.forEach(i => {
      if (i.complete && i.naturalWidth > 0) loaded++;
      // a loaded image can still render at zero height (flex collapse) — only
      // count it as painted when it actually occupies space on screen.
      const r = i.getBoundingClientRect();
      if (r.width > 8 && r.height > 8) painted++;
    });
    const chips = document.querySelectorAll('.dsg-chip').length;
    const name = document.querySelector('.dsg-name');
    const thumb = document.querySelector('.dsg-thumb');
    const tr = thumb ? thumb.getBoundingClientRect() : null;
    return JSON.stringify({
      cards: cards.length,
      imgs: imgs.length,
      loaded: loaded,
      painted: painted,
      chips: chips,
      first: name ? name.textContent : null,
      badge: (document.querySelector('.dsg-badge')||{}).textContent || null,
      thumbH: tr ? Math.round(tr.height) : 0,
      thumbW: tr ? Math.round(tr.width) : 0,
    });
  })()`

  let state = null
  for (let i = 0; i < 60; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: probe, returnByValue: true })
    state = JSON.parse(r.result.value)
    if (state.cards > 0 && state.loaded > 0) break
    await sleep(300)
  }

  ok('gallery rendered style cards', state && state.cards > 0, state && state.cards + ' cards')
  ok('group filter chips rendered', state && state.chips >= 9, state && state.chips + ' chips')
  ok('preview images actually loaded (naturalWidth>0)', state && state.loaded > 0,
    state && state.loaded + '/' + state.imgs + ' loaded')
  // This is the check that catches a visually broken grid: an <img> can be
  // "loaded" yet occupy zero height when aspect-ratio collapses in flex.
  ok('preview images occupy real space (painted, not collapsed)',
    state && state.painted >= state.loaded * 0.9,
    state && state.painted + '/' + state.imgs + ' painted')
  ok('thumbnail box has a real height', state && state.thumbH > 40,
    state && state.thumbW + 'x' + state.thumbH)
  ok('at least one card shows a style id badge', state && /^[A-Z]{2}-\d{3}$/.test(state.badge || ''), state && state.badge)
  ok('first card has a style name', !!(state && state.first), state && state.first)
  ok('no uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  // The grid uses native lazy-loading and is its own scroll container
  // (.dsg-grid{overflow:auto}), so window.scrollTo does nothing — the element
  // must be scrolled. Step it through and require that every one of the 288
  // previews loads and paints; the "loaded but collapsed" bug can hide below
  // the fold otherwise.
  await cdp.send('Runtime.evaluate', { expression: `(async () => {
    const grid = document.querySelector('.dsg-grid');
    if (!grid) return 'no-grid';
    for (let y = 0; y <= grid.scrollHeight; y += 500) {
      grid.scrollTop = y;
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 40));
    }
    grid.scrollTop = 0;
    return 'ok';
  })()`, awaitPromise: true })
  await sleep(2000)
  const full = JSON.parse((await cdp.send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.value)
  ok('all 288 previews load after a full scroll', full.loaded === full.cards,
    full.loaded + '/' + full.cards + ' loaded')
  ok('all 288 previews paint after a full scroll', full.painted === full.cards,
    full.painted + '/' + full.cards + ' painted')

  // exercise a real interaction: type in the search box, confirm filtering
  await cdp.send('Runtime.evaluate', { expression: `(() => {
    const input = document.querySelector('.dsg-wrap .dsg-input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'FH-014');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()` })
  await sleep(500)
  const after = JSON.parse((await cdp.send('Runtime.evaluate', { expression: probe, returnByValue: true })).result.value)
  ok('search filters the grid', after.cards > 0 && after.cards < state.cards,
    state.cards + ' → ' + after.cards)

  // Theme-colour chips must be painted in the colour they name, with a label
  // that stays legible on top. The palette comes from catalog.json (colors[].hex).
  await cdp.send('Runtime.evaluate', { expression: `(() => {
    const i = document.querySelector('.dsg-wrap .dsg-input');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()` })
  await sleep(400)
  const sw = JSON.parse((await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
      const lum = (h) => 0.2126*lin(parseInt(h.slice(1,3),16)/255) + 0.7152*lin(parseInt(h.slice(3,5),16)/255) + 0.0722*lin(parseInt(h.slice(5,7),16)/255);
      const toHex = (rgb) => '#' + rgb.map(v => (+v).toString(16).padStart(2,'0')).join('');
      const chips = Array.from(document.querySelectorAll('.dsg-chip.c'));
      const bgs = new Set();
      let plain = 0, minContrast = 99, worst = '';
      chips.forEach(b => {
        const bg = getComputedStyle(b).backgroundColor;
        const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        if (!m) { plain++; return; }
        bgs.add(bg);
        const fg = getComputedStyle(b).color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
        const a = lum(toHex(m.slice(1,4))), c = lum(toHex(fg.slice(1,4)));
        const cr = (Math.max(a,c) + 0.05) / (Math.min(a,c) + 0.05);
        if (cr < minContrast) { minContrast = cr; worst = b.textContent + ' on ' + toHex(m.slice(1,4)); }
      });
      return JSON.stringify({ n: chips.length, distinct: bgs.size, plain, minContrast: +minContrast.toFixed(2), worst });
    })()`, returnByValue: true })).result.value)
  ok('every theme-colour chip is painted with its colour',
    sw.n === 36 && sw.plain === 0, sw.n + ' chips, ' + sw.plain + ' unpainted')
  ok('theme-colour chips use 36 distinct colours', sw.distinct === 36, sw.distinct + ' distinct')
  ok('theme-colour chip labels clear WCAG AA (>= 4.5:1)', sw.minContrast >= 4.5,
    sw.minContrast + ':1  worst=' + sw.worst)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  ok('screenshot written', fs.existsSync(OUT) && fs.statSync(OUT).size > 10000,
    fs.existsSync(OUT) ? fs.statSync(OUT).size + ' bytes' : 'missing')

  cdp.close()
  chrome.kill()

  let failed = 0
  for (const c of checks) { if (!c.pass) failed++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.l + (c.e !== undefined ? '  [' + c.e + ']' : '')) }
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
