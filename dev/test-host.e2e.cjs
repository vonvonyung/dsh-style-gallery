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
    return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), len: buf.length, buf }
  }
  const isWebp = (b) => b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP'

  /* catalog */
  const cat = await get('/catalog.json')
  ok('GET /catalog.json returns 200', cat.status === 200, cat.status)
  ok('catalog content-type is json', /application\/json/.test(cat.type || ''), cat.type)
  let parsed = null
  try { parsed = JSON.parse(cat.buf.toString('utf8')) } catch (e) { /* ignore */ }
  ok('catalog parses and has 327 styles', parsed && parsed.styles.length === 327, parsed && parsed.styles.length)
  ok('catalog carries the 166 layouts', parsed && parsed.layouts.length === 166, parsed && parsed.layouts.length)
  ok('catalog carries the 36 colours', parsed && parsed.colors.length === 36, parsed && parsed.colors.length)

  /* the host has to tell the client where the assets live on THIS machine,
   * because a prompt that needs a reference image names a real file path */
  ok('catalog is stamped with the host asset path',
    parsed && typeof parsed.assetsPath === 'string' && path.normalize(parsed.assetsPath) === path.join(root, 'assets'),
    parsed && parsed.assetsPath)
  ok('the stamped asset path is absolute',
    parsed && path.isAbsolute(parsed.assetsPath), parsed && parsed.assetsPath)

  /* a real preview image */
  const img = await get('/preview/styles/FA-014.webp')
  ok('GET /preview/styles/FA-014.webp returns 200', img.status === 200, img.status)
  ok('image content-type is webp', /image\/webp/.test(img.type || ''), img.type)
  ok('image has real bytes', img.len > 1000, img.len + ' bytes')
  ok('image is a RIFF/WEBP container', isWebp(img.buf), img.buf.slice(0, 12).toString('ascii'))
  ok('image sets a long cache header', /immutable/.test(img.cache || ''), img.cache)

  /* the reference sheet route */
  const grid = await get('/preview/styles/FA-036_grid.webp')
  ok('GET /preview/styles/FA-036_grid.webp returns 200', grid.status === 200, grid.status)
  ok('the grid sheet is a real webp', isWebp(grid.buf), grid.buf.slice(0, 12).toString('ascii'))

  /* layout, colour, group and character routes */
  const lay = await get('/preview/layouts/SC-001.webp')
  ok('GET /preview/layouts/SC-001.webp returns 200', lay.status === 200, lay.status)
  ok('the layout preview is a real webp', isWebp(lay.buf), lay.buf.slice(0, 12).toString('ascii'))
  const col = await get('/preview/colors/C-01.webp')
  ok('GET /preview/colors/C-01.webp returns 200', col.status === 200, col.status)
  const sheet = await get('/preview/colors/sheet_01.webp')
  ok('GET /preview/colors/sheet_01.webp returns 200', sheet.status === 200, sheet.status)
  const grp = await get('/preview/groups/A_001-016.webp')
  ok('GET /preview/groups/A_001-016.webp returns 200', grp.status === 200, grp.status)
  const ch = await get('/preview/characters/CH-001.webp')
  ok('GET /preview/characters/CH-001.webp returns 200', ch.status === 200, ch.status)

  /* HEAD works */
  const head = await fetch(base + '/preview/styles/FH-043.webp', { method: 'HEAD' })
  ok('HEAD on a preview returns 200', head.status === 200, head.status)

  /* every shipped asset is actually reachable over HTTP — this is the check
   * that would have caught the old flat route 404ing on every layout */
  const urls = []
  for (const s of parsed.styles) {
    urls.push('/preview/styles/' + s.number + '.webp')
    if (s.grid) urls.push('/preview/styles/' + s.number + '_grid.webp')
  }
  for (const x of parsed.layouts) urls.push('/preview/layouts/' + x.id + '.webp')
  for (const c of parsed.colors) urls.push('/preview/colors/' + c.id + '.webp')
  let reach = 0
  const dead = []
  for (const u of urls) {
    const r = await get(u)
    if (r.status === 200 && r.len > 0) reach++
    else dead.push(u + ' -> ' + r.status)
  }
  ok('all ' + urls.length + ' asset URLs reachable over HTTP', reach === urls.length,
    dead.length ? dead.slice(0, 5).join(', ') : reach + '/' + urls.length)

  /* ---- security: traversal + allowlist must be refused ---- */
  const trav1 = await get('/preview/styles/../../../package.json')
  ok('path traversal via ../ is refused', trav1.status >= 400, trav1.status)
  const trav2 = await get('/preview/styles/..%2F..%2Fpackage.json')
  ok('encoded traversal is refused', trav2.status >= 400, trav2.status)
  const trav3 = await get('/preview/../../../lib/index.js')
  ok('traversal toward lib/ is refused', trav3.status >= 400, trav3.status)
  const travKind = await get('/preview/../../../package.json/x.webp')
  ok('a traversal in the kind segment is refused', travKind.status >= 400, travKind.status)
  const badKind = await get('/preview/nope/FA-014.webp')
  ok('an unknown asset kind is refused', badKind.status >= 400, badKind.status)
  const bad = await get('/preview/styles/EVILEXT.js')
  ok('a non-style id is refused', bad.status >= 400, bad.status)
  const badExt = await get('/preview/styles/FA-014.exe')
  ok('a disallowed extension is refused', badExt.status >= 400, badExt.status)
  const noFile = await get('/preview/styles/')
  ok('a missing filename is refused', noFile.status >= 400, noFile.status)
  const nested = await get('/preview/styles/sub/dir/FA-014.webp')
  ok('a nested path inside a kind is refused', nested.status >= 400, nested.status)
  const missing = await get('/preview/styles/ZZ-999.webp')
  ok('a missing style id returns 404', missing.status === 404, missing.status)
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
