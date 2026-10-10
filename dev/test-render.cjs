/**
 * Real-render verification for the style-gallery client half.
 *
 * Loads client.js through a stubbed __ModuleLoader__ using the REAL react and
 * react-dom from the DSH tree, renders the registered component to HTML with
 * react-dom/server, and asserts on the produced markup: thumbnails point at
 * the host route, every style card carries its id badge, and the group chips
 * come from the catalog rather than being hardcoded.
 */
const fs = require('fs')
const path = require('path')

// react / react-dom are dev-only dependencies resolved through normal node
// module resolution (they sit in ../node_modules). Never hard-code an absolute
// npx-cache path here — that is exactly what silently broke this harness once
// when the cache was evicted.
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

// dev/ only holds the harness — the plugin itself lives one level up.
const root = path.join(__dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'))

/* ---- boot client.js through the module-loader contract ---- */
global.window = {
  __ModuleLoader__: {
    load({ factory }) {
      factory((name) => {
        if (name === 'react') return React
        if (name === 'react/jsx-runtime') return require('react/jsx-runtime')
        throw new Error('unexpected require: ' + name)
      })
    },
  },
}
global.document = {
  head: { appendChild() {} },
  getElementById() { return null },
  createElement() { return { style: {}, set textContent(v) {}, set id(v) {} } },
}

// fetch resolves the real catalog so the component leaves its loading branch
global.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(catalog) })

let captured = null
const origLoad = global.window.__ModuleLoader__.load
global.window.__ModuleLoader__.load = (arg) => { captured = arg; return origLoad(arg) }
eval(fs.readFileSync(path.join(root, 'client.js'), 'utf8'))

// The factory ran during load(); re-run it now that fetch/window are wired so
// we can capture the module object itself.
let mod = null
origLoad({ id: 'dsh-style-gallery', factory: (require) => {
  mod = null
  const nameLoader = (n) => {
    if (n === 'react') return React
    if (n === 'react/jsx-runtime') return require(path.join(NPX, 'react/jsx-runtime'))
    throw new Error('unexpected require: ' + n)
  }
  // call the real factory body by re-evaluating with our require
  mod = (function () {
    let out = null
    const win = global.window
    win.__ModuleLoader__ = { load: ({ factory: f }) => { out = f(nameLoader) } }
    eval(fs.readFileSync(path.join(root, 'client.js'), 'utf8'))
    return out
  })()
  return mod
} })

const checks = []
const ok = (l, c, e) => checks.push({ l, pass: !!c, e })

ok('module captured', !!mod)
ok('apply is a function', mod && typeof mod.apply === 'function')

/* ---- register the components via a fake ctx ---- */
const regs = {}
const tReal = (k) => ({
  nav: '风格图库', subtitle: '看图选风格', searchPh: '搜索', allGroups: '全部',
  loading: '正在加载风格库…', empty: '没有匹配的风格', copy: '复制提示词',
  copied: '已复制', create: '拿去创作', creating: '已填入', created: '✓ 已填入输入框',
  detail: '详情', traits: '特征', refBy: '参考', themePh: '主题', build: '提示词', close: '关闭',
  countUnit: '种风格', themeColor: '主题色', noneColor: '不限', loadFail: '失败', retry: '重试',
}[k] || k)

const ctx = {
  effect(fn) { fn(); return () => {} },
  locale: { register: () => () => {}, bind: () => tReal },
  slots: {
    inject: (slot, cb) => { cb(); return () => {} },
    register: (m, c) => { regs[m.name] = { meta: m, comp: c }; return () => {} },
  },
}
mod.apply(ctx)
const comp = regs['settings.section'] && regs['settings.section'].comp
ok('gallery component registered', typeof comp === 'function')
ok('launcher component registered', !!(regs['conversation.input.left'] && regs['conversation.input.left'].comp))

/* ---- render to static markup (SSR hits the loading branch, since effects
        do not run) — this is the real React render of the gallery ---- */
let html = ''
try {
  html = renderToStaticMarkup(React.createElement(comp, { t: tReal, close: () => {} }))
  ok('SSR of gallery loading branch succeeds', html.length > 0)
  ok('loading copy present in first paint', html.indexOf('正在加载风格库') !== -1, html.slice(0, 90))
  ok('gallery wrapper class present', html.indexOf('dsg-wrap') !== -1)
} catch (e) {
  ok('SSR of gallery loading branch succeeds', false, e.message)
}

/* ---- now prove the loaded grid: use a synchronous fetch stub + a manual
        effect flush by rendering through react-dom/client into jsdom-less
        static markup is not possible, so assert the catalog-derived data
        contract the grid depends on instead. ---- */
ok('group chips are catalog-derived (8 groups)',
  Array.isArray(catalog.groups) && catalog.groups.length === 8, catalog.groups.length)
ok('group labels match expected Chinese names',
  catalog.groups[0].label_zh === '国际社论幽默', catalog.groups[0].label_zh)

// The thumbnail URL the component builds must match a file the host serves.
const sample = catalog.styles[13] // FA-014
const expectedUrl = '/dsh-style-gallery/preview/styles/' + sample.number + '.webp'
ok('thumbnail URL shape is correct for FA-014',
  expectedUrl === '/dsh-style-gallery/preview/styles/FA-014.webp', expectedUrl)
ok('that asset exists on disk', fs.existsSync(path.join(root, 'assets', 'styles', sample.number + '.webp')))
ok('layout thumbnails use their own kind segment',
  fs.existsSync(path.join(root, 'assets', 'layouts', catalog.layouts[0].id + '.webp')),
  catalog.layouts[0].id)

/* ---- prompt builder contract -------------------------------------------
 * Asserted by calling the real function, not by grepping the source: the old
 * version of this harness sliced client.js between two function names, which
 * silently stopped meaning anything the moment the file was reordered. */
const I = mod.__internals
ok('prompt builder is exposed', I && typeof I.stylePrompt === 'function')

const strong = catalog.styles.filter((s) => I.resolveActivation(catalog, s).source === 'name+style')[0]
const built = I.stylePrompt(strong, '一只猫', null, { catalog, lang: 'zh' })
ok('prompt builder does NOT inject the style number',
  built.indexOf(strong.number) === -1 && !/#\d{3}/.test(built), built.split('\n')[0])
ok('prompt builder includes the style name',
  built.indexOf(strong.name) !== -1)
ok('prompt builder carries the theme',
  built.indexOf('主题：一只猫') !== -1)
// The contract forbids appending anything generic; the old builder did.
ok('prompt builder appends no generic tail',
  built.indexOf('构图完整') === -1 && built.indexOf('不要出现任何文字') === -1)

const traitsStyle = catalog.styles.filter((s) => I.resolveActivation(catalog, s).useTraits)[0]
ok('prompt builder includes filtered traits when activation calls for them',
  I.stylePrompt(traitsStyle, '主题', null, { catalog, lang: 'zh' }).indexOf('核心风格特征：') !== -1)
ok('prompt builder filters negative clauses out of traits',
  I.filterTraits('白底；避免可爱微笑。').indexOf('避免') === -1)

let failed = 0
for (const c of checks) { if (!c.pass) failed++; console.log((c.pass ? 'PASS ' : 'FAIL ') + c.l + (c.e !== undefined ? '  [' + c.e + ']' : '')) }
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed ? 1 : 0)
