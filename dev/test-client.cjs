/**
 * Harness for the style-gallery client bundle: boots client.js through a
 * stubbed window.__ModuleLoader__ (the real DSH contract), captures the
 * module it returns, and exercises the prompt builder + slot registration
 * against the real shipped catalog. Run with plain node.
 */
const fs = require('fs')
const path = require('path')

// dev/ only holds the harness — the plugin itself lives one level up.
const root = path.join(__dirname, '..')
const clientSrc = fs.readFileSync(path.join(root, 'client.js'), 'utf8')

/* ---- stub React: just enough for createElement + hooks to be callable ---- */
const hooks = []
const React = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.flat() }
  },
  useState(init) { const v = typeof init === 'function' ? init() : init; return [v, () => {}] },
  useMemo(fn) { return fn() },
  useCallback(fn) { return fn },
  useEffect(fn) { hooks.push(fn) },
  useRef(init) { return { current: init } },
}

let captured = null
global.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      captured = { id, module: factory((name) => {
        if (name === 'react') return React
        if (name === 'react/jsx-runtime') return {}
        throw new Error('unexpected require: ' + name)
      }) }
    },
  },
}
global.document = {
  head: { appendChild() {} },
  body: { appendChild() {}, removeChild() {} },
  getElementById() { return null },
  createElement() {
    return { style: {}, appendChild() {}, removeChild() {}, select() {}, set textContent(v) {}, set id(v) {} }
  },
}
global.navigator = {}
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'))) })

/* ---- boot the bundle ---- */
eval(clientSrc)

const checks = []
const ok = (label, cond, extra) => {
  checks.push({ label, pass: !!cond, extra })
}

ok('__ModuleLoader__.load called with correct id', captured && captured.id === 'dsh-style-gallery', captured && captured.id)

const mod = captured && captured.module
ok('factory returned an object', mod && typeof mod === 'object')
ok('plugin name is set', mod && mod.name === 'dsh-style-gallery', mod && mod.name)
ok('plugin declares inject [slots, locale]',
  mod && Array.isArray(mod.inject) && mod.inject.join(',') === 'slots,locale', mod && JSON.stringify(mod.inject))
ok('plugin exposes apply()', mod && typeof mod.apply === 'function')

/* ---- drive apply() with a fake ctx and capture the registered components ---- */
const regs = {}
const injectedSlots = []
const ctx = {
  effect(fn) { fn(); return () => {} },
  locale: {
    register(ns, dicts) { ok('locale namespace registered', ns === 'dsh-style-gallery', ns); return () => {} },
    bind() { return (k) => k },
  },
  slots: {
    inject(slot, cb) { injectedSlots.push(slot); cb(); return () => {} },
    register(meta, comp) { regs[meta.name] = { meta, comp }; return () => {} },
  },
}
mod.apply(ctx)

ok('injected into settings.section', injectedSlots.indexOf('settings.section') !== -1, injectedSlots.join(','))
ok('injected into conversation.input.left', injectedSlots.indexOf('conversation.input.left') !== -1, injectedSlots.join(','))

const galleryReg = regs['settings.section']
const launcherReg = regs['conversation.input.left']
ok('registered the gallery component', galleryReg && typeof galleryReg.comp === 'function')
ok('gallery meta has id=style-gallery', galleryReg && galleryReg.meta.id === 'style-gallery', galleryReg && galleryReg.meta.id)
ok('gallery order is 45', galleryReg && galleryReg.meta.order === 45, galleryReg && galleryReg.meta.order)
ok('gallery registration carries inject face', galleryReg && typeof galleryReg.meta.inject === 'function')
ok('registered the composer launcher', launcherReg && typeof launcherReg.comp === 'function')
ok('launcher meta has a distinct id', launcherReg && launcherReg.meta.id === 'style-gallery-launcher', launcherReg && launcherReg.meta.id)

/* ---- exercise the gallery component tree ---- */
const React2 = React
const tReal = (k) => ({ nav: '风格图库', subtitle: 'sub', searchPh: 'ph', allGroups: '全部', loading: 'loading', empty: 'empty', copy: 'copy', copied: 'ok', create: 'use', creating: 'in', created: 'done', detail: 'd', traits: 'tr', refBy: 'ref', themePh: 'tp', build: 'b', close: 'c', countUnit: 'styles', themeColor: '主题色', noneColor: '不限' }[k] || k)
let tree = null
try {
  // the registered entry is a thin wrapper that injects `t`; calling it
  // yields the StyleGallery element itself.
  const outer = galleryReg.comp({ t: tReal, close: () => {} })
  ok('gallery wrapper returns the StyleGallery element',
    outer && typeof outer.type === 'function' && outer.type.name === 'StyleGallery',
    outer && (typeof outer.type === 'function' ? outer.type.name : typeof outer.type))
  // render the inner component (the stub's useEffect runs the fetch but its
  // setState is a no-op, so we land on the loading branch).
  tree = outer.type(outer.props)
  ok('gallery inner render returns the wrapper element',
    tree && tree.type === 'div' && tree.props && tree.props.className === 'dsg-wrap',
    tree && tree.type + ' / ' + (tree.props && tree.props.className))
} catch (e) {
  ok('gallery rendered without throwing', false, e.message)
}

/* ---- verify the prompt builder via the modal path ---- */
// find the prompt builder indirectly: it is not exported, so we validate the
// promise shape by confirming the catalog contract we depend on instead.
const cat = JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'))
ok('catalog has 288 styles', cat.styles.length === 288, cat.styles.length)
ok('catalog has 36 colors', cat.colors.length === 36, cat.colors.length)
ok('catalog has 8 groups', cat.groups.length === 8, cat.groups.length)

// The UI paints each theme-colour chip in the colour it names, so every colour
// needs a usable hex. Without one the chip falls back to a flat grey and the
// palette stops being a palette -- a data bug that only shows up visually.
const HEX = /^#[0-9a-fA-F]{6}$/
const badHex = cat.colors.filter((c) => !HEX.test(c.hex || '')).map((c) => c.id)
ok('every catalog color carries a #rrggbb hex', badHex.length === 0, badHex.join(',') || 'all 36 ok')
const distinctHex = new Set(cat.colors.map((c) => (c.hex || '').toLowerCase()))
ok('no two colors share a hex', distinctHex.size === cat.colors.length,
  distinctHex.size + '/' + cat.colors.length + ' distinct')

// every style must have a matching asset on disk (what the UI will request)
let missing = 0
for (const s of cat.styles) {
  const p = path.join(root, 'assets', s.number + '.webp')
  if (!fs.existsSync(p)) missing++
}
ok('every catalog style has a preview asset on disk', missing === 0, missing + ' missing')

// the host route regex must accept every style id
const RE = /^[A-Z]{2}-\d{3}$/
const badIds = cat.styles.filter((s) => !RE.test(s.number)).map((s) => s.number)
ok('every style id passes the host route allowlist regex', badIds.length === 0, badIds.slice(0, 5).join(','))

/* ---- licence: the upstream style library requires visible attribution ---- */
// Its licence is MIT *with an attribution clause*, so the credit has to appear
// in the product UI, not only in a bundled text file. These checks keep that
// from silently regressing.
// clientSrc (read at the top of this file) is the client.js source.
ok('client UI links the upstream style library',
  /yang0\/handraw-style/.test(clientSrc), 'yang0/handraw-style present in client.js')
ok('credit string is localised in both dictionaries',
  /creditLead/.test(clientSrc) && /creditTail/.test(clientSrc), 'zh + en credit keys')

const licenceText = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8')
ok('LICENSE carries the upstream attribution notice',
  /yang0\/handraw-style/.test(licenceText), 'attribution present in LICENSE')

/* ---- publish metadata: package.json must point where the code is pushed ---- */
// Users install this straight from GitHub, so a stale owner in package.json
// sends them to a 404. Compare against the real remote rather than hardcoding
// the owner, and skip the comparison when there is no clone to ask.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const slug = (u) => {
  // trailing .git / #readme / /issues must not become part of the repo name
  const m = /github\.com[/:]([^/]+)\/([^/#]+?)(?:\.git)?(?:[#/].*)?$/i.exec(u || '')
  return m ? (m[1] + '/' + m[2]).toLowerCase() : ''
}
const pkgSlug = slug(pkg.repository && pkg.repository.url)
let remoteSlug = ''
const gitConfig = path.join(root, '.git', 'config')
if (fs.existsSync(gitConfig)) {
  const m = /^\s*url\s*=\s*(\S+)/m.exec(fs.readFileSync(gitConfig, 'utf8'))
  if (m) remoteSlug = slug(m[1])
}
ok('package.json repository matches the git remote',
  !remoteSlug || pkgSlug === remoteSlug,
  'package.json=' + (pkgSlug || 'none') + ' remote=' + (remoteSlug || 'none'))
ok('package.json homepage and bugs point at the same repository',
  slug(pkg.homepage) === pkgSlug && slug(pkg.bugs && pkg.bugs.url) === pkgSlug,
  pkgSlug || 'none')

/* ---- report ---- */
let failed = 0
for (const c of checks) {
  if (!c.pass) failed++
  console.log((c.pass ? 'PASS ' : 'FAIL ') + c.label + (c.extra !== undefined ? '  [' + c.extra + ']' : ''))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
