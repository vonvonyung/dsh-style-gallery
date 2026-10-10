# 与上游 handraw-style 的数据层对账

上游：<https://github.com/yang0/handraw-style> · 对账时的版本 **1.8.5**（commit `4eb29e2`，2026-10-07）
本插件当时的基准：**1.5.0**（`~/.workbuddy-ai/skills/handraw-style/`，2026-10-04 安装）

## 结论

上游有一层**机器可读的权威数据**，我们最初只接了其中一部分，而且接的时候截断了。

> **权威数据源不是那些 `.md`，是 `skills/handdraw-style-prompter/references/*.json`。**
> 最初建 catalog 时看的是 `styles_200_reorganized.md`，那是给人看的渲染稿。

**本轮已按「全量对齐」补齐**（见第三节）。下面第一节记录上游的数据层构成，
第二节保留补齐前的差距快照以便追溯，第三节是补齐后的实测值。

## 一、上游的数据层

`skills/handdraw-style-prompter/references/`：

| 文件 | 条数 | 字段 |
| --- | --- | --- |
| `styles.json` | 327 | `number` `group` `reference` `generation_name` `traits` |
| `layouts.json` | 165 | `id` `category` `name` `name_en` `image` `prompt_file` `keywords[]` |
| `layouts/*.md` | 165 | 每个版式的提示词正文（含 `<!-- zh -->` / `<!-- en -->` 分段） |
| `colors.json` | 36 | `id` `sheet` `category` `category_zh` `category_en` `name_zh` `name_en` `quote_zh` `quote_en` `image` `sheet_image` `prompt_zh` `prompt_en` |
| `model_capabilities.json` | 1 模型 × 190 条风格校准 | 风格名能否**单独**激活风格 |
| `style_alias_map.json` | 327 | 老编号 `001–327` ↔ 新编号 `FA-001…` |
| `attribution.json` | 14 | 作者存殁与来源链接 |
| `characters.json` / `props.json` / `scenes.json` | 1 / 0 / 0 | 自建图库 |

另有自带画廊 `gallery/{index,layouts,colors,characters,assets,tutorials}.html`（约 1MB）。

## 二、差距（补齐前的快照）

| 项目 | 上游 1.8.5 | 补齐前 | 差距 |
| --- | --- | --- | --- |
| 风格条目 | 327 | 288 | 少 39 条 |
| 风格 `traits` | 平均 64 字 / 最长 1305 | 平均 19 字 | 257 / 288 被截断 |
| 版式图型 | 165 | 0 | 整库缺失 |
| 版式提示词正文 | 165 | 0 | 整库缺失 |
| 主题色字段 | 12 | 4（`id` `name_zh` `name_en` `hex`） | 少 8 项 |
| 预览图 | 601 | 288 | 少 313 |
| `_grid.webp` 参考图 | 36 | 0 | 被删了 |
| 老编号映射 | 327 | 0 | 缺失 |
| 模型能力校准 | 7 | 0 | 缺失 |

### `traits` 截断（当时最要紧的一处）

这是提取 bug：只取前几个 `、` 段，并在第一个 `；` 处截断。完整内容一直在 `styles.json` 里。

```
FA-001
  上游(101 字)：松散黑线、怪萌人物、少量点色、白底、日常吐槽与尴尬幽默；人物轮廓优先于细节堆砌，
                脸型、头身比例与手脚形状要形成清楚而独立的视觉语言；表情偏冷脸、尴尬或突然夸张，
                姿态要有明确喜剧节奏，避免统一的可爱微笑。
  我们( 14 字)：松散黑线、怪萌人物、少量点色
```

**后果**：提示词里那句「风格要点」只描述了风格的极小一部分，出图相似度会明显下降。

## 三、补齐后的实测值

`python dev/build_catalog.py <upstream>` 的输出：

```
upstream       1.8.5
styles          327   traits: avg 64 chars, longest 1305
  grid sheets    36   (styles whose name alone may not activate the look)
  legacy ids    327   mapped from 001-327
groups            8
layouts         166   with prompt_zh: 166, unindexed upstream: ['IG-036']
layout cats       5   social-card=22, infographic=36, comic-storyboard=71, ip-character=13, ecommerce=24
colors           36   with hex: 36
group sheets     23   A:1-16, A:17-32, A:33-35, B:36-48 …
models            1 calibrated   gpt-image-2=190 styles
attribution      14 entries
```

| 项目 | 上游 1.8.5 | 本插件 | 状态 |
| --- | --- | --- | --- |
| 风格条目 | 327 | **327** | 已对齐 |
| 风格 `traits` | 平均 64 / 最长 1305 | **平均 64 / 最长 1305** | 已对齐，无截断 |
| 版式图型 | 165 | **166** | 已对齐（+1 见下） |
| 版式提示词正文 | 165 | **166** | 已对齐 |
| 主题色字段 | 12 | **12 + `hex`** | 已对齐（`hex` 是本插件自补） |
| 预览图 | 601 | **595** | 见下 |
| `_grid.webp` 参考图 | 36 | **36** | 已恢复 |
| 老编号映射 | 327 | **327** | 已对齐 |
| 模型能力校准 | 190 条 | **190 条** | 已对齐（含归一化） |

### 资源收口：595 个文件 / 50 MB

```
assets/styles        363 files   17.7 MB    327 单图 + 36 垫图
assets/layouts       166 files   23.1 MB
assets/colors         42 files    1.0 MB    36 色块 + 6 拼图
assets/groups         23 files    7.8 MB    A–H 图鉴拼图
assets/characters      1 file     0.3 MB
                     ────────────────────
                     595 files   50.0 MB
```

上游 `images/` 里另有 3 张 `layouts/` 预览拼图和 3 张 `*.webp` 的索引缩略图，
不是风格资产本身，未收进包 —— 所以是 595 而不是 601。

## 四、上游自身的三处不一致（我们做了归一化）

上游的数据层不是干净的。这三处都**没有丢弃、也没有硬编码补丁**，
而是按可推导的规律归一化，并把偏差打印在构建输出的 `DRIFT` 段里，
同时有测试守着 —— 让偏差**可见**，而不是悄悄混进去。

### 1. `IG-036` 有图有提示词，却没进 `layouts.json`

所以上游的 `layouts.json` 是 165 条，而 `layouts/` 目录里有 166 个 `.md`。

**归一化**：按**结构**（而不是字符串字面量匹配）认出这个孤儿，
再依据一条已验证的规律从提示词正文里解析标题 ——
`IG-035.md` 的 `排版：2.5D等距轴测微缩场景。` 恰好等于它 `layouts.json` 里的 `name`：

```python
TITLE_ZH = re.compile(r"^\s*排版[：:]\s*(.+?)\s*。")
TITLE_EN = re.compile(r"^\s*Layout[：:]\s*(.+?)\s*\.")
```

恢复出来的条目带 `"unindexed": true` 标记。

### 2. `model_capabilities.json` 有三个校准条目漏在 `models` 外面

上游文件结尾长这样：

```json
  "models": { "gpt-image-2": { …, "styles": { …, "FG-021": {…} } } },
  "FG-019": { "name_activation": "weak", "traits_activation": "strong" },
  "FG-020": { "name_activation": "weak", "traits_activation": "strong" },
  "FG-021": { "name_activation": "strong", "traits_activation": "none" }
```

即 `FG-019` 从未进入任何模型的 `styles` 表，而 `FG-020` / `FG-021` 各被列了两次
（嵌套一次、顶层一次，值相同）。看形状就知道它们本该是 `styles` 的兄弟节点，
是添加它们的那次编辑**多关了一层括号**。

**归一化**：`normalize_model_caps()` 把顶层这些形如 `[A-Z]{2}-\d{3}` 的键
提升进被校准模型的 `styles`；值冲突时保留嵌套的那份并**大声报警**（`CONFLICT:`），
值相同则记为无害重复一并报出。`gpt-image-2` 的校准条目因此从 189 变成 **190**。

> 这个缺陷原本是**隐形的**：`client.js` 有一条 `caps[style.number]` 的扁平兜底，
> 所以对 `gpt-image-2` 而言结果碰巧是对的。但兜底只在「模型被校准过」时才生效 ——
> 换个模型，`FG-019` 就会静默掉到 `default`（unknown → 强制走参考图），
> 白让用户多垫一张图。所以修的是 schema，顺带保住了行为。

### 3. `traits` 里混着否定从句

如 `…，避免统一的可爱微笑。`。机械照抄等于往提示词里塞负向提示。

**归一化**：按 `；` / `。` 切从句，剔除含 `避免` / `不要` / `不准` / `禁止` 的，
在 `filterTraits()` 里做（`client.js` 的 `@prompt-core` 段内）。

## 五、我们违反过的上游提示词硬规则（已全部修正）

读 `skills/handdraw-style-prompter/SKILL.md` 得出，逐条对应现在的实现：

| # | 规则 | 现在 |
| --- | --- | --- |
| 1 | **不得追加通用构图 / 质量 / 负向尾巴** | 已删除 `要求：单幅插画，构图完整，风格统一，不要出现任何文字、编号或水印。`，有测试守着 |
| 2 | **`name_activation=strong` 只给作者名 + 风格名**，严禁 traits / 参考图路径 / 隔离块 | 92 条 strong 风格走 `name+style`，不给 traits 也不给垫图 |
| 3 | **`traits` 要过滤否定从句** | `filterTraits()` |
| 4 | **`{编号}_grid.webp` 优先级最高** | 36 张垫图已恢复，`referenceFile()` 优先选它 |
| 5 | **措辞**：`风格名称：` / `核心风格特征：` / `参考作者/风格名称` | 已从自创的 `请用【…】` / `风格要点` / `视觉参考方向` 换成上游措辞 |
| 6 | **支持版式** | 166 个版式已接入，可挂在风格上；电商版式不加图文后缀 |
| 7 | **支持老编号** | 327 条映射已接入，`#041` 可搜 |

## 六、授权

上游 `LICENSE` 与我们仓库里那份**逐字节相同** —— MIT + 署名条款，本轮无变化，
现有界面署名与 LICENSE 段落继续有效。

## 七、复现这份对账

```bash
git clone --depth 1 https://github.com/yang0/handraw-style.git /c/tmp/handraw-upstream
# 权威数据在 skills/handdraw-style-prompter/references/*.json
# 注意：仓库名 handraw-style 只有一个 d，skill 目录名 handdraw-style-prompter 有两个
python dev/build_catalog.py /c/tmp/handraw-upstream --out data/catalog.json
python dev/build_assets.py  /c/tmp/handraw-upstream --out assets
```

> `git clone` 在本机偶发 `schannel: server closed abruptly`。绕法是直接下 tarball：
> `curl -L -o C:/tmp/upstream.tgz https://codeload.github.com/yang0/handraw-style/tar.gz/refs/heads/master`
> （默认分支是 `master` 不是 `main`）。
