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
  Fragment: Symbol('Fragment'),
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
/** Pure prompt helpers the bundle exposes for this harness. */
const I = mod && mod.__internals
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

/* ---- catalog shape ---------------------------------------------------- */
const cat = JSON.parse(fs.readFileSync(path.join(root, 'data', 'catalog.json'), 'utf8'))
ok('catalog has 327 styles', cat.styles.length === 327, cat.styles.length)
ok('catalog has 166 layouts', cat.layouts.length === 166, cat.layouts.length)
ok('catalog has 5 layout categories', cat.layoutCategories.length === 5, cat.layoutCategories.length)
ok('catalog has 36 colors', cat.colors.length === 36, cat.colors.length)
ok('catalog has 8 groups', cat.groups.length === 8, cat.groups.length)
ok('catalog carries the upstream version it was built from',
  cat.generatedFrom && cat.generatedFrom.upstreamVersion === '1.8.5',
  cat.generatedFrom && cat.generatedFrom.upstreamVersion)

// The first release shipped traits truncated to the first few comma-separated
// words. Upstream's full text averages ~64 chars and runs to 1305; if this
// average collapses again the extractor has regressed to the summary file.
const avgTraits = Math.round(cat.styles.reduce((n, s) => n + (s.traits || '').length, 0) / cat.styles.length)
ok('traits are the full upstream text, not a truncated summary', avgTraits > 45, 'avg ' + avgTraits + ' chars')

// Upstream ships 13 styles with an empty `traits` field (mostly the FG-0xx
// recent additions). That is not a defect we should paper over: the contract
// handles it — "If no positive core trait exists and name is not strongly
// activated, use the author/style name, theme, and reference image." So the
// assertion is that every traitless style still resolves to *something* that
// can reproduce the look, never to a bare name.
const traitless = cat.styles.filter((s) => !(s.traits || '').trim())
ok('only upstream\'s own traitless styles are traitless',
  traitless.length === 13, traitless.length + ': ' + traitless.map((s) => s.number).join(','))
ok('a traitless style always resolves to a reference image or a strong name',
  traitless.every((s) => {
    const a = I.resolveActivation(cat, s)
    return a.useReference || a.source === 'name+style'
  }),
  traitless.filter((s) => {
    const a = I.resolveActivation(cat, s)
    return !a.useReference && a.source !== 'name+style'
  }).map((s) => s.number).join(',') || 'all covered')
ok('every style with traits resolves to a non-empty activation',
  cat.styles.filter((s) => (s.traits || '').trim()).every((s) => {
    const a = I.resolveActivation(cat, s)
    return a.source !== 'name+style' ? (a.useTraits || a.useReference) : true
  }), 'ok')

/* ---- legacy 001-327 numbering ----------------------------------------- */
// The library's own documentation indexes styles by the legacy number
// (`#041`), so every style needs one and the UI has to be able to search it.
ok('every style carries a legacy id', cat.styles.every((s) => /^\d{3}$/.test(s.legacy || '')),
  cat.styles.filter((s) => !/^\d{3}$/.test(s.legacy || '')).length + ' missing')
const legacySet = new Set(cat.styles.map((s) => s.legacy))
ok('legacy ids are unique', legacySet.size === cat.styles.length,
  legacySet.size + '/' + cat.styles.length)
ok('legacy ids run 001-327', cat.styles.every((s) => {
  const n = Number(s.legacy)
  return n >= 1 && n <= 327
}), 'range ok')
// The legacy numbering is a single 001-327 sequence that runs across the
// groups, so `#041` is FB-006, not FA-041. Getting this wrong is exactly the
// kind of thing that makes a search silently return nothing.
const byLegacy = {}
for (const s of cat.styles) byLegacy[s.legacy] = s
ok('searching the legacy number finds the style',
  byLegacy['041'] && byLegacy['041'].number === 'FB-006',
  byLegacy['041'] && byLegacy['041'].number)
ok('legacy 001 is the first style and 327 the last',
  byLegacy['001'].number === 'FA-001' && byLegacy['327'].number === 'FG-021',
  byLegacy['001'].number + ' / ' + byLegacy['327'].number)
ok('the legacy sequence is contiguous with no gaps',
  Array.from({ length: 327 }, (_, i) => String(i + 1).padStart(3, '0')).every((n) => byLegacy[n]),
  Object.keys(byLegacy).length + ' mapped')

/* ---- layouts ----------------------------------------------------------- */
// Two upstream layouts (IP-003, IP-011) are one short sentence. The floor here
// is "actually carries a prompt", not a length the library never promised.
const MIN_PROMPT = 8
ok('every layout has a Chinese prompt', cat.layouts.every((x) => (x.prompt_zh || '').trim().length > MIN_PROMPT),
  cat.layouts.filter((x) => (x.prompt_zh || '').trim().length <= MIN_PROMPT).map((x) => x.id).join(',') || 'all ok')
ok('every layout has an English prompt', cat.layouts.every((x) => (x.prompt_en || '').trim().length > MIN_PROMPT),
  cat.layouts.filter((x) => (x.prompt_en || '').trim().length <= MIN_PROMPT).map((x) => x.id).join(',') || 'all ok')
ok('every layout belongs to a known category',
  cat.layouts.every((x) => cat.layoutCategories.some((c) => c.id === x.category)),
  cat.layouts.filter((x) => !cat.layoutCategories.some((c) => c.id === x.category)).map((x) => x.id).join(',') || 'all ok')
ok('layout category counts add up to the layout count',
  cat.layoutCategories.reduce((n, c) => n + c.count, 0) === cat.layouts.length,
  cat.layoutCategories.map((c) => c.id + '=' + c.count).join(' '))
ok('layouts recovered from prompt files are flagged, not silently merged',
  cat.layouts.filter((x) => x.unindexed).every((x) => x.id && x.name),
  cat.layouts.filter((x) => x.unindexed).map((x) => x.id).join(',') || 'none')

/* ---- colours ----------------------------------------------------------- */
// The UI paints each theme-colour chip in the colour it names, so every colour
// needs a usable hex. Without one the chip falls back to a flat grey and the
// palette stops being a palette -- a data bug that only shows up visually.
const HEX = /^#[0-9a-fA-F]{6}$/
const badHex = cat.colors.filter((c) => !HEX.test(c.hex || '')).map((c) => c.id)
ok('every catalog color carries a #rrggbb hex', badHex.length === 0, badHex.join(',') || 'all 36 ok')
const distinctHex = new Set(cat.colors.map((c) => (c.hex || '').toLowerCase()))
ok('no two colors share a hex', distinctHex.size === cat.colors.length,
  distinctHex.size + '/' + cat.colors.length + ' distinct')
// Upstream ships 12 fields per colour; the first release kept 4.
ok('colors carry their category and quote, not just a name',
  cat.colors.every((c) => c.category_zh && c.quote_zh && c.prompt_zh),
  cat.colors.filter((c) => !(c.category_zh && c.quote_zh && c.prompt_zh)).map((c) => c.id).join(',') || 'all ok')
ok('color sheets are indexed', cat.colorSheets.length === 6, cat.colorSheets.length)

/* ---- asset layout ------------------------------------------------------ */
// The exact patterns the host allowlists, mirrored here so the client URL and
// the host route can be compared directly.
const KIND_RE = {
  styles: /^[A-Z]{2}-\d{3}(?:_grid)?\.(?:webp|png|jpe?g)$/,
  layouts: /^[A-Z]{2}-\d{3}\.(?:webp|png|jpe?g)$/,
  colors: /^(?:C-\d{2}|sheet_\d{2})\.(?:webp|png|jpe?g)$/,
  groups: /^[A-H]_\d{3}-\d{3}\.(?:webp|png|jpe?g)$/,
  characters: /^CH-\d{3}\.(?:webp|png|jpe?g)$/,
}
const assetFile = (kind, file) => path.join(root, 'assets', kind, file)

/* ---- contact sheets ---------------------------------------------------- */
// These are the library's A-H 图鉴 grouping (STYLES.md), a second ordering of
// the same 327 styles. They are also 8 MB of assets, so if nothing referenced
// them they would be pure weight — this is the check that they are wired in.
ok('the catalog indexes the 23 contact sheets', cat.groupSheets.length === 23, cat.groupSheets.length)
ok('contact sheets carry the legacy range they cover',
  cat.groupSheets.every((s) => Number.isInteger(s.from) && Number.isInteger(s.to) && s.from < s.to),
  cat.groupSheets.map((s) => s.letter + s.from + '-' + s.to).slice(0, 3).join(' '))
ok('contact sheets cover 001-327 with no gap',
  (() => {
    const sorted = cat.groupSheets.slice().sort((a, b) => a.from - b.from)
    if (sorted[0].from !== 1 || sorted[sorted.length - 1].to !== 327) return false
    return sorted.every((s, i) => i === 0 || s.from === sorted[i - 1].to + 1)
  })(),
  cat.groupSheets[0].from + '..' + cat.groupSheets[cat.groupSheets.length - 1].to)
ok('every contact sheet carries its STYLES.md section title',
  cat.groupSheets.every((s) => (s.section || '').length > 1),
  cat.groupSheets.filter((s) => !(s.section || '').length).map((s) => s.letter).join(',') || 'all titled')
const missingSheets = cat.groupSheets.filter((s) => !fs.existsSync(assetFile('groups', s.file)))
ok('every contact sheet has its asset on disk', missingSheets.length === 0,
  missingSheets.map((s) => s.file).join(',') || 'all 23 ok')
ok('contact sheet filenames pass the host allowlist',
  cat.groupSheets.every((s) => KIND_RE.groups.test(s.file)),
  cat.groupSheets.filter((s) => !KIND_RE.groups.test(s.file)).map((s) => s.file).join(',') || 'all ok')

/* ---- assets on disk match the ids the UI will request ------------------ */
const missingStyles = cat.styles.filter((s) => !fs.existsSync(assetFile('styles', s.number + '.webp')))
ok('every catalog style has a preview asset on disk', missingStyles.length === 0,
  missingStyles.slice(0, 5).map((s) => s.number).join(',') || 'all ' + cat.styles.length + ' ok')

const missingLayouts = cat.layouts.filter((x) => !fs.existsSync(assetFile('layouts', x.id + '.webp')))
ok('every catalog layout has a preview asset on disk', missingLayouts.length === 0,
  missingLayouts.slice(0, 5).map((x) => x.id).join(',') || 'all ' + cat.layouts.length + ' ok')

const missingColors = cat.colors.filter((c) => !fs.existsSync(assetFile('colors', c.id + '.webp')))
ok('every catalog color has a swatch asset on disk', missingColors.length === 0,
  missingColors.slice(0, 5).map((c) => c.id).join(',') || 'all ' + cat.colors.length + ' ok')

// `{id}_grid.webp` outranks the single preview as a reference for models that
// cannot activate a style from its name; the catalog flag has to match disk.
const gridStyles = cat.styles.filter((s) => s.grid)
ok('the catalog flags exactly the 36 styles that ship a grid sheet',
  gridStyles.length === 36 && gridStyles.every((s) => fs.existsSync(assetFile('styles', s.number + '_grid.webp'))),
  gridStyles.length + ' flagged')
const gridOnDisk = fs.readdirSync(path.join(root, 'assets', 'styles')).filter((f) => /_grid\.webp$/.test(f))
ok('no grid sheet on disk is missing from the catalog', gridOnDisk.length === gridStyles.length,
  gridOnDisk.length + ' on disk / ' + gridStyles.length + ' flagged')

/* ---- model calibration shape ------------------------------------------ */
// Upstream 1.8.5 shipped `FG-019`/`FG-020`/`FG-021` as top-level keys of
// model_capabilities.json instead of inside `models.<model>.styles`. Left alone
// it still *works* for the calibrated model (the client has a flat fallback) but
// the schema is wrong and any other model silently loses the calibration, so
// build_catalog.py hoists them. These assertions keep that fixed.
const capStyleIds = Object.keys(cat.models).filter((k) => /^[A-Z]{2}-\d{3}$/.test(k))
ok('no calibration entry is left outside `models`', capStyleIds.length === 0,
  capStyleIds.join(',') || 'models keys: ' + Object.keys(cat.models).join(','))

const calibrated = cat.models.models['gpt-image-2'].styles
ok('the three strays were hoisted into the calibrated model',
  ['FG-019', 'FG-020', 'FG-021'].every((id) => calibrated[id]),
  ['FG-019', 'FG-020', 'FG-021'].map((id) => id + '=' + JSON.stringify(calibrated[id])).join(' '))

const styleNumbers = {}
for (const s of cat.styles) styleNumbers[s.number] = s
const phantom = Object.keys(calibrated).filter((id) => !styleNumbers[id])
ok('every calibration entry names a style that exists', phantom.length === 0,
  phantom.slice(0, 5).join(',') || Object.keys(calibrated).length + ' entries all resolve')

// The calibration upstream wrote for those three must actually take effect.
// FG-019/FG-020 are weak-name + strong-traits; FG-021 is strong-name.
const fg019 = styleNumbers['FG-019']
const fg021 = styleNumbers['FG-021']
ok('FG-019 resolves to name + traits, not a reference image',
  I.resolveActivation(cat, fg019).source === 'name+style+traits',
  I.resolveActivation(cat, fg019).source)
ok('FG-021 resolves to name only (strong activation)',
  I.resolveActivation(cat, fg021).source === 'name+style',
  I.resolveActivation(cat, fg021).source)

// Cross-check the map against itself: anything the catalog calls `strong` must
// come out as name-only. This catches a hoist that lands in the wrong model.
const strongMismatch = cat.styles
  .filter((s) => (calibrated[s.number] || {}).name_activation === 'strong')
  .filter((s) => I.resolveActivation(cat, s).source !== 'name+style')
ok('every strong-activation style resolves to name only', strongMismatch.length === 0,
  strongMismatch.slice(0, 5).map((s) => s.number).join(',') ||
  cat.styles.filter((s) => (calibrated[s.number] || {}).name_activation === 'strong').length + ' checked')

/* ---- the client URL and the host allowlist must agree ------------------ */
// These are the exact URLs the client builds, checked against the exact
// patterns the host accepts. Drift here is a 400 in production and nothing in
// a unit test, which is why it is asserted directly.
const urls = []
for (const s of cat.styles) {
  urls.push(['styles', s.number + '.webp'])
  if (s.grid) urls.push(['styles', s.number + '_grid.webp'])
}
for (const x of cat.layouts) urls.push(['layouts', x.id + '.webp'])
for (const c of cat.colors) urls.push(['colors', c.id + '.webp'])
const rejected = urls.filter(([kind, file]) => !KIND_RE[kind].test(file))
ok('every asset URL the client builds passes the host allowlist', rejected.length === 0,
  rejected.slice(0, 5).map((u) => u.join('/')).join(',') || urls.length + ' urls ok')

// The old flat route must now be dead: it would 400 rather than serve the
// wrong file, but a stale client is a real risk so keep the pattern honest.
ok('a bare style filename is no longer a valid path segment',
  !KIND_RE.styles.test('../../package.json') && !KIND_RE.layouts.test('../lib/index.js'))

/* ---- the prompt contract ---------------------------------------------- */
ok('the prompt builder is exposed for testing', I && typeof I.stylePrompt === 'function')

/* filterTraits: drop clauses that tell the model what not to draw */
ok('filterTraits drops negative clauses',
  I.filterTraits('松散黑线；避免统一的可爱微笑；白底') === '松散黑线；白底',
  JSON.stringify(I.filterTraits('松散黑线；避免统一的可爱微笑；白底')))
ok('filterTraits drops 不要 / 不准 / 禁止 clauses too',
  I.filterTraits('白底。不要加渐变。不准歪头。禁止文字。颗粒感。') === '白底；颗粒感',
  JSON.stringify(I.filterTraits('白底。不要加渐变。不准歪头。禁止文字。颗粒感。')))
ok('filterTraits keeps the commas inside a kept clause',
  I.filterTraits('a，b，c；避免 d。') === 'a，b，c',
  JSON.stringify(I.filterTraits('a，b，c；避免 d。')))
ok('filterTraits tolerates empty input', I.filterTraits('') === '' && I.filterTraits(null) === '')

const fa001 = cat.styles.filter((s) => s.number === 'FA-001')[0]
ok('FA-001 is the documented strong-activation example',
  I.resolveActivation(cat, fa001).source === 'name+style',
  I.resolveActivation(cat, fa001).source)
ok('FA-001 traits keep the positive clauses',
  I.filterTraits(fa001.traits).indexOf('松散黑线') !== -1 &&
  I.filterTraits(fa001.traits).indexOf('日常吐槽与尴尬幽默') !== -1,
  I.filterTraits(fa001.traits).slice(0, 60))
ok('FA-001 traits drop the trailing 避免 clause',
  I.filterTraits(fa001.traits).indexOf('避免') === -1)

/* the Chinese prompt must follow the documented shape */
const pZh = I.stylePrompt(fa001, '一只猫在窗台', null, { catalog: cat, lang: 'zh' })
ok('Chinese prompt opens with 风格名称：', pZh.indexOf('风格名称：') === 0, pZh.split('\n')[0])
ok('Chinese prompt carries the reference author label',
  pZh.indexOf('参考作者/风格名称：') !== -1, 'present')
ok('Chinese prompt carries the theme verbatim', pZh.indexOf('主题：一只猫在窗台') !== -1)
ok('Chinese prompt never leaks the style id', pZh.indexOf('FA-001') === -1 && pZh.indexOf('#001') === -1)
ok('Chinese prompt never leaks any #nnn id', !/#\d{3}/.test(pZh))
// The single most important regression: the old builder appended a generic
// "构图完整，风格统一，不要出现任何文字、编号或水印" tail, which the
// contract forbids outright.
ok('Chinese prompt carries no appended generic tail',
  pZh.indexOf('构图完整') === -1 && pZh.indexOf('不要出现任何文字') === -1 && pZh.indexOf('单幅插画') === -1)
// strong activation means no traits at all
ok('strong-activation prompt omits core traits entirely', pZh.indexOf('核心风格特征：') === -1)
ok('strong-activation prompt omits the reference image', pZh.indexOf('参考图：') === -1)

const pEn = I.stylePrompt(fa001, 'a cat on a windowsill', null, { catalog: cat, lang: 'en' })
ok('English prompt opens with Style name:', pEn.indexOf('Style name: ') === 0, pEn.split('\n')[0])
ok('English prompt carries the theme', pEn.indexOf('Theme: a cat on a windowsill') !== -1)
ok('English prompt omits core traits for strong activation', pEn.indexOf('Core style traits:') === -1)
ok('English prompt carries no appended generic tail',
  pEn.indexOf('composition advice') === -1 && pEn.indexOf('high quality') === -1)

/* an empty theme must not stop the prompt: the contract wants a placeholder */
const pNoTheme = I.stylePrompt(fa001, '', null, { catalog: cat, lang: 'zh' })
ok('an empty theme falls back to the contract placeholder',
  pNoTheme.indexOf('【请在此输入画面主题') !== -1, 'placeholder present')

/* a style that needs a reference image must say so, with the path */
const needsRef = cat.styles.filter((s) => I.resolveActivation(cat, s).useReference)
ok('some styles resolve to requiring a reference image', needsRef.length > 0, needsRef.length + ' styles')
const refStyle = needsRef[0]
const pRef = I.stylePrompt(refStyle, '主题', null, { catalog: { ...cat, assetsPath: 'C:\\x\\assets' }, lang: 'zh' })
ok('a reference-requiring prompt names the asset path',
  pRef.indexOf('参考图：C:\\x\\assets\\styles\\') !== -1, pRef.split('\n').filter((l) => l.indexOf('参考图：') === 0)[0])
// The host reports its own separator; a POSIX root must not be given Windows
// separators (or vice versa), or the path in the prompt is not openable.
const pRefPosix = I.stylePrompt(refStyle, '主题', null, { catalog: { ...cat, assetsPath: '/opt/dsh/assets/' }, lang: 'zh' })
ok('the reference path follows the host separator and drops a trailing slash',
  pRefPosix.indexOf('参考图：/opt/dsh/assets/styles/') !== -1,
  pRefPosix.split('\n').filter((l) => l.indexOf('参考图：') === 0)[0])
ok('a reference-requiring prompt carries the isolation block',
  pRef.indexOf('所附图片仅用于参考画风') !== -1)
ok('the reference file prefers the grid sheet when the style has one',
  I.referenceFile(cat.styles.filter((s) => s.grid)[0]).indexOf('_grid.webp') !== -1,
  I.referenceFile(cat.styles.filter((s) => s.grid)[0]))
ok('the reference file falls back to the single preview otherwise',
  I.referenceFile(cat.styles.filter((s) => !s.grid)[0]).indexOf('_grid') === -1,
  I.referenceFile(cat.styles.filter((s) => !s.grid)[0]))

/* a weak-activation style with traits should still get them */
const withTraits = cat.styles.filter((s) => I.resolveActivation(cat, s).useTraits)
ok('some styles resolve to name + traits', withTraits.length > 0, withTraits.length + ' styles')
const pTraits = I.stylePrompt(withTraits[0], '主题', null, { catalog: cat, lang: 'zh' })
ok('a traits-activation prompt carries 核心风格特征',
  pTraits.indexOf('核心风格特征：') !== -1, pTraits.split('\n').filter((l) => l.indexOf('核心风格特征：') === 0)[0])
ok('the traits line contains no negative clause',
  !/(?:避免|不要|不准|禁止)/.test(pTraits.split('\n').filter((l) => l.indexOf('核心风格特征：') === 0)[0] || ''))

/* Field order must match the library's own scripts/prompt_style.py, which the
   contract summarises as: 风格名称 → 主题色 → 主题 → 参考作者 → 核心风格特征.
   A correct set of fields in the wrong order still reads as a different prompt
   to anyone who compares against the upstream output, so pin the order down. */
const orderColor = cat.colors.filter((c) => c.id === 'C-10')[0]
const pOrdered = I.stylePrompt(withTraits[0], '一只猫在窗台', orderColor, { catalog: cat, lang: 'zh' })
const at = (needle) => pOrdered.indexOf(needle)
ok('the prompt places 主题色 after 风格名称',
  at('风格名称：') === 0 && at('主题色：') !== -1 && at('主题色：') > at('风格名称：'),
  pOrdered.split('\n').slice(0, 3).join(' | '))
ok('the prompt places 主题 after 主题色',
  at('主题：') !== -1 && at('主题：') > at('主题色：'), pOrdered.split('\n').slice(0, 4).join(' | '))
ok('the prompt places 参考作者/风格名称 after 主题', at('主题：') < at('参考作者/风格名称：'))
ok('the prompt places 核心风格特征 last', at('参考作者/风格名称：') < at('核心风格特征：'))

/* Upstream closes the theme clause with a full stop — but only once. */
ok('the theme clause is closed with a full stop',
  pOrdered.indexOf('主题：一只猫在窗台。') !== -1,
  pOrdered.split('\n').filter((l) => l.indexOf('主题：') === 0)[0])
const pDotted = I.stylePrompt(withTraits[0], '一只猫在窗台。', null, { catalog: cat, lang: 'zh' })
ok('a theme that already ends in a stop is not doubled',
  pDotted.indexOf('一只猫在窗台。。') === -1 && pDotted.indexOf('主题：一只猫在窗台。') !== -1)
ok('the English prompt closes the theme with an ASCII full stop',
  I.stylePrompt(fa001, 'a cat', null, { catalog: cat, lang: 'en' }).indexOf('Theme: a cat.') !== -1)

/* layouts: graphic-text mode stacks the layout prompt and the fixed suffix */
const layout = cat.layouts.filter((x) => x.category === 'social-card')[0]
const pLayout = I.stylePrompt(fa001, '主题', null, { catalog: cat, lang: 'zh', layout })
ok('a layout prompt contains the layout text verbatim',
  pLayout.indexOf(layout.prompt_zh) !== -1, layout.id)
ok('a layout prompt appends the fixed graphic-text suffix',
  pLayout.indexOf('文字参与构图，图文一体】') !== -1)
ok('a layout prompt never exposes a reference path',
  pLayout.indexOf('参考图：') === -1 && pLayout.indexOf('所附图片仅用于参考画风') === -1)

const ec = cat.layouts.filter((x) => x.category === 'ecommerce')[0]
const pEc = I.stylePrompt(fa001, '主题', null, { catalog: cat, lang: 'zh', layout: ec })
ok('an e-commerce layout omits the generic suffix',
  pEc.indexOf('文字参与构图，图文一体】') === -1, ec.id)

const pLayoutOnly = I.layoutPrompt(layout, '主题', 'zh')
ok('a standalone layout prompt is usable on its own',
  pLayoutOnly.indexOf(layout.prompt_zh) === 0 && pLayoutOnly.indexOf('主题：主题') !== -1,
  pLayoutOnly.split('\n')[0].slice(0, 40))

/* an unknown model must fall back to the reference image, not to optimism */
const pUnknown = I.stylePrompt(fa001, '主题', null, { catalog: cat, lang: 'zh', model: 'some-future-model' })
ok('an uncalibrated model falls back to the reference image',
  I.resolveActivation(cat, fa001, 'some-future-model').useReference === true &&
  pUnknown.indexOf('参考图：') !== -1,
  I.resolveActivation(cat, fa001, 'some-future-model').source)

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
// The description is what a user reads in the plugin list, so a stale count
// there is the most visible kind of drift.
ok('package.json description states the real style count',
  pkg.description.indexOf('327') !== -1, pkg.description.slice(0, 60))

/* ---- report ---- */
let failed = 0
for (const c of checks) {
  if (!c.pass) failed++
  console.log((c.pass ? 'PASS ' : 'FAIL ') + c.label + (c.extra !== undefined ? '  [' + c.extra + ']' : ''))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
