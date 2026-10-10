/**
 * Verifies the composer launcher end to end in a real browser: opens the
 * popup, picks a style, and confirms the prompt reaches setDraft — the whole
 * point of registering into a session-scoped slot.
 */
const { spawn } = require('child_process')
const http = require('http'); const fs = require('fs'); const path = require('path')
const CHROME = 'C:/Users/19980/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'
// Point the harness at any running preview instance (see test-browser.cjs).
const PAGE_URL = (process.env.DSG_URL || 'http://127.0.0.1:3088/').replace(/\/+$/, '') + '/'
const CDP_PORT = Number(process.env.DSG_CDP_PORT || 9333)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const getJson = u => new Promise((res, rej) => { http.get(u, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res(JSON.parse(d)) } catch (e) { rej(e) } }) }).on('error', rej) })
function connect(u) {
  return new Promise((resolve, reject) => {
    const ws = new globalThis.WebSocket(u); let id = 0; const p = new Map()
    ws.addEventListener('open', () => resolve({ send: (m, params = {}) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params })) }), close: () => ws.close() }))
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const { res, rej } = p.get(m.id); p.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result) } })
    ws.addEventListener('error', reject)
  })
}
;(async () => {
  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

  const dir = require('os').tmpdir() + '/dsg6-' + Date.now()
  const c = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run', '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + dir, '--window-size=1280,1100', 'about:blank'], { stdio: 'ignore' })
  for (let i = 0; i < 40; i++) { try { await getJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break } catch { await sleep(250) } }
  const tabs = await getJson('http://127.0.0.1:' + CDP_PORT + '/json/list'); const page = tabs.find(t => t.type === 'page')
  const cdp = await connect(page.webSocketDebuggerUrl)
  await cdp.send('Runtime.enable'); await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url: PAGE_URL })

  // wait for the demo launcher that the preview shell mounts below the gallery
  let ready = false
  for (let i = 0; i < 60; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: "!!document.querySelector('.dsg-launch')", returnByValue: true })
    if (r.result.value) { ready = true; break }
    await sleep(300)
  }
  ok('composer launcher is mounted', ready)

  // capture what the launcher hands to setDraft
  await cdp.send('Runtime.evaluate', { expression: `
    window.__draftSeen = null;
    const orig = window.alert; window.alert = function(m){ window.__draftSeen = m; };
    true;
  `, returnByValue: true })

  // open the popup
  await cdp.send('Runtime.evaluate', { expression: "document.querySelector('.dsg-launch').click(); true", returnByValue: true })
  await sleep(1200)

  const popup = JSON.parse((await cdp.send('Runtime.evaluate', { returnByValue: true, expression: `(() => {
    const cards = document.querySelectorAll('.dsg-pop-card');
    const imgs = [...document.querySelectorAll('.dsg-pop-thumb')];
    let painted = 0;
    imgs.forEach(i => { const r = i.getBoundingClientRect(); if (r.width > 8 && r.height > 8) painted++; });
    return JSON.stringify({ cards: cards.length, painted, first: cards[0] ? cards[0].textContent : null });
  })()` })).result.value)

  ok('popup opened with style cards', popup.cards > 0, popup.cards + ' cards')
  ok('popup thumbnails occupy real space', popup.painted > 0, popup.painted + ' painted')
  // Cards are labelled with the legacy number the library's own docs use.
  ok('popup card shows id + name', /^#\d{3}\s+\S/.test(popup.first || ''), popup.first)

  // click the first style → should push the prompt into setDraft
  await cdp.send('Runtime.evaluate', { expression: "document.querySelector('.dsg-pop-card').click(); true", returnByValue: true })
  await sleep(1500)

  const seen = (await cdp.send('Runtime.evaluate', { returnByValue: true, expression: "String(window.__draftSeen||'')" })).result.value
  ok('setDraft received a non-empty prompt', typeof seen === 'string' && seen.length > 40, seen.length + ' chars')
  ok('the prompt mentions the chosen style', seen.indexOf('Playful Deadpan Doodle') !== -1, seen.slice(0, 120))
  // The upstream contract is what the prompt has to look like now.
  ok('the prompt opens with 风格名称：', seen.indexOf('风格名称：') === 0, seen.split('\n')[0])
  ok('the prompt carries the theme placeholder rather than stopping to ask',
    seen.indexOf('【请在此输入画面主题') !== -1, 'placeholder present')
  ok('the prompt appends no generic tail',
    seen.indexOf('不要出现任何文字') === -1 && seen.indexOf('构图完整') === -1)
  ok('the prompt does NOT leak the style id', seen.indexOf('FA-001') === -1, seen.indexOf('FA-001') !== -1 ? 'leaked' : 'clean')
  ok('the prompt does NOT leak any #nnn id', !/#\d{3}/.test(seen), (seen.match(/#\d{3}/) || ['none'])[0])

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(__dirname, 'preview-launcher.png'), Buffer.from(shot.data, 'base64'))

  cdp.close(); c.kill()

  let failed = 0
  for (const x of checks) { if (!x.pass) failed++; console.log((x.pass ? 'PASS ' : 'FAIL ') + x.l + (x.e !== undefined ? '  [' + x.e + ']' : '')) }
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
  process.exit(failed ? 1 : 0)
})().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
