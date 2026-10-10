/**
 * Verify the copy that is actually installed in the DSH desktop profile, not the
 * repo checkout. Same harness shape as dev/test-host.e2e.cjs, but the root is the
 * installed plugin, so this proves the packaged bytes boot and serve.
 */
const http = require('http')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('node:url')

const root = process.argv[2]
if (!root || !fs.existsSync(root)) {
  console.error('usage: node verify-installed.cjs <installed-plugin-dir>')
  process.exit(2)
}

;(async () => {
  const host = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
  const checks = []
  const ok = (l, c, e) => checks.push({ l, pass: !!c, e: e === undefined ? '' : String(e) })

  ok('installed host half exports name', host.name === 'dsh-style-gallery', host.name)
  ok('installed host half exports apply()', typeof host.apply === 'function')

  let route = null
  host.apply({
    inject(deps, cb) {
      cb({
        webServer: { register(r) { route = r; return () => {} } },
        effect(fn) { fn(); return () => {} },
      })
    },
  })
  ok('a route was registered', !!route)
  ok('route path is /dsh-style-gallery', route && route.path === '/dsh-style-gallery', route && route.path)

  const server = http.createServer((req, res) => route.handler(req, res))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port + '/dsh-style-gallery'
  const get = async (p) => {
    const res = await fetch(base + p)
    const buf = Buffer.from(await res.arrayBuffer())
    return { status: res.status, type: res.headers.get('content-type'), len: buf.length, buf }
  }
  const isWebp = (b) =>
    b.length > 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP'

  const cat = await get('/catalog.json')
  ok('GET /catalog.json returns 200', cat.status === 200, cat.status)
  let c = null
  try { c = JSON.parse(cat.buf.toString('utf8')) } catch (e) { ok('catalog parses', false, e.message) }
  ok('catalog has 327 styles', c && c.styles.length === 327, c && c.styles.length)
  ok('catalog has 166 layouts', c && c.layouts.length === 166, c && c.layouts.length)
  ok('catalog has 36 colours', c && c.colors.length === 36, c && c.colors.length)
  ok('catalog has 23 group sheets', c && c.groupSheets.length === 23, c && c.groupSheets.length)
  ok('catalog assetsPath points at the INSTALLED assets dir',
    c && path.normalize(c.assetsPath) === path.join(root, 'assets'), c && c.assetsPath)

  // every asset URL the client can build, requested for real
  const urls = []
  for (const s of c.styles) {
    urls.push(['styles', s.number + '.webp'])
    if (s.grid) urls.push(['styles', s.number + '_grid.webp'])
  }
  for (const x of c.layouts) urls.push(['layouts', x.id + '.webp'])
  for (const x of c.colors) urls.push(['colors', x.id + '.webp'])
  for (const x of c.colorSheets) urls.push(['colors', 'sheet_' + String(x.sheet).padStart(2, '0') + '.webp'])
  for (const x of c.groupSheets) urls.push(['groups', x.file])

  let served = 0
  const bad = []
  for (const [kind, file] of urls) {
    const r = await get('/preview/' + kind + '/' + file)
    if (r.status !== 200 || !isWebp(r.buf)) bad.push(kind + '/' + file + ' -> ' + r.status)
    else served++
  }
  ok(`all ${urls.length} asset URLs serve real webp bytes`, bad.length === 0,
    bad.slice(0, 5).join(', ') || served + ' served')

  // one reference path the prompt builder will emit must exist on disk
  const grid = c.styles.filter((s) => s.grid)[0]
  const refPath = path.join(c.assetsPath, 'styles', grid.number + '_grid.webp')
  ok('the reference path written into a prompt exists on disk', fs.existsSync(refPath), refPath)

  server.close()
  const failed = checks.filter((x) => !x.pass)
  for (const x of checks) console.log((x.pass ? 'PASS ' : 'FAIL ') + x.l + (x.e ? '  [' + x.e + ']' : ''))
  console.log('\n' + (checks.length - failed.length) + '/' + checks.length + ' checks passed')
  process.exit(failed.length ? 1 : 0)
})()
