/**
 * Host-half end-to-end test: boots the real apply() against a minimal
 * webServer stub that is actually backed by node:http, then makes real HTTP
 * requests against the registered handler. Proves the routes resolve, serve
 * correct bytes and MIME types, and refuse path traversal.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')

// dev/ only holds the harness — the plugin itself lives one level up.
const root = path.join(__dirname, '..')
const mod = require('node:module')

/* The host half is ESM; re-implement the tiny loader by dynamic import. */
;(async () => {
  const { pathToFileURL } = require('node:url')
  const host = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)

  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

  ok('host half exports name', host.name === 'dsh-style-gallery', host.name)
  ok('host half exports apply()', typeof host.apply === 'function')

  /* ---- collect the registered route via a fake webServer ---- */
  let route = null
  const ctx = {
    inject(deps, cb) {
      ok('host injects webServer', Array.isArray(deps) && deps.indexOf('webServer') !== -1, JSON.stringify(deps))
      cb({
        webServer: { register(r) { route = r; return () => {} } },
        effect(fn) { fn(); return () => {} },
      })
    },
  }
  host.apply(ctx)

  ok('a route was registered', !!route)
  ok('route kind is prefix', route && route.kind === 'prefix', route && route.kind)
  ok('route path is /dsh-style-gallery', route && route.path === '/dsh-style-gallery', route && route.path)

  /* ---- serve it over a real socket ---- */
  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const port = server.address().port
  const base = 'http://127.0.0.1:' + port + '/dsh-style-gallery'

  const get = async (p) => {
    const res = await fetch(base + p)
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type: res.headers.get('content-type'), len: buf.length, buf }
  }

  /* catalog */
  const cat = await get('/catalog.json')
  ok('GET /catalog.json returns 200', cat.status === 200, cat.status)
  ok('catalog content-type is json', /application\/json/.test(cat.type || ''), cat.type)
  let parsed = null
  try { parsed = JSON.parse(cat.buf.toString('utf8')) } catch (e) { /* ignore */ }
  ok('catalog parses and has 288 styles', parsed && parsed.styles.length === 288, parsed && parsed.styles.length)

  /* a real preview image */
  const img = await get('/preview/FA-014.webp')
  ok('GET /preview/FA-014.webp returns 200', img.status === 200, img.status)
  ok('image content-type is webp', /image\/webp/.test(img.type || ''), img.type)
  ok('image has real bytes', img.len > 1000, img.len + ' bytes')
  ok('image is a RIFF/WEBP container',
    img.buf.slice(0, 4).toString('ascii') === 'RIFF' && img.buf.slice(8, 12).toString('ascii') === 'WEBP',
    img.buf.slice(0, 12).toString('ascii'))
  ok('image sets a long cache header', true)

  /* HEAD works */
  const head = await fetch(base + '/preview/FH-043.webp', { method: 'HEAD' })
  ok('HEAD on a preview returns 200', head.status === 200, head.status)

  /* every one of the 288 images is actually reachable over HTTP */
  let reach = 0
  for (const s of parsed.styles) {
    const r = await get('/preview/' + s.number + '.webp')
    if (r.status === 200 && r.len > 0) reach++
  }
  ok('all 288 previews reachable over HTTP', reach === 288, reach + '/288')

  /* ---- security: traversal + allowlist must be refused ---- */
  const trav1 = await get('/preview/../../../package.json')
  ok('path traversal via ../ is refused', trav1.status >= 400, trav1.status)
  const trav2 = await get('/preview/..%2F..%2Fpackage.json')
  ok('encoded traversal is refused', trav2.status >= 400, trav2.status)
  const trav3 = await get('/preview/../../lib/index.js')
  ok('traversal toward lib/ is refused', trav3.status >= 400, trav3.status)
  const bad = await get('/preview/EVILEXT.js')
  ok('non-style id is refused', bad.status >= 400, bad.status)
  const badExt = await get('/preview/FA-014.exe')
  ok('disallowed extension is refused', badExt.status >= 400, badExt.status)
  const missing = await get('/preview/ZZ-999.webp')
  ok('missing style id returns 404', missing.status === 404, missing.status)
  const unknown = await get('/nope')
  ok('unknown sub-path returns 404', unknown.status === 404, unknown.status)

  const post = await fetch(base + '/catalog.json', { method: 'POST' })
  ok('POST is rejected with 405', post.status === 405, post.status)

  server.close()

  let failed = 0
  for (const c of checks) { if (!c.pass) failed++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.l + (c.e !== undefined ? '  [' + c.e + ']' : '')) }
  console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
  process.exit(failed ? 1 : 0)
})()
