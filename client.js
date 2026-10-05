/**
 * dsh-style-gallery client: a "风格图库 / Style Gallery" settings section.
 *
 * Why this exists: the pure-skill approach could only show styles as text
 * cards, so picking one required already knowing the numbers by heart. This
 * section shows the real preview art next to every style, so choosing is
 * visual — and each card can copy its prompt, or drop it straight into the
 * composer, in one click.
 *
 * Built as a plain cordis plugin (no JSX/TS on purpose): the host loads this
 * file through window.__ModuleLoader__, whose module table only provides
 * `react`, `react/jsx-runtime`, and the DSH client packages — never a
 * bundler, never TS, never JSX.
 */
window.__ModuleLoader__.load({
  id: 'dsh-style-gallery',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-style-gallery'
    /** Where the host half serves the catalog + preview images. */
    const API = '/dsh-style-gallery'

    const zh = {
      nav: '风格图库',
      subtitle: '看图选风格 · 一键复制提示词去创作',
      searchPh: '搜索风格名 / 编号 / 作者，例如：蜡笔、FH-14、Risograph',
      allGroups: '全部',
      loading: '正在加载风格库…',
      loadFail: '风格库加载失败',
      retry: '重试',
      empty: '没有匹配的风格',
      traits: '特征',
      refBy: '参考',
      copy: '复制提示词',
      copied: '✓ 已复制',
      create: '拿去创作',
      creating: '已填入',
      created: '✓ 已填入输入框',
      detail: '风格详情',
      themePh: '想画什么主题？（可留空）',
      build: '生成提示词',
      close: '关闭',
      countUnit: '种风格',
      themeColor: '主题色',
      noneColor: '不限',
      clearAll: '重置筛选',
      creditLead: '风格数据与预览图来自 ',
      creditTail: '（MIT 授权，需署名）',
    }
    const en = {
      nav: 'Style Gallery',
      subtitle: 'Pick a style by eye · copy its prompt in one click',
      searchPh: 'Search name / id / author, e.g. crayon, FH-14, Risograph',
      allGroups: 'All',
      loading: 'Loading styles…',
      loadFail: 'Failed to load the style library',
      retry: 'Retry',
      empty: 'No matching styles',
      traits: 'Traits',
      refBy: 'Ref',
      copy: 'Copy prompt',
      copied: '✓ Copied',
      create: 'Use it',
      creating: 'Filled in',
      created: '✓ Added to input',
      detail: 'Style detail',
      themePh: 'What do you want to draw? (optional)',
      build: 'Build prompt',
      close: 'Close',
      countUnit: 'styles',
      themeColor: 'Theme color',
      noneColor: 'Any',
      clearAll: 'Reset filters',
      creditLead: 'Style data & preview art from ',
      creditTail: ' (MIT · attribution required)',
    }

    /* ------------------------------------------------------------------ *
     * Prompt assembly — mirrors the skill's contract: the style id must
     * never leak into the prompt body, only its name/reference/traits do.
     * ------------------------------------------------------------------ */

    function stylePrompt(style, theme, color) {
      const lines = []
      lines.push('请用【' + style.name + '】的手绘插画风格创作一张图。')
      const traits = (style.traits || '').trim()
      if (traits) lines.push('风格要点：' + traits + '。')
      if (style.reference && style.reference !== style.name) {
        lines.push('视觉参考方向：' + style.reference + '。')
      }
      if (color && color.name_zh) {
        lines.push('主题色：' + color.name_zh + (color.name_en ? '（' + color.name_en + '）' : '') + '。')
      }
      if (theme && theme.trim()) lines.push('画面主题：' + theme.trim() + '。')
      lines.push('要求：单幅插画，构图完整，风格统一，不要出现任何文字、编号或水印。')
      return lines.join('\n')
    }

    /**
     * WCAG relative luminance of a #rrggbb string. Used to pick the label colour
     * for a theme-colour swatch, and to darken the border of near-white ones.
     */
    function lum(hex) {
      const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
      const r = f(parseInt(hex.slice(1, 3), 16) / 255)
      const g = f(parseInt(hex.slice(3, 5), 16) / 255)
      const b = f(parseInt(hex.slice(5, 7), 16) / 255)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    /**
     * Whichever of black/white contrasts better against `hex`. A fixed threshold
     * fails on mid greys (warm grey #ACA39A: 2.5:1 with white, 8.4:1 with black).
     * Pure black/white keeps the worst case at the 4.58:1 crossover, clearing AA.
     */
    function fgOn(hex) {
      const L = lum(hex)
      return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff'
    }

    /**
     * Inline style for a theme-colour chip. Colours without a `hex` in the
     * catalog fall back to the plain chip look rather than rendering blank.
     */
    function chipSwatch(hex) {
      if (!hex) return undefined
      const st = { background: hex, color: fgOn(hex) }
      // Ivory / cream read as white on a light panel and blur into "none".
      if (lum(hex) > 0.62) st.borderColor = 'rgba(0,0,0,.45)'
      return st
    }

    /** Copy via the clipboard API with a textarea fallback for non-secure origins. */
    function copyText(text) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(text)
        }
      } catch { /* fall through */ }
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      } catch { /* ignore */ }
      return Promise.resolve()
    }

    /* ------------------------------------------------------------------ *
     * Styles are injected as a <style> node once per mount so the section
     * stays self-contained and never leans on product DOM selectors. All
     * colors go through theme CSS variables with sane fallbacks.
     * ------------------------------------------------------------------ */

    const CSS = [
      '.dsg-wrap{display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;color:var(--vscode-foreground,#1f2328)}',
      '.dsg-head{display:flex;flex-direction:column;gap:2px}',
      '.dsg-title{font-size:15px;font-weight:600;line-height:1.4}',
      '.dsg-sub{font-size:12px;opacity:.62}',
      '.dsg-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.dsg-input{flex:1 1 240px;min-width:180px;padding:7px 10px;font-size:13px;border-radius:8px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-input-background,#fff);color:inherit;outline:none}',
      '.dsg-input:focus{border-color:var(--vscode-focusBorder,#3b82f6)}',
      '.dsg-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.dsg-chip{padding:4px 10px;font-size:12px;border-radius:999px;cursor:pointer;user-select:none;border:1px solid var(--vscode-input-border,rgba(0,0,0,.14));background:transparent;color:inherit;line-height:1.6}',
      '.dsg-chip:hover{background:rgba(127,127,127,.12)}',
      '.dsg-chip.on{background:var(--vscode-focusBorder,#3b82f6);border-color:transparent;color:#fff}',
      '.dsg-chip .n{opacity:.6;margin-left:4px;font-size:11px}',
      '.dsg-chip.on .n{opacity:.85}',
      // 主题色按钮：整体填成该颜色本身。这几条必须排在 .dsg-chip.on 之后 ——
      // 同特异性靠顺序取胜；而 background/color 走内联样式，天然压过 .on 的底色白字。
      '.dsg-chip.c{border-color:rgba(0,0,0,.3);font-weight:600}',
      '.dsg-chip.c:hover{filter:brightness(1.12)}',
      '.dsg-chip.c.on{border-color:rgba(0,0,0,.6);box-shadow:0 0 0 2px var(--vscode-editor-background,#fff),0 0 0 4px var(--vscode-focusBorder,#3b82f6)}',
      '.dsg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;overflow:auto;padding:2px;flex:1 1 auto;min-height:0;align-content:start;grid-auto-rows:min-content}',
      // The card must size from its CONTENT: as a grid item that is also a
      // column flex container, its default `align-items: stretch` + auto rows
      // let it collapse to ~2px in this composition. `align-items:start` on
      // the card's own children plus min-height on the card keeps the art and
      // text in flow no matter how the host lays out the grid.
      '.dsg-card{border:1px solid var(--vscode-input-border,rgba(0,0,0,.12));border-radius:10px;overflow:hidden;background:var(--vscode-editor-background,transparent);display:flex;flex-direction:column;align-items:stretch;align-self:start;height:auto;transition:box-shadow .15s,border-color .15s}',
      '.dsg-card:hover{border-color:var(--vscode-focusBorder,#3b82f6);box-shadow:0 2px 10px rgba(0,0,0,.10)}',
      '.dsg-thumb{position:relative;width:100%;min-height:96px;background:rgba(127,127,127,.09);cursor:pointer;display:block;overflow:hidden;flex:0 0 auto}',
      '.dsg-thumb img{width:100%;height:auto;display:block;object-fit:cover}',
      '.dsg-badge{position:absolute;left:6px;top:6px;padding:1px 6px;font-size:10px;font-weight:600;border-radius:5px;background:rgba(0,0,0,.62);color:#fff;letter-spacing:.3px}',
      '.dsg-meta{padding:7px 8px 0;display:flex;flex-direction:column;gap:3px}',
      '.dsg-name{font-size:11.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}',
      '.dsg-traits{font-size:10.5px;opacity:.6;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}',
      '.dsg-acts{display:flex;gap:5px;padding:7px 8px 8px;margin-top:auto}',
      '.dsg-btn{flex:1;padding:5px 6px;font-size:11px;border-radius:7px;cursor:pointer;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:transparent;color:inherit;white-space:nowrap;line-height:1.5}',
      '.dsg-btn:hover{background:rgba(127,127,127,.12)}',
      '.dsg-btn.pri{background:var(--vscode-focusBorder,#3b82f6);border-color:transparent;color:#fff}',
      '.dsg-btn.pri:hover{opacity:.9}',
      '.dsg-btn.ok{background:#16a34a;border-color:transparent;color:#fff}',
      '.dsg-msg{padding:26px 12px;text-align:center;font-size:13px;opacity:.7}',
      '.dsg-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}',
      '.dsg-modal{background:var(--vscode-editor-background,#fff);color:inherit;border-radius:12px;max-width:640px;width:100%;max-height:86vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column}',
      '.dsg-mhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(127,127,127,.2)}',
      '.dsg-mtitle{font-size:14px;font-weight:600;flex:1;line-height:1.4}',
      '.dsg-x{cursor:pointer;border:none;background:transparent;color:inherit;font-size:20px;line-height:1;opacity:.6;padding:2px 6px;border-radius:6px}',
      '.dsg-x:hover{opacity:1;background:rgba(127,127,127,.15)}',
      '.dsg-mbody{padding:14px;display:flex;flex-direction:column;gap:12px}',
      '.dsg-mimg{width:100%;max-height:300px;object-fit:contain;border-radius:8px;background:rgba(127,127,127,.09)}',
      '.dsg-field{display:flex;flex-direction:column;gap:5px}',
      '.dsg-lab{font-size:12px;font-weight:600;opacity:.8}',
      '.dsg-ta{width:100%;min-height:120px;padding:9px 10px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1.6;border-radius:8px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-input-background,#fff);color:inherit;resize:vertical;outline:none;box-sizing:border-box}',
      '.dsg-mfoot{display:flex;gap:8px;padding:0 14px 14px}',
      '.dsg-colors{display:flex;flex-wrap:wrap;gap:6px}',
      '.dsg-credit{font-size:11px;opacity:.55;line-height:1.5;text-align:center;padding:2px 0 0}',
      '.dsg-credit a{color:inherit;text-decoration:underline;text-underline-offset:2px;cursor:pointer}',
      '.dsg-credit a:hover{opacity:.85}',
    ].join('')

    function useCssOnce() {
      React.useEffect(() => {
        const id = 'dsg-styles'
        if (document.getElementById(id)) return
        const el = document.createElement('style')
        el.id = id
        el.textContent = CSS
        document.head.appendChild(el)
      }, [])
    }

    /* ---------------------------- the section --------------------------- */

    function StyleGallery(props) {
      const t = props.t
      useCssOnce()

      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState(false)
      const [q, setQ] = React.useState('')
      const [group, setGroup] = React.useState('all')
      const [colorId, setColorId] = React.useState('')
      const [open, setOpen] = React.useState(null)
      const [themeText, setThemeText] = React.useState('')
      const [copiedKey, setCopiedKey] = React.useState('')
      const [sentKey, setSentKey] = React.useState('')
      const timerRef = React.useRef(null)

      const load = React.useCallback(() => {
        setError(false)
        fetch(API + '/catalog.json')
          .then((r) => {
            if (!r.ok) throw new Error('http ' + r.status)
            return r.json()
          })
          .then((d) => setCatalog(d))
          .catch(() => setError(true))
      }, [])

      React.useEffect(() => { load() }, [load])
      React.useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

      /** Both groups and colors come from the catalog, never hardcoded. */
      const groups = React.useMemo(() => {
        if (!catalog || !Array.isArray(catalog.groups)) return []
        return catalog.groups
      }, [catalog])

      const colors = React.useMemo(
        () => (catalog && Array.isArray(catalog.colors) ? catalog.colors : []),
        [catalog],
      )

      const colorById = React.useMemo(() => {
        const m = {}
        for (const c of colors) m[c.id] = c
        return m
      }, [colors])

      const filtered = React.useMemo(() => {
        if (!catalog || !Array.isArray(catalog.styles)) return []
        const needle = q.trim().toLowerCase()
        return catalog.styles.filter((s) => {
          if (group !== 'all' && s.group !== group) return false
          if (needle) {
            const hay = [s.number, s.name, s.reference, s.alias_zh, s.traits]
              .filter(Boolean).join(' ').toLowerCase()
            if (hay.indexOf(needle) === -1) return false
          }
          return true
        })
      }, [catalog, q, group])

      /** Flash a transient "done" state on a card button. */
      const flash = React.useCallback((key, setter) => {
        setter(key)
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setter(''), 1600)
      }, [])

      const doCopy = React.useCallback((style) => {
        const color = colorById[colorId] || null
        copyText(stylePrompt(style, '', color))
        flash(style.number, setCopiedKey)
      }, [colorById, colorId, flash])

      /**
       * "Use it" from inside the gallery: the gallery lives in a root-scoped
       * settings section, so it cannot reach the session input machine. It
       * copies the prompt and says so, and the composer-side launcher (a
       * session-scoped slot that DOES receive inputActions) handles direct
       * insertion. Nothing is silently dropped: the clipboard always holds it.
       */
      const doCreate = React.useCallback((style) => {
        const color = colorById[colorId] || null
        const text = stylePrompt(style, '', color)
        copyText(text)
        flash(style.number, setSentKey)
      }, [colorById, colorId, flash])

      if (error) {
        return h('div', { className: 'dsg-wrap' },
          h('div', { className: 'dsg-msg' }, t('loadFail') + ' ',
            h('button', { className: 'dsg-btn', style: { display: 'inline-block', flex: 'none', marginLeft: 8 }, onClick: load }, t('retry'))))
      }
      if (!catalog) {
        return h('div', { className: 'dsg-wrap' },
          h('div', { className: 'dsg-msg' }, t('loading')))
      }

      const head = h('div', { className: 'dsg-head' },
        h('div', { className: 'dsg-title' }, t('nav')),
        h('div', { className: 'dsg-sub' }, t('subtitle')),
      )

      const bar = h('div', { className: 'dsg-bar' },
        h('input', {
          className: 'dsg-input',
          value: q,
          placeholder: t('searchPh'),
          onChange: (e) => setQ(e.target.value),
        }),
      )

      const groupChips = h('div', { className: 'dsg-chips' },
        h('button', {
          className: 'dsg-chip' + (group === 'all' ? ' on' : ''),
          onClick: () => setGroup('all'),
        }, t('allGroups'), h('span', { className: 'n' }, String(catalog.styles.length))),
        groups.map((g) =>
          h('button', {
            key: g.id,
            className: 'dsg-chip' + (group === g.id ? ' on' : ''),
            onClick: () => setGroup(g.id),
            title: g.id,
          }, g.label_zh || g.id, h('span', { className: 'n' }, String(g.count))),
        ),
      )

      const colorChips = colors.length > 0
        ? h('div', { className: 'dsg-bar' },
            h('span', { className: 'dsg-lab' }, t('themeColor') + '：'),
            h('div', { className: 'dsg-chips' },
              h('button', {
                className: 'dsg-chip' + (colorId === '' ? ' on' : ''),
                onClick: () => setColorId(''),
              }, t('noneColor')),
              colors.map((c) =>
                h('button', {
                  key: c.id,
                  className: 'dsg-chip c' + (colorId === c.id ? ' on' : ''),
                  onClick: () => setColorId(c.id),
                  title: (c.name_en || '') + (c.hex ? '　' + c.hex : ''),
                  style: chipSwatch(c.hex),
                }, c.name_zh || c.id),
              ),
            ),
          )
        : null

      const grid = filtered.length === 0
        ? h('div', { className: 'dsg-msg' }, t('empty'))
        : h('div', { className: 'dsg-grid' },
            filtered.map((s) => {
              const isCopied = copiedKey === s.number
              const isSent = sentKey.indexOf(s.number) === 0
              return h('div', { className: 'dsg-card', key: s.number },
                h('div', {
                  className: 'dsg-thumb',
                  onClick: () => { setOpen(s); setThemeText('') },
                  title: t('detail'),
                },
                  h('img', {
                    src: API + '/preview/' + s.number + '.webp',
                    alt: s.name,
                    loading: 'lazy',
                    onError: (e) => { e.target.style.visibility = 'hidden' },
                  }),
                  h('span', { className: 'dsg-badge' }, s.number),
                ),
                h('div', { className: 'dsg-meta' },
                  h('div', { className: 'dsg-name', title: s.name }, s.name),
                  h('div', { className: 'dsg-traits', title: s.traits },
                    (s.traits || '').slice(0, 42)),
                ),
                h('div', { className: 'dsg-acts' },
                  h('button', {
                    className: 'dsg-btn' + (isCopied ? ' ok' : ''),
                    onClick: () => doCopy(s),
                  }, isCopied ? t('copied') : t('copy')),
                  h('button', {
                    className: 'dsg-btn pri',
                    onClick: () => doCreate(s),
                  }, isSent ? t('creating') : t('create')),
                ),
              )
            }),
          )

      const modal = open === null ? null : (() => {
        const color = colorById[colorId] || null
        const prompt = stylePrompt(open, themeText, color)
        return h('div', { className: 'dsg-mask', onClick: (e) => { if (e.target === e.currentTarget) setOpen(null) } },
          h('div', { className: 'dsg-modal' },
            h('div', { className: 'dsg-mhead' },
              h('div', { className: 'dsg-mtitle' }, open.number + ' · ' + open.name),
              h('button', { className: 'dsg-x', onClick: () => setOpen(null), title: t('close') }, '\u00d7'),
            ),
            h('div', { className: 'dsg-mbody' },
              h('img', { className: 'dsg-mimg', src: API + '/preview/' + open.number + '.webp', alt: open.name }),
              h('div', { className: 'dsg-field' },
                h('span', { className: 'dsg-lab' }, t('traits')),
                h('span', { style: { fontSize: 12, opacity: .8, lineHeight: 1.5 } }, open.traits || '—'),
              ),
              open.reference && open.reference !== open.name
                ? h('div', { className: 'dsg-field' },
                    h('span', { className: 'dsg-lab' }, t('refBy')),
                    h('span', { style: { fontSize: 12, opacity: .8 } }, open.reference))
                : null,
              h('div', { className: 'dsg-field' },
                h('span', { className: 'dsg-lab' }, t('themePh')),
                h('input', {
                  className: 'dsg-input',
                  value: themeText,
                  placeholder: t('themePh'),
                  onChange: (e) => setThemeText(e.target.value),
                }),
              ),
              h('div', { className: 'dsg-field' },
                h('span', { className: 'dsg-lab' }, t('build')),
                h('textarea', { className: 'dsg-ta', readOnly: true, value: prompt }),
              ),
            ),
            h('div', { className: 'dsg-mfoot' },
              h('button', {
                className: 'dsg-btn pri',
                onClick: () => { copyText(prompt); flash('modal', setCopiedKey) },
              }, copiedKey === 'modal' ? t('copied') : t('copy')),
              h('button', {
                className: 'dsg-btn',
                onClick: () => {
                  const text = prompt
                  copyText(text)
                  // The settings section cannot reach the session input machine;
                  // the composer launcher owns that. Clipboard holds the text.
                  try {
                    const api = window.__DSG_INSERT__
                    if (api && typeof api === 'function') api(text)
                  } catch { /* clipboard already holds it */ }
                  flash('modal', setSentKey)
                },
              }, sentKey === 'modal' ? t('creating') : t('create')),
            ),
          ),
        )
      })()

      // Attribution is a licence requirement of the upstream style library
      // (MIT with an explicit attribution clause), so it lives in the UI, not
      // just in the bundled LICENSE file.
      const credit = h('div', { className: 'dsg-credit' },
        h('span', null, t('creditLead')),
        h('a', {
          href: 'https://github.com/yang0/handraw-style',
          target: '_blank',
          rel: 'noreferrer noopener',
        }, 'yang0/handraw-style'),
        h('span', null, t('creditTail')),
      )

      return h('div', { className: 'dsg-wrap' },
        head, bar, groupChips, colorChips,
        h('div', { className: 'dsg-sub' },
          String(filtered.length) + ' / ' + String(catalog.styles.length) + ' ' + t('countUnit')),
        grid,
        credit,
        modal,
      )
    }

    /* ------------------------- composer launcher ------------------------ *
     * A tiny button in the composer tool row. This is a SESSION-scoped slot,
     * so the framework hands it `inputActions` — the verified public write
     * path (`setDraft`) into the draft. That is what actually makes
     * "拿去创作" work end to end, rather than only copying to the clipboard.
     * ------------------------------------------------------------------- */

    const LAUNCH_CSS = [
      '.dsg-launch{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;font-size:12px;line-height:1.6;border-radius:7px;cursor:pointer;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:transparent;color:inherit;white-space:nowrap}',
      '.dsg-launch:hover{background:rgba(127,127,127,.14)}',
      '.dsg-launch.on{border-color:var(--vscode-focusBorder,#3b82f6);color:var(--vscode-focusBorder,#3b82f6)}',
      '.dsg-pop{position:absolute;bottom:calc(100% + 8px);left:0;z-index:70;width:min(560px,86vw);max-height:min(460px,60vh);overflow:auto;border-radius:12px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-editor-background,#fff);color:var(--vscode-foreground,#1f2328);box-shadow:0 10px 34px rgba(0,0,0,.24);padding:10px}',
      '.dsg-pop-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.dsg-pop-title{font-size:12.5px;font-weight:600;flex:1}',
      '.dsg-pop-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}',
      '.dsg-pop-card{border:1px solid var(--vscode-input-border,rgba(0,0,0,.12));border-radius:8px;overflow:hidden;cursor:pointer;background:transparent;padding:0;color:inherit;text-align:left;display:flex;flex-direction:column}',
      '.dsg-pop-card:hover{border-color:var(--vscode-focusBorder,#3b82f6)}',
      '.dsg-pop-thumb{width:100%;height:auto;min-height:64px;object-fit:cover;display:block;background:rgba(127,127,127,.09)}',
      '.dsg-pop-name{font-size:10.5px;padding:4px 6px;line-height:1.3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
      '.dsg-anchor{position:relative;display:inline-flex}',
    ].join('')

    function useCss(id, css) {
      React.useEffect(() => {
        if (document.getElementById(id)) return
        const el = document.createElement('style')
        el.id = id
        el.textContent = css
        document.head.appendChild(el)
      }, [])
    }

    function ComposerLauncher(props) {
      const t = props.t
      const actions = props.inputActions
      useCss('dsg-launch-styles', LAUNCH_CSS)

      const [open, setOpen] = React.useState(false)
      const [catalog, setCatalog] = React.useState(null)
      const [q, setQ] = React.useState('')
      const [done, setDone] = React.useState('')

      React.useEffect(() => {
        if (!open || catalog) return
        fetch(API + '/catalog.json')
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => setCatalog(d || { styles: [], groups: [], colors: [] }))
          .catch(() => setCatalog({ styles: [], groups: [], colors: [] }))
      }, [open, catalog])

      const styles = React.useMemo(() => {
        const all = (catalog && catalog.styles) || []
        const n = q.trim().toLowerCase()
        const list = n
          ? all.filter((s) => [s.number, s.name, s.reference, s.traits]
              .filter(Boolean).join(' ').toLowerCase().indexOf(n) !== -1)
          : all
        return list.slice(0, 120)
      }, [catalog, q])

      /** Write the prompt into the real composer draft via the public action face. */
      const use = (style) => {
        const text = stylePrompt(style, '', null)
        let wrote = false
        try {
          if (actions && typeof actions.setDraft === 'function') {
            actions.setDraft(text)
            wrote = true
          }
        } catch { /* fall back below */ }
        if (!wrote) copyText(text)
        setDone(style.number)
        setOpen(false)
        // close the panel and clear the flash shortly after
        const id = setTimeout(() => setDone(''), 1500)
        void id
      }

      const panel = !open ? null : h('div', { className: 'dsg-pop' },
        h('div', { className: 'dsg-pop-head' },
          h('span', { className: 'dsg-pop-title' }, t('nav')),
          h('input', {
            className: 'dsg-input',
            style: { flex: '1 1 140px', minWidth: 0, padding: '5px 8px', fontSize: 12 },
            value: q,
            placeholder: t('searchPh'),
            onChange: (e) => setQ(e.target.value),
          }),
          h('button', { className: 'dsg-x', onClick: () => setOpen(false), title: t('close') }, '\u00d7'),
        ),
        !catalog
          ? h('div', { className: 'dsg-msg' }, t('loading'))
          : h('div', { className: 'dsg-pop-grid' },
              styles.map((s) => h('button', {
                key: s.number,
                className: 'dsg-pop-card',
                onClick: () => use(s),
                title: s.name + '\n' + (s.traits || ''),
              },
                h('img', { className: 'dsg-pop-thumb', src: API + '/preview/' + s.number + '.webp', alt: s.name, loading: 'lazy' }),
                h('span', { className: 'dsg-pop-name' }, s.number + ' ' + s.name),
              )),
            ),
      )

      return h('div', { className: 'dsg-anchor' },
        h('button', {
          className: 'dsg-launch' + (open || done ? ' on' : ''),
          onClick: () => setOpen((v) => !v),
          title: t('subtitle'),
        }, done ? t('created') : t('nav')),
        panel,
      )
    }

    /* ------------------------------ plugin ------------------------------ */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-style-gallery: dictionaries')
      const t = ctx.locale.bind(NS)

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'style-gallery',
        order: 45,
        label: () => t('nav'),
        locale: NS,
        inject: () => ({ t }),
      }, (props) => h(StyleGallery, Object.assign({}, props, { t }))))

      // The composer tool row is a session-scoped list slot: registering here
      // is additive (it sits beside the resident chrome, never replaces it)
      // and it is the only place the framework hands us `inputActions`.
      ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
        name: 'conversation.input.left',
        id: 'style-gallery-launcher',
        order: 30,
      }, (props) => h(ComposerLauncher, Object.assign({}, props, { t }))))
    }

    return { name: 'dsh-style-gallery', inject: ['slots', 'locale'], apply }  },
})
