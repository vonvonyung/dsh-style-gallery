/**
 * Headless verification of the WorkBuddy single-file gallery (风格图库.html).
 *
 * Unlike the dsh plugin there is no server: the page is opened straight from
 * disk as a file:// URL, which is exactly how WorkBuddy's preview panel hosts
 * it. Everything must therefore be self-contained — if any image failed to get
 * inlined as a data URI this run will show it as "loaded < cards".
 *
 * Two regressions this file exists to guard:
 *   1. Theme colour is a *prompt parameter*, not a style attribute. The catalog
 *      has no `color` field on styles, so a colour filter would silently return
 *      0 cards for every colour.
 *   2. The page used to carry its own copy of the prompt builder, which drifted
 *      from the dsh plugin's. It now inlines the plugin's @prompt-core block at
 *      build time, so this run also proves the inline actually happened.
 *
 * Usage: node dev/test-workbuddy-html.cjs [path/to/风格图库.html]
 *        or set DSG_HTML to the same path.
 */
const { spawn } = require('child_process')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

const CHROME = 'C:/Users/19980/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
const ROOT = path.join(__dirname, '..')
// The gallery's canonical home is the handraw-gallery WorkBuddy skill; this
// repo only holds the builder. Pass the path, or set DSG_HTML.
const HTML = path.resolve(
  process.argv[2] || process.env.DSG_HTML || path.join(ROOT, '..', '风格图库-workbuddy', '风格图库.html'),
)
if (!fs.existsSync(HTML)) {
  // Fail loudly: a missing file otherwise surfaces as a cryptic page error and
  // reads like a broken gallery.
  console.error('gallery HTML not found: ' + HTML)
  console.error('Pass it explicitly, e.g.:')
  console.error('  node dev/test-workbuddy-html.cjs "%USERPROFILE%/.workbuddy-ai/skills/handraw-gallery/风格图库.html"')
  process.exit(2)
}
const PAGE_URL = pathToFileURL(HTML).href
const OUT = path.join(__dirname, 'preview-workbuddy.png')
const CDP_PORT = Number(process.env.DSG_CDP_PORT || 9444)

const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'catalog.json'), 'utf8'))
/** The first card in the grid is always the first catalog entry. */
const S0_NAME = CATALOG.styles[0].name

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

const setInput = (id, value) => `(() => {
  const i = document.getElementById(${JSON.stringify(id)});
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(i, ${JSON.stringify(value)});
  i.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`

const clickTab = (name) => `document.getElementById('tab-' + ${JSON.stringify(name)}).click()`

;(async () => {
  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

  ok('single-file html exists', fs.existsSync(HTML), HTML)
  const sizeMB = fs.existsSync(HTML) ? fs.statSync(HTML).size / 1048576 : 0
  // 594 images inlined. A big jump here means the encoder lost its downscaling.
  ok('html is a self-contained bundle (<26MB)', sizeMB > 5 && sizeMB < 26, sizeMB.toFixed(2) + ' MB')
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
  for (let i = 0; i < 100; i++) {
    try {
      state = JSON.parse(await evalJs(cdp, PROBE))
      if (state.cards > 0 && state.loaded > 0) break
    } catch { /* page still parsing a ~19MB document */ }
    await sleep(400)
  }

  ok('all 327 style cards rendered', state && state.cards === 327, state && state.cards + ' cards')
  ok('group chips rendered (8 groups + 全部)', state && state.gchips === 9, state && state.gchips + ' chips')
  ok('colour chips rendered (36 + 不指定)', state && state.cchips === 37, state && state.cchips + ' chips')
  // Cards are labelled with the legacy number the library's own docs use.
  ok('first card has a style id badge', state && /^#\d{3}$/.test(state.badge || ''), state && state.badge)
  ok('first card has a style name', !!(state && state.first), state && state.first)
  ok('no uncaught console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

  // The page must run the plugin's prompt code, not a stale copy of it.
  ok('the page inlines the plugin prompt core',
    await evalJs(cdp, `typeof stylePrompt === 'function' && typeof resolveActivation === 'function'`) === true)
  ok('the inlined core is the current contract',
    await evalJs(cdp, `typeof filterTraits === 'function' && filterTraits('白底；避免可爱微笑。')`) === '白底',
    await evalJs(cdp, `typeof filterTraits === 'function' ? filterTraits('白底；避免可爱微笑。') : 'missing'`))
  // `typeof prompt` is useless here — window.prompt is the browser's own. Check
  // the built file instead: the old builder's opening line must be gone.
  const htmlSrc = fs.readFileSync(HTML, 'utf8')
  ok('the old builder is not still inlined',
    htmlSrc.indexOf('请用【') === -1 && htmlSrc.indexOf('风格要点：') === -1,
    htmlSrc.indexOf('请用【') !== -1 ? 'old builder present' : 'gone')

  // Scroll the whole grid so native lazy-loading fires for every thumbnail.
  await evalJs(cdp, `(async () => {
    for (let y = 0; y <= document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise(r => requestAnimationFrame(r));
      await new Promise(r => setTimeout(r, 40));
    }
    window.scrollTo(0, 0);
    return 'ok';
  })()`, true)
  await sleep(3000)
  const full = JSON.parse(await evalJs(cdp, PROBE))
  ok('every preview image is inlined and loads', full.cards > 0 && full.loaded === full.cards,
    full.loaded + '/' + full.cards + ' loaded')
  ok('every preview image occupies real space', full.cards > 0 && full.painted === full.cards,
    full.painted + '/' + full.cards + ' painted')

  // --- search ---
  await evalJs(cdp, setInput('q', '蜡笔'))
  await sleep(400)
  const searched = JSON.parse(await evalJs(cdp, PROBE))
  ok('search narrows the grid', searched.cards > 0 && searched.cards < 327,
    '327 → ' + searched.cards)

  await evalJs(cdp, setInput('q', 'FH-014'))
  await sleep(400)
  const byId = JSON.parse(await evalJs(cdp, PROBE))
  ok('search by style id finds exactly one', byId.cards === 1, byId.cards + ' card')

  // Legacy numbering is what the library documents; `041` is FB-006.
  await evalJs(cdp, setInput('q', '041'))
  await sleep(400)
  const byLegacy = JSON.parse(await evalJs(cdp, PROBE))
  ok('search by legacy number finds its style', byLegacy.cards > 0, '041 → ' + byLegacy.cards + ' cards')
  ok('the legacy hit is the right style', byLegacy.badge === '#041', byLegacy.badge)

  await evalJs(cdp, setInput('q', ''))
  await sleep(400)

  // --- group filter ---
  await evalJs(cdp, `document.querySelectorAll('#gchips .chip')[1].click()`)
  await sleep(300)
  const grouped = JSON.parse(await evalJs(cdp, PROBE))
  ok('group chip filters to that group only', grouped.cards > 0 && grouped.cards < 327,
    '327 → ' + grouped.cards)
  ok('group chip marks itself active', await evalJs(cdp,
    `document.querySelectorAll('#gchips .chip')[1].classList.contains('on')`) === true)
  await evalJs(cdp, `document.querySelectorAll('#gchips .chip')[0].click()`)
  await sleep(300)

  // --- THE regression: colour must NOT filter ---
  await evalJs(cdp, `document.querySelectorAll('#cchips .chip')[1].click()`)
  await sleep(400)
  const coloured = JSON.parse(await evalJs(cdp, PROBE))
  ok('colour chip does NOT filter the grid (regression guard)',
    coloured.cards === 327, coloured.cards + ' cards after picking a colour')
  ok('colour chip marks itself active', await evalJs(cdp,
    `document.querySelectorAll('#cchips .chip')[1].classList.contains('on')`) === true)
  ok('count line announces the chosen colour', /主题色/.test(coloured.count), coloured.count)

  // --- colour chips must actually be painted in their own colour ---
  const swatches = JSON.parse(await evalJs(cdp, `(() => {
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = (h) => 0.2126*lin(parseInt(h.slice(1,3),16)/255) + 0.7152*lin(parseInt(h.slice(3,5),16)/255) + 0.0722*lin(parseInt(h.slice(5,7),16)/255);
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
    return JSON.stringify({ n: chips.length, distinct: bgs.size, plain, minContrast: +minContrast.toFixed(2), worst });
  })()`))
  ok('all 36 colour chips are painted with a colour', swatches.n === 36 && swatches.plain === 0,
    swatches.n + ' chips, ' + swatches.plain + ' unpainted')
  ok('every colour chip uses a distinct colour', swatches.distinct === 36,
    swatches.distinct + ' distinct backgrounds')
  ok('chip label clears WCAG AA contrast (>= 4.5:1)', swatches.minContrast >= 4.5,
    swatches.minContrast + ':1  worst=' + swatches.worst)

  // --- the prompt the grid button copies -------------------------------
  const gridPrompt = await evalJs(cdp, `(() => {
    const s = S[0];
    return stylePrompt(s, '', byColor[st.c] || null, { catalog: DATA, lang: 'zh' });
  })()`)
  ok('grid prompt carries the chosen theme colour', /主题色/.test(gridPrompt), gridPrompt.split('\n').pop())
  ok('grid prompt never leaks the style number', !/[A-Z]{2}-\d{3}/.test(gridPrompt),
    (gridPrompt.match(/[A-Z]{2}-\d{3}/) || ['none'])[0])
  ok('grid prompt never leaks a #nnn id', !/#\d{3}/.test(gridPrompt),
    (gridPrompt.match(/#\d{3}/) || ['none'])[0])
  ok('grid prompt states the style name', gridPrompt.includes(S0_NAME), S0_NAME)
  ok('grid prompt opens with 风格名称：', gridPrompt.indexOf('风格名称：') === 0, gridPrompt.split('\n')[0])
  // The old builder appended this; the contract forbids it outright.
  ok('grid prompt appends no generic tail',
    gridPrompt.indexOf('构图完整') === -1 && gridPrompt.indexOf('不要出现任何文字') === -1)

  await evalJs(cdp, `document.querySelector('#grid .acts .btn.pri').click()`)
  await sleep(250)
  const btnText = await evalJs(cdp, `document.querySelector('#grid .acts .btn.pri').textContent`)
  ok('copy button confirms with a tick', /已复制/.test(btnText), btnText)

  // --- modal ---
  await evalJs(cdp, `document.querySelector('#grid .thumb').click()`)
  await sleep(300)
  ok('clicking a thumbnail opens the modal',
    await evalJs(cdp, `document.getElementById('mask').classList.contains('on')`) === true)

  const modalBefore = await evalJs(cdp, `document.getElementById('mtext').value`)
  ok('modal prompt is pre-filled', modalBefore.length > 20, modalBefore.length + ' chars')
  ok('modal prompt carries the theme colour', /主题色/.test(modalBefore))

  await evalJs(cdp, setInput('mtheme', '春天的第一杯奶茶'))
  await sleep(300)
  const modalAfter = await evalJs(cdp, `document.getElementById('mtext').value`)
  ok('typing a subject rewrites the prompt', /春天的第一杯奶茶/.test(modalAfter) && modalAfter !== modalBefore)
  ok('modal prompt never leaks the style number', !/[A-Z]{2}-\d{3}/.test(modalAfter),
    (modalAfter.match(/[A-Z]{2}-\d{3}/) || ['none'])[0])

  // --- language toggle ---
  await evalJs(cdp, `document.querySelector('#mlang button[data-lang=en]').click()`)
  await sleep(300)
  const enPrompt = await evalJs(cdp, `document.getElementById('mtext').value`)
  ok('the language toggle switches the prompt to English',
    enPrompt.indexOf('Style name: ') === 0, enPrompt.split('\n')[0])
  await evalJs(cdp, `document.querySelector('#mlang button[data-lang=zh]').click()`)
  await sleep(250)

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

  // --- layouts tab ------------------------------------------------------
  await evalJs(cdp, clickTab('layouts'))
  await sleep(1500)
  const lay = JSON.parse(await evalJs(cdp, PROBE))
  ok('the layouts tab renders all 166 layouts', lay.cards === 166, lay.cards + ' layout cards')
  ok('layout cards badge with their layout id', /^[A-Z]{2}-\d{3}$/.test(lay.badge || ''), lay.badge)
  ok('layout category chips rendered', lay.gchips === 6, lay.gchips + ' chips')
  ok('the colour row is hidden on the layouts tab',
    await evalJs(cdp, `getComputedStyle(document.getElementById('colorBlock')).display`) === 'none')

  // --- contact sheets tab ----------------------------------------------
  await evalJs(cdp, clickTab('sheets'))
  await sleep(1200)
  const sheets = JSON.parse(await evalJs(cdp, PROBE))
  ok('the overview tab renders all 23 contact sheets', sheets.cards === 23, sheets.cards + ' sheets')
  ok('contact sheet badges show the legacy range',
    /^[A-H] · \d{3}–\d{3}$/.test(sheets.badge || ''), sheets.badge)
  ok('the search box is hidden on the overview tab',
    await evalJs(cdp, `getComputedStyle(document.getElementById('q')).display`) === 'none')
  ok('contact sheet images load from their inlined data URIs',
    sheets.loaded > 0, sheets.loaded + '/' + sheets.imgs + ' loaded')

  await evalJs(cdp, `document.querySelector('#grid .thumb').click()`)
  await sleep(300)
  ok('a contact sheet opens in the modal',
    await evalJs(cdp, `document.getElementById('mask').classList.contains('on')`) === true)
  ok('the sheet modal hides the prompt controls',
    await evalJs(cdp, `getComputedStyle(document.getElementById('mcopy')).display`) === 'none')
  await evalJs(cdp, `document.getElementById('mx').click()`)
  await sleep(200)

  await evalJs(cdp, clickTab('styles'))
  await sleep(800)

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
