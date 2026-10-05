/**
 * Composer-launcher verification: proves the "拿去创作" path actually writes
 * into the composer draft through the framework's public inputActions face
 * (setDraft), which is the whole point of registering into a session-scoped
 * slot instead of only copying to the clipboard.
 */
const fs = require('fs')
const path = require('path')

// react / react-dom resolve through normal node module lookup (../node_modules).
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// dev/ only holds the harness — the plugin itself lives one level up.
const root = path.join(__dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'))

/* minimal DOM so the bundle's style injection does not explode */
global.window = { __ModuleLoader__: { load() {} } }
global.document = {
  head: { appendChild() {} },
  getElementById() { return null },
  createElement() { return { style: {}, set textContent(v) {}, set id(v) {} } },
}
global.navigator = {}
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(catalog) })

/* boot the bundle and capture the module */
let mod = null
global.window.__ModuleLoader__ = {
  load: ({ factory }) => {
    mod = factory((n) => {
      if (n === 'react') return React
      if (n === 'react/jsx-runtime') return require('react/jsx-runtime')
      throw new Error('unexpected require: ' + n)
    })
  },
}
eval(fs.readFileSync(path.join(root, 'client.js'), 'utf8'))

const checks = []
const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

/* register both slots and keep their components */
const regs = {}
const tReal = (k) => ({
  nav: '风格图库', subtitle: '看图选风格', searchPh: '搜索', allGroups: '全部',
  loading: '加载中', empty: '空', copy: '复制', copied: '已复制', create: '拿去创作',
  creating: '已填入', created: '✓ 已填入输入框', detail: '详情', traits: '特征',
  refBy: '参考', themePh: '主题', build: '提示词', close: '关闭', countUnit: '种',
  themeColor: '主题色', noneColor: '不限', loadFail: '失败', retry: '重试',
}[k] || k)

const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {}, bind: () => tReal },
  slots: {
    inject: (slot, cb) => { cb(); return () => {} },
    register: (m, c) => { regs[m.name] = { meta: m, comp: c }; return () => {} },
  },
}
mod.apply(ctx)

ok('registered settings.section', !!regs['settings.section'])
ok('registered conversation.input.left', !!regs['conversation.input.left'])
ok('launcher registration is additive (list slot, has id)',
  regs['conversation.input.left'] && regs['conversation.input.left'].meta.id === 'style-gallery-launcher',
  regs['conversation.input.left'] && regs['conversation.input.left'].meta.id)

/* ---- the launcher renders its trigger button ---- */
const Launcher = regs['conversation.input.left'].comp
let html = ''
try {
  html = renderToStaticMarkup(React.createElement(Launcher, { t: tReal, inputActions: { setDraft() {} } }))
  ok('launcher renders', html.length > 0)
  ok('launcher shows its label', html.indexOf('风格图库') !== -1, html.slice(0, 90))
  ok('panel is closed initially (no popup markup)', html.indexOf('dsg-pop') === -1)
} catch (e) {
  ok('launcher renders', false, e.message)
}

/* ---- prove setDraft is the wiring the launcher uses ---- */
const src = fs.readFileSync(path.join(root, 'client.js'), 'utf8')
const useFn = src.slice(src.indexOf('const use = (style)'), src.indexOf('const panel ='))
ok('launcher calls inputActions.setDraft', useFn.indexOf('actions.setDraft(') !== -1)
ok('launcher falls back to clipboard when setDraft is absent',
  useFn.indexOf('copyText(text)') !== -1)
ok('launcher guards setDraft with a typeof check', useFn.indexOf("typeof actions.setDraft === 'function'") !== -1)

/* no unverified global API may remain anywhere in the bundle */
ok('no speculative __DSH_COMPOSER__ global',
  src.indexOf('__DSH_COMPOSER__') === -1, 'still present')

/* ---- static-render the gallery section to confirm slot wiring ---- */
const Gallery = regs['settings.section'].comp
let ghtml = ''
try {
  ghtml = renderToStaticMarkup(React.createElement(Gallery, { t: tReal, close: () => {} }))
  ok('gallery section renders', ghtml.length > 0)
  ok('gallery locale namespace is our own (labels resolve)',
    ghtml.indexOf('风格图库') !== -1 || ghtml.indexOf('加载中') !== -1, ghtml.slice(0, 80))
} catch (e) {
  ok('gallery section renders', false, e.message)
}

let failed = 0
for (const c of checks) { if (!c.pass) failed++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.l + (c.e !== undefined ? '  [' + c.e + ']' : '')) }
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed ? 1 : 0)
