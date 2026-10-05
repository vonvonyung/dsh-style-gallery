/**
 * Headless verification of the WorkBuddy single-file gallery (风格图库.html).
 *
 * Unlike the dsh plugin there is no server: the page is opened straight from
 * disk as a file:// URL, which is exactly how WorkBuddy's preview panel hosts
 * it. Everything must therefore be self-contained — if any image failed to get
 * inlined as a data URI this run will show it as "loaded < cards".
 *
 * The regression this file exists to guard: theme colour is a *prompt
 * parameter*, not a style attribute. The catalog has no `color` field on
 * styles, so a colour filter would silently return 0 cards for every colour.
 *
 * Usage: node dev/test-workbuddy-html.cjs [path/to/风格图库.html]
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const CHROME = 'C:/Users/19980/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const ROOT = path.join(__dirname, '..')
const HTML = path.resolve(process.argv[2] || path.join(ROOT, '..', '风格图库-workbuddy', '风格图库.html'))
const PAGE_URL = pathToFileURL(HTML).href
const OUT = path.join(__dirname, 'preview-workbuddy.png')
const CDP_PORT = Number(process.env.DSG_CDP_PORT || 9444)

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

const PROBE = `(() => {
  const cards = document.querySelectorAll('#grid .card');
  const imgs = document.querySelectorAll('#grid .thumb img');
  let loaded = 0, painted = 0;
  imgs.forEach(i => {
    if (i.complete && i.naturalWidth > 0) loaded++;
    const r = i.getBoundingClientRect();
    if (r.width > 8 && r.height > 8) painted++;
  });
  return JSON.stringify({
    cards: cards.length,
    imgs: imgs.length,
    loaded, painted,
    gchips: document.querySelectorAll('#gchips .chip').length,
    cchips: document.querySelectorAll('#cchips .chip').length,
    count: (document.getElementById('count')||{}).textContent || '',
    first: (document.querySelector('#grid .nm')||{}).textContent || null,
    badge: (document.querySelector('#grid .badge')||{}).textContent || null,
  });
})()`

const evalJs = async (cdp, expression, awaitPromise = false) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'page exception')
  return r.result.value
}

;(async () => {
  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

  ok('single-file html exists', fs.existsSync(HTML), HTML)
  const sizeMB = fs.existsSync(HTML) ? fs.statSync(HTML).size / 1048576 : 0
  ok('html is a self-contained bundle (<12MB)', sizeMB > 1 && sizeMB < 12, sizeMB.toFixed(2) + ' MB')
  ok('chromium binary exists', fs.existsSync(CHROME), CHROME)

  const profileDir = path.join(require('os').tmpdir(), 'dsg-wb-' + Date.now())
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--disable-extensions', '--allow-file-access-from-files',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profileDir,
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore' })

  let version = null
  for (let i = 0; i < 40; i++) {
    try { version = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break } catch { await sleep(250) }
  }
  ok('chrome devtools endpoint is up', !!version, version && version.Browser)

  const tabs = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list')
  const page = tabs.find((t) => t.type === 'page')
  const cdp = await connect(page.webSocketDebuggerUrl)

  const consoleErrors = []
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '))
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      consoleErrors.push(msg.params.exceptionDetails?.exception?.description || 'exception')
    }
  })

  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Browser.grantPermissions', {
    origin: 'file://', permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
  }).catch(() => {})
  await cdp.send('Page.navigate', { url: PAGE_URL })

  let state = null
  for (let i = 0; i < 80; i++) {
    try {
      state = JSON.parse(await evalJs(cdp, PROBE))
      if (state.cards > 0 && state.loaded > 0) break
    } catch { /* page still parsing a 7MB document */ }
    await sleep(400)
  }

  ok('all 288 style cards rendered', state && state.cards === 288, state && state.cards + ' cards')
  ok('group chips rendered (8 groups + 全部)', state && state.gchips === 9, state && state.gchips + ' chips')
  ok('colour chips rendered (36 + 不指定)', state && state.cchips === 37, state && state.cchips + ' chips')
  ok('first card has a style id badge', state && /^[A-Z]{2}-\d{3}$/.test(state.badge || ''), state && state.badge)
  ok('first card has a style name', !!(state && state.first), state && state.first)
  ok('no uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  // Scroll the whole grid so native lazy-loading fires for every thumbnail.
  await evalJs(cdp, `(async () => {
    const g = document.getElementById('grid');
    for (let y = 0; y <= document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    return 'ok';
  })()`, true)
  await sleep(2500)
  const full = JSON.parse(await evalJs(cdp, PROBE))
  ok('every preview image is inlined and loads', full.loaded === full.cards,
    full.loaded + '/' + full.cards + ' loaded')
  ok('every preview image occupies real space', full.painted === full.cards,
    full.painted + '/' + full.cards + ' painted')

  // --- search ---
  await evalJs(cdp, `(() => {
    const i = document.getElementById('q');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, '蜡笔'); i.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`)
  await sleep(400)
  const searched = JSON.parse(await evalJs(cdp, PROBE))
  ok('search narrows the grid', searched.cards > 0 && searched.cards < 288,
    '288 → ' + searched.cards)

  await evalJs(cdp, `(() => {
    const i = document.getElementById('q');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, 'FH-014'); i.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`)
  await sleep(400)
  const byId = JSON.parse(await evalJs(cdp, PROBE))
  ok('search by style id finds exactly one', byId.cards === 1, byId.cards + ' card')

  await evalJs(cdp, `(() => {
    const i = document.getElementById('q');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, ''); i.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`)
  await sleep(400)

  // --- group filter ---
  await evalJs(cdp, `document.querySelectorAll('#gchips .chip')[1].click()`)
  await sleep(300)
  const grouped = JSON.parse(await evalJs(cdp, PROBE))
  ok('group chip filters to that group only', grouped.cards > 0 && grouped.cards < 288,
    '288 → ' + grouped.cards)
  ok('group chip marks itself active', await evalJs(cdp,
    `document.querySelectorAll('#gchips .chip')[1].classList.contains('on')`) === true)
  await evalJs(cdp, `document.querySelectorAll('#gchips .chip')[0].click()`)
  await sleep(300)

  // --- THE regression: colour must NOT filter ---
  await evalJs(cdp, `document.querySelectorAll('#cchips .chip')[1].click()`)
  await sleep(400)
  const coloured = JSON.parse(await evalJs(cdp, PROBE))
  ok('colour chip does NOT filter the grid (regression guard)',
    coloured.cards === 288, coloured.cards + ' cards after picking a colour')
  ok('colour chip marks itself active', await evalJs(cdp,
    `document.querySelectorAll('#cchips .chip')[1].classList.contains('on')`) === true)
  ok('count line announces the chosen colour', /主题色/.test(coloured.count), coloured.count)

  // --- colour chips must actually be painted in their own colour ---
  // The palette lives in catalog.json (colors[].hex) so both the dsh plugin and
  // this export stay in sync. A chip that renders as a flat grey means the hex
  // never made it into the data, or the inline style lost to `.chip.on`.
  const swatches = JSON.parse(await evalJs(cdp, `(() => {
    const chips = Array.from(document.querySelectorAll('#cchips .chip')).slice(1);
    const bgs = new Set();
    let minContrast = 99, worst = '', plain = 0;
    chips.forEach(b => {
      const bg = getComputedStyle(b).backgroundColor;
      const m = bg.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      if (!m) { plain++; return; }
      bgs.add(bg);
      const hex = '#' + [1,2,3].map(i => (+m[i]).toString(16).padStart(2,'0')).join('');
      const fg = getComputedStyle(b).color.match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)/);
      const fhex = '#' + [1,2,3].map(i => (+fg[i]).toString(16).padStart(2,'0')).join('');
      const a = lum(hex), c = lum(fhex);
      const cr = (Math.max(a,c) + 0.05) / (Math.min(a,c) + 0.05);
      if (cr < minContrast) { minContrast = cr; worst = b.textContent + ' on ' + hex; }
    });
    return JSON.stringify({
      n: chips.length, distinct: bgs.size, plain,
      minContrast: +minContrast.toFixed(2), worst,
    });
  })()`))
  ok('all 36 colour chips are painted with a colour', swatches.n === 36 && swatches.plain === 0,
    swatches.n + ' chips, ' + swatches.plain + ' unpainted')
  ok('every colour chip uses a distinct colour', swatches.distinct === 36,
    swatches.distinct + ' distinct backgrounds')
  ok('chip label clears WCAG AA contrast (>= 4.5:1)', swatches.minContrast >= 4.5,
    swatches.minContrast + ':1  worst=' + swatches.worst)

  // --- grid copy button: prompt must carry the colour, never the style id ---
  const gridProbe = JSON.parse(await evalJs(cdp, `(() => {
    const s = S[0];
    const c = byColor[st.c];
    return JSON.stringify({ name: s.name, text: prompt(s, '', c || null) });
  })()`))
  const gridPrompt = gridProbe.text
  ok('grid prompt carries the chosen theme colour', /主题色/.test(gridPrompt), gridPrompt.split('\n').pop())
  ok('grid prompt never leaks the style number', !/[A-Z]{2}-\d{3}/.test(gridPrompt),
    (gridPrompt.match(/[A-Z]{2}-\d{3}/) || ['none'])[0])
  ok('grid prompt states the style name', gridPrompt.includes(gridProbe.name), gridProbe.name)

  await evalJs(cdp, `document.querySelector('#grid .acts .btn.pri').click()`)
  await sleep(250)
  const btnText = await evalJs(cdp, `document.querySelector('#grid .acts .btn.pri').textContent`)
  ok('copy button confirms with a tick', /已复制/.test(btnText), btnText)

  // --- modal ---
  await evalJs(cdp, `document.querySelector('#grid .thumb').click()`)
  await sleep(300)
  const modalOpen = await evalJs(cdp, `document.getElementById('mask').classList.contains('on')`)
  ok('clicking a thumbnail opens the modal', modalOpen === true)

  const modalBefore = await evalJs(cdp, `document.getElementById('mtext').value`)
  ok('modal prompt is pre-filled', modalBefore.length > 20, modalBefore.length + ' chars')
  ok('modal prompt carries the theme colour', /主题色/.test(modalBefore))

  await evalJs(cdp, `(() => {
    const i = document.getElementById('mtheme');
    const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    set.call(i, '春天的第一杯奶茶'); i.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`)
  await sleep(300)
  const modalAfter = await evalJs(cdp, `document.getElementById('mtext').value`)
  ok('typing a subject rewrites the prompt', /春天的第一杯奶茶/.test(modalAfter) && modalAfter !== modalBefore)
  ok('modal prompt never leaks the style number', !/[A-Z]{2}-\d{3}/.test(modalAfter),
    (modalAfter.match(/[A-Z]{2}-\d{3}/) || ['none'])[0])

  // --- zoom toggle ---
  await evalJs(cdp, `document.getElementById('mimg').click()`)
  await sleep(150)
  ok('clicking the modal image toggles zoom', await evalJs(cdp,
    `document.getElementById('mimg').classList.contains('zoom')`) === true)
  await evalJs(cdp, `document.getElementById('mimg').click()`)

  await evalJs(cdp, `document.getElementById('mcopy').click()`)
  await sleep(250)
  const mcopyText = await evalJs(cdp, `document.getElementById('mcopy').textContent`)
  ok('modal copy button confirms with a tick', /已复制/.test(mcopyText), mcopyText)

  await evalJs(cdp, `document.getElementById('mx').click()`)
  await sleep(200)
  ok('close button dismisses the modal',
    await evalJs(cdp, `document.getElementById('mask').classList.contains('on')`) === false)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(OUT, Buffer.from(shot.data, 'base64'))
  ok('screenshot written', fs.existsSync(OUT) && fs.statSync(OUT).size > 10000,
    fs.existsSync(OUT) ? fs.statSync(OUT).size + ' bytes' : 'missing')

  cdp.close()
  chrome.kill()

  let failed = 0
  for (const c of checks) { if (!c.pass) failed++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.l + (c.e !== undefined && c.e !== '' ? '  [' + c.e + ']' : '')) }
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
  process.exit(failed ? 1 : 0)
})().catch((e) => { console.error('ERROR:', e.message); process.exit(1) })
