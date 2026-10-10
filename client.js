/**
 * dsh-style-gallery client: a "风格图库 / Style Gallery" settings section.
 *
 * Why this exists: the pure-skill approach could only show styles as text
 * cards, so picking one required already knowing the numbers by heart. This
 * section shows the real preview art next to every style, so choosing is
 * visual — and each card can copy its prompt, or drop it straight into the
 * composer, in one click.
 *
 * It mirrors the upstream library (`yang0/handraw-style`) rather than
 * reinterpreting it:
 *   - 327 styles, each with its full `traits` text;
 *   - 166 layouts across five categories, with their bilingual prompts;
 *   - 36 theme colours with category and quote;
 *   - legacy `001-327` numbering, which is what the library's own docs use.
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
      searchPh: '搜索风格名 / 编号 / 作者，例如：蜡笔、FH-14、041、Risograph',
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
      creating: '✓ 已填入',
      created: '✓ 已填入输入框',
      // Shown instead of `creating` when no composer was reachable, so the
      // button never claims to have filled an input it could not reach.
      sentClip: '✓ 已复制',
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
      // --- tabs ---------------------------------------------------------
      tabStyles: '风格',
      tabLayouts: '版式',
      tabSheets: '总览',
      sheetUnit: '张拼图',
      sheetHint: '按老编号 001–327 分段的全库拼图大表，和 STYLES.md 的 A–H 分组一致。点开看大图。',
      layoutSearchPh: '搜索版式名 / 关键词，例如：九宫格、SC-001、分镜',
      countLayoutUnit: '种版式',
      emptyLayout: '没有匹配的版式',
      layoutDetail: '版式详情',
      layoutHint: '版式决定构图与文字结构，画风另选。',
      keywords: '关键词',
      // --- prompt panel -------------------------------------------------
      lang: '语言',
      layout: '版式',
      noLayout: '不挂版式',
      pickLayout: '挑一个版式',
      pickStyle: '挑一个画风',
      activation: '激活方式',
      activationName: '仅风格名',
      activationTraits: '风格名 + 特征',
      activationRef: '需要参考图',
      refNote: '此风格需随提示词附上参考图，模型才能还原到位。',
      refPath: '参考图路径',
      copyPath: '复制路径',
      graphicMode: '已启用图文模式：版式提示词 + 固定图文后缀。',
      ecommerceMode: '电商版式：不追加通用图文后缀。',
    }
    const en = {
      nav: 'Style Gallery',
      subtitle: 'Pick a style by eye · copy its prompt in one click',
      searchPh: 'Search name / id / author, e.g. crayon, FH-14, 041, Risograph',
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
      creating: '✓ Filled in',
      created: '✓ Added to input',
      sentClip: '✓ Copied',
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
      tabStyles: 'Styles',
      tabLayouts: 'Layouts',
      tabSheets: 'Overview',
      sheetUnit: 'sheets',
      sheetHint: 'The library\'s contact sheets for legacy 001-327, matching the A-H grouping in STYLES.md. Click to enlarge.',
      layoutSearchPh: 'Search layout name / keyword, e.g. nine-grid, SC-001',
      countLayoutUnit: 'layouts',
      emptyLayout: 'No matching layouts',
      layoutDetail: 'Layout detail',
      layoutHint: 'A layout fixes composition and text structure; the style is chosen separately.',
      keywords: 'Keywords',
      lang: 'Language',
      layout: 'Layout',
      noLayout: 'No layout',
      pickLayout: 'Pick a layout',
      pickStyle: 'Pick a style',
      activation: 'Activation',
      activationName: 'name only',
      activationTraits: 'name + traits',
      activationRef: 'reference image',
      refNote: 'This style needs the reference image attached for the model to match it.',
      refPath: 'Reference image',
      copyPath: 'Copy path',
      graphicMode: 'Graphic-text mode: layout prompt + the fixed suffix.',
      ecommerceMode: 'E-commerce layout: no generic suffix appended.',
    }

    /* ------------------------------------------------------------------ *
     * Prompt assembly — implements the upstream contract
     * (`skills/handdraw-style-prompter/SKILL.md`, "Style activation policy"
     * and "Output"). The previous version broke three of its hard rules:
     *
     *   1. It appended a tail. The contract is explicit: "Do not append
     *      generic composition advice, quality claims, negative prompts, or
     *      the fixed style anchor."
     *   2. It always emitted traits. For `name_activation=strong` styles the
     *      model already knows the look, and the contract says to output
     *      "only the reference author and style name, and STRICTLY DO NOT
     *      output core traits, local image file paths, or reference-isolation
     *      blocks."
     *   3. It copied the traits field verbatim. The contract says to include
     *      "only positive visible traits; filter clauses containing 避免,
     *      不要, 不准, or 禁止".
     *
     * A fourth rule governs the body text: style, layout and colour *ids*
     * must never appear inside a prompt, because image models draw them as
     * literal characters. Numbers live in the UI only.
     *
     * Everything between the two @prompt-core markers is self-contained and is
     * lifted verbatim by dev/build_workbuddy_html.py so the standalone
     * WorkBuddy page runs the SAME prompt code rather than a stale copy of it.
     * Keep it free of any reference to module scope.
     * ------------------------------------------------------------------ */

    /* @prompt-core:start */

    /** The library's calibrated baseline model; used when none is chosen. */
    const DEFAULT_MODEL = 'gpt-image-2'

    /** Clause markers that turn a trait into an instruction *not* to draw. */
    const NEGATIVE_CLAUSE = /(?:避免|不要|不准|禁止)/

    /**
     * Keep only the positive, visible half of a traits string: split into
     * clauses at `；` / `。`, drop any clause carrying a negative marker, and
     * rejoin. Upstream: "do not copy the traits field mechanically."
     */
    function filterTraits(raw) {
      const text = (raw || '').trim()
      if (!text) return ''
      const clauses = text.match(/[^；;。]+[；;。]?/g) || []
      return clauses
        .map((s) => s.trim())
        .filter((s) => s && !NEGATIVE_CLAUSE.test(s))
        .map((s) => s.replace(/[；;。\s]+$/, ''))
        .filter(Boolean)
        .join('；')
    }

    /**
     * Decide how much help the selected model needs, mirroring the library's
     * own `scripts/resolve_reference.py`. `source` is one of the four values
     * that script documents, so the UI can explain itself instead of silently
     * dropping or adding a reference image.
     */
    function resolveActivation(catalog, style, model) {
      const caps = (catalog && catalog.models) || {}
      const models = caps.models || {}
      const entry = models[model || DEFAULT_MODEL] || null
      let nameAct = 'unknown'
      let traitsAct = 'unknown'
      if (entry) {
        // Per-style calibration wins, then the model's own default.
        //
        // `caps[style.number]` is a defensive fallback only: upstream 1.8.5
        // shipped three calibration entries outside `models` entirely (a
        // malformed brace), and `dev/build_catalog.py` now hoists them into the
        // right place at build time. Kept so a catalog built by an older or
        // third-party script still resolves instead of silently losing a style's
        // calibration and demanding a reference image it does not need.
        const per = (entry.styles && entry.styles[style.number]) || caps[style.number] || {}
        nameAct = per.name_activation || entry.name_activation || 'unknown'
        traitsAct = per.traits_activation || entry.traits_activation || 'unknown'
      } else {
        // Uncalibrated model: the library's safe fallback is the reference
        // image, so never pretend traits alone are enough.
        const d = caps.default || {}
        nameAct = d.name_activation || 'unknown'
        traitsAct = 'unknown'
      }
      const traits = filterTraits(style.traits)

      if (nameAct === 'strong') {
        // Adding traits or a reference here actively degrades the result.
        return { traits: '', useTraits: false, useReference: false, source: 'name+style' }
      }
      if (!traits) {
        return { traits: '', useTraits: false, useReference: true, source: 'name+style+reference-image' }
      }
      if (traitsAct === 'strong') {
        return { traits, useTraits: true, useReference: false, source: 'name+style+traits' }
      }
      return { traits, useTraits: true, useReference: true, source: 'name+style+traits+reference-image' }
    }

    /**
     * Which asset a required reference should point at. Upstream: "a matching
     * `{number}_grid.webp` in the same category takes priority" — the contact
     * sheet carries more of the style than a single sample does.
     */
    function referenceFile(style) {
      return (style.grid ? style.number + '_grid' : style.number) + '.webp'
    }

    /** Join onto the host-reported assets root using that host's separator. */
    function joinPath(base, ...parts) {
      const root = String(base || '').replace(/[\\/]+$/, '')
      const sep = root.indexOf('\\') === -1 ? '/' : '\\'
      return [root].concat(parts).join(sep)
    }

    /** Verbatim strings from the skill contract. Do not edit or translate. */
    const ISOLATION_ZH = '所附图片仅用于参考画风。只提取参考图的风格特征，例如线条、笔触、媒介、材质、色彩倾向和整体视觉语言；不要使用、复制或延续参考图中的任何主体、人物、动物、服装、道具、动作、姿态、场景、背景、构图、布局、文字或故事。最终画面内容完全以用户提供的主题为准。'
    const ISOLATION_EN = 'Use the attached image only as a style reference. Extract only its stylistic qualities, such as linework, brushwork, medium, material texture, color tendencies, and overall visual language. Do not use, copy, or carry over any subject, person, animal, clothing, prop, action, pose, setting, background, composition, layout, text, or story from the reference image. The user\'s written theme is the sole source for the image content.'
    const GRAPHIC_TEXT_SUFFIX = '【如果主题直白包含画面元素那就按主题出图，文案由你来升华，但是不要直接描述画面。 如果主题比较概念化，那么文案和主题尽量保持一致，如果文案较长由你提炼，由你先设计画面隐喻（人类和非人类都行）再出图   。    文字参与构图，图文一体】'
    const THEME_PLACEHOLDER_ZH = '【请在此输入画面主题，或在生图模型中垫入你的照片】'
    const THEME_PLACEHOLDER_EN = '[Enter theme here, or attach your photo in the image AI]'

    /**
     * Upstream closes the theme clause with a full stop (`主题：{theme}。` /
     * `Theme: {theme}.`). Mirror that, but never double a stop the user's own
     * text already ends with — a theme ending in `。` or `!` must not become
     * `。。`.
     */
    function ended(s, mark) {
      return /[。！？.!?]$/.test(s) ? s : s + (mark || '。')
    }

    /**
     * Build one copyable prompt.
     *
     * @param style   catalog style entry
     * @param theme   free text; may be empty (a placeholder is used instead of
     *                stopping to ask, per the contract's "Inputs" section)
     * @param color   catalog colour entry or null
     * @param opts    { catalog, lang: 'zh'|'en', layout, model }
     * @returns string
     */
    function stylePrompt(style, theme, color, opts) {
      const o = opts || {}
      const catalog = o.catalog || null
      const lang = o.lang === 'en' ? 'en' : 'zh'
      const layout = o.layout || null
      const act = resolveActivation(catalog, style, o.model)
      const text = (theme || '').trim()

      // A layout means graphic-text mode, which stacks the fixed suffix onto
      // the layout's own prompt. E-commerce layouts are the documented
      // exception: no suffix.
      const layoutMode = Boolean(layout)
      const graphic = layoutMode && layout.category !== 'ecommerce'

      const lines = []
      if (lang === 'zh') {
        // Field order mirrors the library's own scripts/prompt_style.py, which
        // the skill contract summarises: style name, theme colour, theme, then
        // the reference label and the filtered traits.
        lines.push('风格名称：' + style.name + '。')
        if (color && color.name_zh) {
          lines.push('主题色：' + color.name_zh + (color.name_en ? '（' + color.name_en + '）' : '') + '。')
        }
        // A layout owns its own order — its prompt file verbatim, then the
        // theme appended as the only source of subject matter — so the theme
        // clause drops below the layout text in that mode.
        if (!layout) lines.push('主题：' + ended(text || THEME_PLACEHOLDER_ZH))
        if (style.reference && style.reference !== style.name) {
          lines.push('参考作者/风格名称：' + style.reference + '。')
        }
        if (act.useTraits) lines.push('核心风格特征：' + act.traits + '。')
        if (layout) {
          lines.push(layout.prompt_zh)
          lines.push('主题：' + ended(text || THEME_PLACEHOLDER_ZH))
        }
        if (graphic) lines.push(GRAPHIC_TEXT_SUFFIX)
        // Never a path inside a layout prompt; the reference is shown beside
        // the prompt in that mode instead.
        if (act.useReference && !layoutMode) {
          lines.push('参考图：' + joinPath(catalog && catalog.assetsPath, 'styles', referenceFile(style)))
          lines.push(ISOLATION_ZH)
        }
      } else {
        lines.push('Style name: ' + style.name + '.')
        if (color && color.name_en) {
          lines.push('Theme color: ' + color.name_en + '.')
        }
        if (!layout) lines.push('Theme: ' + ended(text || THEME_PLACEHOLDER_EN, '.'))
        if (style.reference && style.reference !== style.name) {
          lines.push('Reference author/style name: ' + style.reference + '.')
        }
        if (act.useTraits) lines.push('Core style traits: ' + act.traits + '.')
        if (layout) {
          lines.push(layout.prompt_en || layout.prompt_zh)
          lines.push('Theme: ' + ended(text || THEME_PLACEHOLDER_EN, '.'))
        }
        // The contract keeps the Chinese suffix verbatim in both languages.
        if (graphic) lines.push(GRAPHIC_TEXT_SUFFIX)
        if (act.useReference && !layoutMode) {
          lines.push('Reference image: ' + joinPath(catalog && catalog.assetsPath, 'styles', referenceFile(style)))
          lines.push(ISOLATION_EN)
        }
      }

      return lines.join('\n')
    }

    /** A layout's own prompt, standalone (no style stitched on). */
    function layoutPrompt(layout, theme, lang) {
      const isEn = lang === 'en'
      const text = (theme || '').trim()
      const graphic = layout.category !== 'ecommerce'
      const lines = isEn
        ? [layout.prompt_en || layout.prompt_zh]
        : [layout.prompt_zh]
      lines.push((isEn ? 'Theme: ' : '主题：') +
        ended(text || (isEn ? THEME_PLACEHOLDER_EN : THEME_PLACEHOLDER_ZH), isEn ? '.' : '。'))
      if (graphic) lines.push(GRAPHIC_TEXT_SUFFIX)
      return lines.join('\n')
    }

    /* @prompt-core:end */

    /* ------------------------------- helpers ----------------------------- */

    /** The id the library's own docs use (`#041`); falls back to the new one. */
    function legacyOf(style) {
      return style.legacy ? '#' + style.legacy : style.number
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

    /** Marks a flash key as "only the clipboard took it", not the draft. */
    const CLIP_SUFFIX = '#clip'

    /**
     * Write into the real composer draft, when one is reachable.
     *
     * The gallery lives in a root-scoped settings section, and the framework
     * never hands that scope `inputActions` — on its own it could only ever
     * copy to the clipboard. The composer launcher (a session-scoped slot) is
     * the one place that receives the action face, so it publishes it on
     * `window` while mounted and this is how the gallery's buttons reach it.
     *
     * Returns false when no composer is mounted. Callers must then fall back to
     * the clipboard *and say so* — the whole point of this function existing is
     * that a button must never claim to have filled an input it never touched.
     */
    function insertDraft(text) {
      try {
        const api = window.__DSG_INSERT__
        if (typeof api === 'function' && api(text) === true) return true
      } catch { /* fall through to the clipboard */ }
      return false
    }

    /* ------------------------------------------------------------------ *
     * Styles are injected as a <style> node once per mount so the section
     * stays self-contained and never leans on product DOM selectors. All
     * colors go through theme CSS variables with sane fallbacks.
     * ------------------------------------------------------------------ */

    const CSS = [
      '.dsg-wrap{display:flex;flex-direction:column;gap:12px;height:100%;min-height:0;color:var(--vscode-foreground,#1f2328)}',
      '.dsg-head{display:flex;flex-direction:column;gap:2px}',
      '.dsg-title{font-size:15px;font-weight:600;line-height:1.4}',
      '.dsg-sub{font-size:12px;opacity:.62}',
      '.dsg-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
      '.dsg-input{flex:1 1 240px;min-width:180px;padding:7px 10px;font-size:13px;border-radius:8px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-input-background,#fff);color:inherit;outline:none}',
      '.dsg-input:focus{border-color:var(--vscode-focusBorder,#3b82f6)}',
      // The theme box is a textarea, not a one-line input, and deliberately
      // does NOT reuse `.dsg-input`. That rule's `flex:1 1 240px` is right for
      // the search field (which sits in a row), but `.dsg-field` is a column —
      // so the 240px basis landed on the *height* and inflated the box. Here
      // `rows={4}` sets the default height and the user drags from there.
      '.dsg-theme{width:100%;box-sizing:border-box;padding:7px 10px;font-size:13px;font-family:inherit;line-height:1.5;border-radius:8px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-input-background,#fff);color:inherit;outline:none;resize:vertical;white-space:pre-wrap}',
      '.dsg-theme:focus{border-color:var(--vscode-focusBorder,#3b82f6)}',
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
      // 主分区切换（风格 / 版式）
      '.dsg-tabs{display:flex;gap:2px;border-bottom:1px solid rgba(127,127,127,.22)}',
      '.dsg-tab{padding:6px 14px;font-size:13px;cursor:pointer;border:none;background:transparent;color:inherit;opacity:.6;border-bottom:2px solid transparent;margin-bottom:-1px;line-height:1.6}',
      '.dsg-tab:hover{opacity:.85}',
      '.dsg-tab.on{opacity:1;font-weight:600;border-bottom-color:var(--vscode-focusBorder,#3b82f6)}',
      '.dsg-tab .n{opacity:.6;margin-left:5px;font-size:11px}',
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
      // 需要参考图的风格：角标提示，省得用户复制完才发现少东西。
      '.dsg-ref{position:absolute;right:6px;top:6px;padding:1px 6px;font-size:10px;font-weight:600;border-radius:5px;background:rgba(180,83,9,.88);color:#fff}',
      '.dsg-meta{padding:7px 8px 0;display:flex;flex-direction:column;gap:3px}',
      '.dsg-name{font-size:11.5px;font-weight:600;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}',
      '.dsg-traits{font-size:10.5px;opacity:.6;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}',
      '.dsg-acts{display:flex;gap:5px;padding:7px 8px 8px;margin-top:auto}',
      '.dsg-btn{padding:5px 8px;font-size:11px;border-radius:7px;cursor:pointer;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:transparent;color:inherit;white-space:nowrap;line-height:1.5}',
      '.dsg-btn:hover{background:rgba(127,127,127,.12)}',
      '.dsg-btn.grow{flex:1}',
      '.dsg-btn.pri{background:var(--vscode-focusBorder,#3b82f6);border-color:transparent;color:#fff}',
      '.dsg-btn.pri:hover{opacity:.9}',
      '.dsg-btn.ok{background:#16a34a;border-color:transparent;color:#fff}',
      '.dsg-btn.sm{padding:3px 8px;font-size:11px}',
      '.dsg-msg{padding:26px 12px;text-align:center;font-size:13px;opacity:.7}',
      '.dsg-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:60;padding:16px}',
      '.dsg-modal{background:var(--vscode-editor-background,#fff);color:inherit;border-radius:12px;max-width:680px;width:100%;max-height:86vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column}',
      '.dsg-mhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid rgba(127,127,127,.2);position:sticky;top:0;background:var(--vscode-editor-background,#fff);z-index:1}',
      '.dsg-mtitle{font-size:14px;font-weight:600;flex:1;line-height:1.4}',
      '.dsg-x{cursor:pointer;border:none;background:transparent;color:inherit;font-size:20px;line-height:1;opacity:.6;padding:2px 6px;border-radius:6px}',
      '.dsg-x:hover{opacity:1;background:rgba(127,127,127,.15)}',
      '.dsg-mbody{padding:14px;display:flex;flex-direction:column;gap:12px}',
      '.dsg-mimg{width:100%;max-height:320px;object-fit:contain;border-radius:8px;background:rgba(127,127,127,.09)}',
      '.dsg-field{display:flex;flex-direction:column;gap:5px}',
      '.dsg-lab{font-size:12px;font-weight:600;opacity:.8}',
      '.dsg-labrow{display:flex;align-items:center;gap:8px}',
      '.dsg-labrow .dsg-lab{flex:1}',
      '.dsg-seg{display:inline-flex;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));border-radius:7px;overflow:hidden}',
      '.dsg-seg button{padding:3px 10px;font-size:11px;border:none;background:transparent;color:inherit;cursor:pointer;line-height:1.6}',
      '.dsg-seg button+button{border-left:1px solid var(--vscode-input-border,rgba(0,0,0,.16))}',
      '.dsg-seg button.on{background:var(--vscode-focusBorder,#3b82f6);color:#fff}',
      '.dsg-ta{width:100%;min-height:150px;padding:9px 10px;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;line-height:1.6;border-radius:8px;border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));background:var(--vscode-input-background,#fff);color:inherit;resize:vertical;outline:none;box-sizing:border-box;white-space:pre-wrap}',
      '.dsg-mfoot{display:flex;gap:8px;padding:0 14px 14px}',
      '.dsg-colors{display:flex;flex-wrap:wrap;gap:6px}',
      '.dsg-note{font-size:11.5px;line-height:1.55;opacity:.72;padding:7px 9px;border-radius:7px;background:rgba(127,127,127,.10)}',
      '.dsg-note.warn{background:rgba(180,83,9,.14);opacity:.95}',
      '.dsg-kv{font-size:12px;line-height:1.55;opacity:.85}',
      '.dsg-kws{display:flex;flex-wrap:wrap;gap:5px}',
      '.dsg-kw{padding:2px 8px;font-size:11px;border-radius:999px;background:rgba(127,127,127,.14)}',
      // 模态框里的迷你选择器（挑版式 / 挑画风）
      '.dsg-pick{border:1px solid var(--vscode-input-border,rgba(0,0,0,.16));border-radius:8px;overflow:hidden}',
      '.dsg-pick-list{max-height:150px;overflow:auto;display:flex;flex-direction:column}',
      '.dsg-pick-item{display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:12px;cursor:pointer;border:none;background:transparent;color:inherit;text-align:left;line-height:1.5}',
      '.dsg-pick-item:hover{background:rgba(127,127,127,.14)}',
      '.dsg-pick-item.on{background:var(--vscode-focusBorder,#3b82f6);color:#fff}',
      '.dsg-pick-item .id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10.5px;opacity:.6;flex:0 0 auto}',
      '.dsg-pick-item.on .id{opacity:.9}',
      '.dsg-pick-item .nm{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.dsg-pick-empty{padding:9px;font-size:12px;opacity:.6}',
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

    /** Flash a transient "done" state on a button, then clear it. */
    function useFlash() {
      const [key, setKey] = React.useState('')
      const timer = React.useRef(null)
      React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
      const flash = React.useCallback((next) => {
        setKey(next)
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setKey(''), 1600)
      }, [])
      return [key, flash]
    }

    /** A compact type-to-filter picker, used inside the modals. */
    function Picker(props) {
      const [q, setQ] = React.useState('')
      const items = React.useMemo(() => {
        const n = q.trim().toLowerCase()
        if (!n) return props.items.slice(0, 60)
        return props.items.filter((it) => props.haystack(it).indexOf(n) !== -1).slice(0, 60)
      }, [q, props.items, props.haystack])

      return h('div', { className: 'dsg-pick' },
        h('input', {
          className: 'dsg-input',
          style: { borderRadius: 0, border: 'none', borderBottom: '1px solid var(--vscode-input-border,rgba(0,0,0,.16))', fontSize: 12, padding: '6px 8px' },
          value: q,
          placeholder: props.placeholder,
          onChange: (e) => setQ(e.target.value),
        }),
        h('div', { className: 'dsg-pick-list' },
          items.length === 0
            ? h('div', { className: 'dsg-pick-empty' }, props.emptyText)
            : items.map((it) => h('button', {
                key: it.id,
                className: 'dsg-pick-item' + (it.id === props.value ? ' on' : ''),
                onClick: () => props.onPick(it.id),
              },
                h('span', { className: 'id' }, it.id),
                h('span', { className: 'nm' }, it.label),
              )),
        ),
      )
    }

    /* ---------------------------- the section --------------------------- */

    function StyleGallery(props) {
      const t = props.t
      useCssOnce()

      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState(false)
      const [tab, setTab] = React.useState('styles')
      const [q, setQ] = React.useState('')
      const [group, setGroup] = React.useState('all')
      const [colorId, setColorId] = React.useState('')
      const [layoutCat, setLayoutCat] = React.useState('all')
      // The open modal: { kind: 'style'|'layout', id } — resolved against the
      // catalog on every render so a reload cannot leave it dangling.
      const [open, setOpen] = React.useState(null)
      const [themeText, setThemeText] = React.useState('')
      const [lang, setLang] = React.useState('zh')
      const [pickedLayout, setPickedLayout] = React.useState('')
      const [pickedStyle, setPickedStyle] = React.useState('')
      const [copiedKey, flashCopied] = useFlash()
      const [sentKey, flashSent] = useFlash()

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

      /** Everything below comes from the catalog, never hardcoded. */
      const styles = React.useMemo(
        () => (catalog && Array.isArray(catalog.styles) ? catalog.styles : []),
        [catalog],
      )
      const layouts = React.useMemo(
        () => (catalog && Array.isArray(catalog.layouts) ? catalog.layouts : []),
        [catalog],
      )
      const colors = React.useMemo(
        () => (catalog && Array.isArray(catalog.colors) ? catalog.colors : []),
        [catalog],
      )
      const groups = React.useMemo(
        () => (catalog && Array.isArray(catalog.groups) ? catalog.groups : []),
        [catalog],
      )
      const layoutCats = React.useMemo(
        () => (catalog && Array.isArray(catalog.layoutCategories) ? catalog.layoutCategories : []),
        [catalog],
      )
      const sheets = React.useMemo(
        () => (catalog && Array.isArray(catalog.groupSheets) ? catalog.groupSheets : []),
        [catalog],
      )

      const styleById = React.useMemo(() => {
        const m = {}
        for (const s of styles) m[s.number] = s
        return m
      }, [styles])

      const colorById = React.useMemo(() => {
        const m = {}
        for (const c of colors) m[c.id] = c
        return m
      }, [colors])

      const layoutById = React.useMemo(() => {
        const m = {}
        for (const x of layouts) m[x.id] = x
        return m
      }, [layouts])

      // Legacy numbers (`041`) are what the library's own documentation uses,
      // so they have to be searchable, not just displayed.
      const styleHay = React.useCallback(
        (s) => [s.number, s.legacy, s.name, s.reference, s.alias_zh, s.traits]
          .filter(Boolean).join(' ').toLowerCase(),
        [],
      )
      const layoutHay = React.useCallback(
        (x) => [x.id, x.name, x.name_en, (x.keywords || []).join(' '), x.prompt_zh]
          .filter(Boolean).join(' ').toLowerCase(),
        [],
      )

      const filteredStyles = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        return styles.filter((s) => {
          if (group !== 'all' && s.group !== group) return false
          if (needle && styleHay(s).indexOf(needle) === -1) return false
          return true
        })
      }, [styles, q, group, styleHay])

      const filteredLayouts = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        return layouts.filter((x) => {
          if (layoutCat !== 'all' && x.category !== layoutCat) return false
          if (needle && layoutHay(x).indexOf(needle) === -1) return false
          return true
        })
      }, [layouts, q, layoutCat, layoutHay])

      const openStyle = open && open.kind === 'style' ? styleById[open.id] || null : null
      const openLayout = open && open.kind === 'layout' ? layoutById[open.id] || null : null
      const openSheet = open && open.kind === 'sheet'
        ? sheets.filter((s) => s.file === open.id)[0] || null
        : null

      const openModal = React.useCallback((kind, id) => {
        setOpen({ kind, id })
        setThemeText('')
        setPickedLayout('')
        setPickedStyle('')
      }, [])

      const selectedColor = colorById[colorId] || null

      /**
       * Build the prompt for a style/layout pair under the current controls.
       *
       * Declared here, above the early returns: a hook below them would change
       * the hook count the moment the catalog finishes loading (React #310).
       */
      const promptFor = React.useCallback(
        (style, layout) => stylePrompt(style, themeText, selectedColor, { catalog, lang, layout }),
        [catalog, lang, selectedColor, themeText])

      /**
       * Route a finished prompt to wherever it can actually go: the composer
       * draft when the launcher has published its action face, the clipboard
       * otherwise. The flash key records which of the two happened (see
       * `CLIP_SUFFIX`) so the button can report it honestly instead of always
       * claiming the input was filled.
       */
      const send = React.useCallback((text, id) => {
        if (insertDraft(text)) { flashSent(id); return }
        copyText(text)
        flashSent(id + CLIP_SUFFIX)
      }, [flashSent])

      /** Label for a "Use it" button, given what its last click actually did. */
      const sentLabel = (id) => {
        if (sentKey === id) return t('creating')
        if (sentKey === id + CLIP_SUFFIX) return t('sentClip')
        return t('create')
      }

      if (error) {
        return h('div', { className: 'dsg-wrap' },
          h('div', { className: 'dsg-msg' }, t('loadFail') + ' ',
            h('button', { className: 'dsg-btn', style: { display: 'inline-block', marginLeft: 8 }, onClick: load }, t('retry'))))
      }
      if (!catalog) {
        return h('div', { className: 'dsg-wrap' },
          h('div', { className: 'dsg-msg' }, t('loading')))
      }

      const head = h('div', { className: 'dsg-head' },
        h('div', { className: 'dsg-title' }, t('nav')),
        h('div', { className: 'dsg-sub' }, t('subtitle')),
      )

      const tabs = h('div', { className: 'dsg-tabs' },
        h('button', {
          className: 'dsg-tab' + (tab === 'styles' ? ' on' : ''),
          onClick: () => { setTab('styles'); setQ('') },
        }, t('tabStyles'), h('span', { className: 'n' }, String(styles.length))),
        h('button', {
          className: 'dsg-tab' + (tab === 'layouts' ? ' on' : ''),
          onClick: () => { setTab('layouts'); setQ('') },
        }, t('tabLayouts'), h('span', { className: 'n' }, String(layouts.length))),
        h('button', {
          className: 'dsg-tab' + (tab === 'sheets' ? ' on' : ''),
          onClick: () => { setTab('sheets'); setQ('') },
        }, t('tabSheets'), h('span', { className: 'n' }, String(sheets.length))),
      )

      const bar = tab === 'sheets' ? null : h('div', { className: 'dsg-bar' },
        h('input', {
          className: 'dsg-input',
          value: q,
          placeholder: tab === 'styles' ? t('searchPh') : t('layoutSearchPh'),
          onChange: (e) => setQ(e.target.value),
        }),
      )

      const styleTab = () => {
        const groupChips = h('div', { className: 'dsg-chips' },
          h('button', {
            className: 'dsg-chip' + (group === 'all' ? ' on' : ''),
            onClick: () => setGroup('all'),
          }, t('allGroups'), h('span', { className: 'n' }, String(styles.length))),
          groups.map((g) =>
            h('button', {
              key: g.id,
              className: 'dsg-chip' + (group === g.id ? ' on' : ''),
              onClick: () => setGroup(g.id),
              title: g.id + ' · ' + (g.label_en || ''),
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
                    title: [c.name_en, c.hex, c.category_zh, c.quote_zh].filter(Boolean).join('　'),
                    style: chipSwatch(c.hex),
                  }, c.name_zh || c.id),
                ),
              ),
            )
          : null

        const grid = filteredStyles.length === 0
          ? h('div', { className: 'dsg-msg' }, t('empty'))
          : h('div', { className: 'dsg-grid' },
              filteredStyles.map((s) => {
                const act = resolveActivation(catalog, s)
                return h('div', { className: 'dsg-card', key: s.number },
                  h('div', {
                    className: 'dsg-thumb',
                    onClick: () => openModal('style', s.number),
                    title: t('detail'),
                  },
                    h('img', {
                      src: API + '/preview/styles/' + s.number + '.webp',
                      alt: s.name,
                      loading: 'lazy',
                      onError: (e) => { e.target.style.visibility = 'hidden' },
                    }),
                    h('span', { className: 'dsg-badge' }, legacyOf(s)),
                    act.useReference
                      ? h('span', { className: 'dsg-ref', title: t('refNote') }, t('activationRef'))
                      : null,
                  ),
                  h('div', { className: 'dsg-meta' },
                    h('div', { className: 'dsg-name', title: s.name }, s.name),
                    h('div', { className: 'dsg-traits', title: s.traits }, (s.traits || '').slice(0, 42)),
                  ),
                  h('div', { className: 'dsg-acts' },
                    h('button', {
                      className: 'dsg-btn grow' + (copiedKey === s.number ? ' ok' : ''),
                      onClick: () => { copyText(promptFor(s, null)); flashCopied(s.number) },
                    }, copiedKey === s.number ? t('copied') : t('copy')),
                    h('button', {
                      className: 'dsg-btn pri grow',
                      onClick: () => send(promptFor(s, null), s.number),
                    }, sentLabel(s.number)),
                  ),
                )
              }),
            )

        return h(React.Fragment, null, groupChips, colorChips,
          h('div', { className: 'dsg-sub' },
            String(filteredStyles.length) + ' / ' + String(styles.length) + ' ' + t('countUnit')),
          grid)
      }

      const layoutTab = () => {
        const catChips = h('div', { className: 'dsg-chips' },
          h('button', {
            className: 'dsg-chip' + (layoutCat === 'all' ? ' on' : ''),
            onClick: () => setLayoutCat('all'),
          }, t('allGroups'), h('span', { className: 'n' }, String(layouts.length))),
          layoutCats.map((c) =>
            h('button', {
              key: c.id,
              className: 'dsg-chip' + (layoutCat === c.id ? ' on' : ''),
              onClick: () => setLayoutCat(c.id),
              title: c.prefix + ' · ' + (c.label_en || ''),
            }, c.label_zh || c.id, h('span', { className: 'n' }, String(c.count))),
          ),
        )

        const grid = filteredLayouts.length === 0
          ? h('div', { className: 'dsg-msg' }, t('emptyLayout'))
          : h('div', { className: 'dsg-grid' },
              filteredLayouts.map((x) => h('div', { className: 'dsg-card', key: x.id },
                h('div', {
                  className: 'dsg-thumb',
                  onClick: () => openModal('layout', x.id),
                  title: t('layoutDetail'),
                },
                  h('img', {
                    src: API + '/preview/layouts/' + x.id + '.webp',
                    alt: x.name,
                    loading: 'lazy',
                    onError: (e) => { e.target.style.visibility = 'hidden' },
                  }),
                  h('span', { className: 'dsg-badge' }, x.id),
                ),
                h('div', { className: 'dsg-meta' },
                  h('div', { className: 'dsg-name', title: x.name }, x.name),
                  h('div', { className: 'dsg-traits', title: (x.keywords || []).join('、') },
                    (x.keywords || []).join('、') || x.name_en || ''),
                ),
                h('div', { className: 'dsg-acts' },
                  h('button', {
                    className: 'dsg-btn pri grow',
                    onClick: () => openModal('layout', x.id),
                  }, t('layoutDetail')),
                ),
              )),
            )

        return h(React.Fragment, null, catChips,
          h('div', { className: 'dsg-sub' },
            String(filteredLayouts.length) + ' / ' + String(layouts.length) + ' ' + t('countLayoutUnit')),
          grid)
      }

      /**
       * The library's contact sheets: 23 images covering legacy 001-327 in
       * chunks. They are a second way into the same 327 styles — ordered by
       * number rather than by theme — and they are what STYLES.md illustrates
       * its A-H 图鉴 sections with.
       */
      const sheetsTab = () => h(React.Fragment, null,
        h('div', { className: 'dsg-note' }, t('sheetHint')),
        h('div', { className: 'dsg-sub' },
          String(sheets.length) + ' ' + t('sheetUnit')),
        h('div', { className: 'dsg-grid' },
          sheets.map((sh) => h('div', { className: 'dsg-card', key: sh.file },
            h('div', {
              className: 'dsg-thumb',
              onClick: () => openModal('sheet', sh.file),
              title: t('detail'),
            },
              h('img', {
                src: API + '/preview/groups/' + sh.file,
                alt: sh.letter + ' ' + sh.from + '-' + sh.to,
                loading: 'lazy',
              }),
              h('span', { className: 'dsg-badge' },
                sh.letter + ' · ' + String(sh.from).padStart(3, '0') + '–' + String(sh.to).padStart(3, '0')),
            ),
            h('div', { className: 'dsg-meta' },
              h('div', { className: 'dsg-name', title: sh.section }, sh.section || sh.file),
              h('div', { className: 'dsg-traits' },
                '#' + String(sh.from).padStart(3, '0') + ' – #' + String(sh.to).padStart(3, '0')),
            ),
          )),
        ),
      )

      /* ------------------------------ modal ------------------------------ */

      const langToggle = h('div', { className: 'dsg-seg' },
        h('button', { className: lang === 'zh' ? 'on' : '', onClick: () => setLang('zh') }, '中文'),
        h('button', { className: lang === 'en' ? 'on' : '', onClick: () => setLang('en') }, 'EN'),
      )

      const modal = (() => {
        if (!openStyle && !openLayout && !openSheet) return null

        const close = () => setOpen(null)

        if (openSheet) {
          const sh = openSheet
          return h('div', { className: 'dsg-mask', onClick: (e) => { if (e.target === e.currentTarget) close() } },
            h('div', { className: 'dsg-modal' },
              h('div', { className: 'dsg-mhead' },
                h('div', { className: 'dsg-mtitle' },
                  sh.letter + ' · #' + String(sh.from).padStart(3, '0') + '–#' + String(sh.to).padStart(3, '0') +
                  (sh.section ? ' · ' + sh.section : '')),
                h('button', { className: 'dsg-x', onClick: close, title: t('close') }, '\u00d7'),
              ),
              h('div', { className: 'dsg-mbody' },
                h('img', { className: 'dsg-mimg', src: API + '/preview/groups/' + sh.file, alt: sh.file }),
              ),
            ),
          )
        }

        if (openLayout) {
          const layout = openLayout
          const picked = pickedStyle ? styleById[pickedStyle] : null
          const prompt = picked
            ? stylePrompt(picked, themeText, selectedColor, { catalog, lang, layout })
            : layoutPrompt(layout, themeText, lang)
          const graphic = layout.category !== 'ecommerce'

          return h('div', { className: 'dsg-mask', onClick: (e) => { if (e.target === e.currentTarget) close() } },
            h('div', { className: 'dsg-modal' },
              h('div', { className: 'dsg-mhead' },
                h('div', { className: 'dsg-mtitle' }, layout.id + ' · ' + layout.name),
                langToggle,
                h('button', { className: 'dsg-x', onClick: close, title: t('close') }, '\u00d7'),
              ),
              h('div', { className: 'dsg-mbody' },
                h('img', { className: 'dsg-mimg', src: API + '/preview/layouts/' + layout.id + '.webp', alt: layout.name }),
                h('div', { className: 'dsg-note' }, graphic ? t('graphicMode') : t('ecommerceMode')),
                (layout.keywords || []).length > 0
                  ? h('div', { className: 'dsg-field' },
                      h('span', { className: 'dsg-lab' }, t('keywords')),
                      h('div', { className: 'dsg-kws' },
                        layout.keywords.map((k) => h('span', { className: 'dsg-kw', key: k }, k))))
                  : null,
                h('div', { className: 'dsg-field' },
                  h('span', { className: 'dsg-lab' }, t('pickStyle') + '（' + t('noLayout') + '）'),
                  h(Picker, {
                    items: styles.map((s) => ({ id: s.number, label: s.name })),
                    value: pickedStyle,
                    haystack: (it) => {
                      const s = styleById[it.id]
                      return s ? styleHay(s) : ''
                    },
                    placeholder: t('searchPh'),
                    emptyText: t('empty'),
                    onPick: (id) => setPickedStyle(id === pickedStyle ? '' : id),
                  }),
                ),
                h('div', { className: 'dsg-field' },
                  h('span', { className: 'dsg-lab' }, t('themePh')),
                  h('textarea', {
                    className: 'dsg-theme',
                    rows: 4,
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
                  className: 'dsg-btn pri grow',
                  onClick: () => { copyText(prompt); flashCopied('modal') },
                }, copiedKey === 'modal' ? t('copied') : t('copy')),
                h('button', {
                  className: 'dsg-btn grow',
                  onClick: () => send(prompt, 'modal'),
                }, sentLabel('modal')),
              ),
            ),
          )
        }

        const style = openStyle
        const act = resolveActivation(catalog, style)
        const layout = pickedLayout ? layoutById[pickedLayout] : null
        const prompt = stylePrompt(style, themeText, selectedColor, { catalog, lang, layout })
        const refSrc = API + '/preview/styles/' + referenceFile(style)
        const refPath = joinPath(catalog.assetsPath, 'styles', referenceFile(style))

        const activationLabel = act.source === 'name+style'
          ? t('activationName')
          : act.source === 'name+style+traits'
            ? t('activationTraits')
            : t('activationRef')

        return h('div', { className: 'dsg-mask', onClick: (e) => { if (e.target === e.currentTarget) close() } },
          h('div', { className: 'dsg-modal' },
            h('div', { className: 'dsg-mhead' },
              h('div', { className: 'dsg-mtitle' }, style.number + ' · ' + legacyOf(style) + ' · ' + style.name),
              langToggle,
              h('button', { className: 'dsg-x', onClick: close, title: t('close') }, '\u00d7'),
            ),
            h('div', { className: 'dsg-mbody' },
              h('img', { className: 'dsg-mimg', src: API + '/preview/styles/' + style.number + '.webp', alt: style.name }),
              h('div', { className: 'dsg-field' },
                h('div', { className: 'dsg-labrow' },
                  h('span', { className: 'dsg-lab' }, t('traits')),
                  h('span', { className: 'dsg-sub' }, t('activation') + '：' + activationLabel),
                ),
                h('span', { className: 'dsg-kv' }, act.traits || style.traits || '—'),
              ),
              style.reference && style.reference !== style.name
                ? h('div', { className: 'dsg-field' },
                    h('span', { className: 'dsg-lab' }, t('refBy')),
                    h('span', { className: 'dsg-kv' }, style.reference))
                : null,
              // The reference sheet has to be handed to the image model along
              // with the prompt, so show it and make the path copyable.
              act.useReference
                ? h('div', { className: 'dsg-field' },
                    h('span', { className: 'dsg-lab' }, t('refPath')),
                    h('img', { className: 'dsg-mimg', src: refSrc, alt: style.name + ' reference', loading: 'lazy' }),
                    h('div', { className: 'dsg-note warn' }, t('refNote')),
                    h('div', { className: 'dsg-bar' },
                      h('span', { className: 'dsg-sub', style: { flex: '1 1 200px', wordBreak: 'break-all' } }, refPath),
                      h('button', {
                        className: 'dsg-btn sm',
                        onClick: () => { copyText(refPath); flashCopied('ref') },
                      }, copiedKey === 'ref' ? t('copied') : t('copyPath')),
                    ),
                  )
                : null,
              h('div', { className: 'dsg-field' },
                h('span', { className: 'dsg-lab' }, t('layout')),
                h(Picker, {
                  items: layouts.map((x) => ({ id: x.id, label: x.name })),
                  value: pickedLayout,
                  haystack: (it) => {
                    const x = layoutById[it.id]
                    return x ? layoutHay(x) : ''
                  },
                  placeholder: t('layoutSearchPh'),
                  emptyText: t('emptyLayout'),
                  onPick: (id) => setPickedLayout(id === pickedLayout ? '' : id),
                }),
              ),
              h('div', { className: 'dsg-field' },
                h('span', { className: 'dsg-lab' }, t('themePh')),
                h('textarea', {
                  className: 'dsg-theme',
                  rows: 4,
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
                className: 'dsg-btn pri grow',
                onClick: () => { copyText(prompt); flashCopied('modal') },
              }, copiedKey === 'modal' ? t('copied') : t('copy')),
              h('button', {
                className: 'dsg-btn grow',
                onClick: () => send(prompt, 'modal'),
              }, sentLabel('modal')),
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
        head, tabs, bar,
        tab === 'styles' ? styleTab() : tab === 'layouts' ? layoutTab() : sheetsTab(),
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

      // This slot is session-scoped, so it is the one place the framework hands
      // us `inputActions`. Publish that action face on `window` while mounted —
      // the gallery lives in a root-scoped settings section and would otherwise
      // have no way to fill the composer draft. A ref keeps the bridge reading
      // the latest actions without re-running the effect on every render.
      const actionsRef = React.useRef(actions)
      actionsRef.current = actions
      React.useEffect(() => {
        const bridge = (text) => {
          const a = actionsRef.current
          if (!a || typeof a.setDraft !== 'function') return false
          try { a.setDraft(text) } catch { return false }
          return true
        }
        const prev = window.__DSG_INSERT__
        window.__DSG_INSERT__ = bridge
        return () => {
          // Only retract our own bridge — a remount may already have replaced it.
          if (window.__DSG_INSERT__ === bridge) window.__DSG_INSERT__ = prev
        }
      }, [])

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
          ? all.filter((s) => [s.number, s.legacy, s.name, s.reference, s.traits]
              .filter(Boolean).join(' ').toLowerCase().indexOf(n) !== -1)
          : all
        return list.slice(0, 120)
      }, [catalog, q])

      /**
       * Fill the composer draft; fall back to the clipboard when we cannot.
       *
       * Deliberately uses our own `actions` rather than `insertDraft`: this
       * launcher *is* the bridge's publisher, so routing through `window` would
       * only work once our own effect had run.
       */
      const use = (style) => {
        const text = stylePrompt(style, '', null, { catalog, lang: 'zh' })
        let wrote = false
        try {
          if (actions && typeof actions.setDraft === 'function') {
            actions.setDraft(text)
            wrote = true
          }
        } catch { /* fall back to the clipboard */ }
        if (!wrote) copyText(text)
        setDone(wrote ? style.number : style.number + CLIP_SUFFIX)
        setOpen(false)
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
                h('img', { className: 'dsg-pop-thumb', src: API + '/preview/styles/' + s.number + '.webp', alt: s.name, loading: 'lazy' }),
                h('span', { className: 'dsg-pop-name' }, legacyOf(s) + ' ' + s.name),
              )),
            ),
      )

      return h('div', { className: 'dsg-anchor' },
        h('button', {
          className: 'dsg-launch' + (open || done ? ' on' : ''),
          onClick: () => setOpen((v) => !v),
          title: t('subtitle'),
        }, done ? (done.indexOf(CLIP_SUFFIX) !== -1 ? t('sentClip') : t('created')) : t('nav')),
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

    return {
      name: 'dsh-style-gallery',
      inject: ['slots', 'locale'],
      apply,
      // Exposed for the dev harness only. The prompt contract is the part of
      // this plugin most worth asserting, and these are pure functions, so
      // there is no reason to hide them behind a render.
      __internals: { stylePrompt, layoutPrompt, filterTraits, resolveActivation, referenceFile, insertDraft },
    }  },
})
