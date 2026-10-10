# dsh-style-gallery · 手绘风格图库

一个 **DeepSeek Harness（dsh）** 扩展：把 288 种手绘风格变成**看得见、点得着**的图库 ——
看图选风格，一键把提示词复制走，或直接填进输入框。

---

## 它解决什么问题

`handraw-style` 风格库有 **288 种手绘风格**，每种只有一个编号和名字。
纯靠文字来指定风格，**只有已经熟悉这套库的人用得了** —— 你没法"看"到 `FA-014` 长什么样，
也就没法准确说出你想要哪一种。

这个扩展在 dsh 里加了一个**带真实预览图的风格库**：

- **288 种风格**，每格显示它自己的示例图 + 编号 + 名字 + 特征；
- 按 **8 个流派** 和 **36 个主题色** 筛选；
- 搜索支持**名字 / 编号 / 作者 / 特征关键词**；
- **一键复制提示词**，或**拿去创作**直接写进输入框草稿。

## 在哪里看到它

装好后，dsh 里会出现两个入口：

| 位置 | 你看到什么 | 怎么用 |
| --- | --- | --- |
| **设置 → 风格图库** | 完整的 288 格图库，带流派 / 主题色筛选 | 逛、搜、点开看大图、复制提示词 |
| **输入框工具行左侧**「风格图库」按钮 | 弹出的轻量风格选择面板 | 点一个风格 → 提示词直接进草稿，改改就能发 |

---

## 安装

有两种方式。**桌面版只能用第一种** —— 它的 profile 由应用独占管理，命令行会被直接拒绝：

```
$ dsh plugin --profile desktop add ...
error: profile "desktop" is managed exclusively by the Electron application
```

---

### 方式一：从 DSH 界面安装（推荐）

**先注意一件事：DSH 不接受 `.zip`。** 它认的安装来源只有四种：

| 来源 | 写法 |
| --- | --- |
| 注册表包名 | `some-pkg` 或 `some-pkg@1.2.3` |
| Git 地址 | `github:owner/repo`、`https://github.com/owner/repo.git` |
| 压缩包 | `*.tgz` / `*.tar.gz` 的**绝对路径** |
| 本地目录 | 指向插件目录的**绝对路径** |

所以 zip 要先转成 tgz：

```bash
cd dsh-style-gallery
npm pack --pack-destination ..
# → dsh-style-gallery-1.0.0.tgz（9.9MB / 295 个文件）
```

然后在 DSH 里：

1. 侧边栏 → **插件**
2. 点 **添加插件**
3. 粘贴 tgz 的**绝对路径**，例如 `C:\Users\you\dsh-style-gallery-1.0.0.tgz`
   （必须是绝对路径 —— 相对路径会被拒，因为 Host 的工作目录对你不透明）
4. 点 **安装**，装完点 **立即启用**
5. **完全退出 DSH 再打开**

> 安装前 DSH 会先读一遍 spec 指向什么，并检查两件事：它是个包、且**声明了组合包 patch**
> （即 `package.json` 的 `dsh.bundle.patch`）。没有这一项会被拒为 `not-a-bundle`。
> 本插件已声明，且**没有 `scripts`**，所以不会触发「依赖构建脚本」审批。

> **升级要卸载后重装** —— DSH 不支持覆盖升级。旧版还在的话，先在插件页把它卸载。

---

### 方式二：手动放进 profile（任意版本通用）

#### 第一步：找到你的 dsh profile 目录

**这一步最容易错，请务必确认。** dsh 有好几种运行方式，profile 目录**各不相同**：

| 你用的是 | profile 目录通常在 |
| --- | --- |
| **官方 DeepSeek Harness 桌面版** | `~/.dsh/profiles/desktop/` |
| `dsh` 命令行版 | `~/.dsh/profiles/<profile>/`（常见叫 `web`） |
| 其他桌面发行版 | 见该发行版文档 |

**怎么确认是哪个？** 最可靠的办法 —— 启动一次 dsh，然后看哪个 profile 目录刚被写过：

```bash
ls -lat ~/.dsh/profiles/
```

**最近被创建或修改的那个，就是你在用的那个。**

#### 第二步：把插件放进 profile

**① 拷贝插件本体**

```bash
cp -r dsh-style-gallery <你的-profile-目录>/node_modules/
```

**② 登记到 profile 的 `package.json`**

编辑 `<你的-profile-目录>/package.json`，加上依赖和 bundle（保留原有的其它条目）：

```json
{
  "dependencies": {
    "dsh-style-gallery": "file:./node_modules/dsh-style-gallery"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-style-gallery"
      ]
    }
  }
}
```

> `bundles` 的顺序就是补丁的应用顺序，**把 `dsh-style-gallery` 放在 `dsh-web-app` 之后**。
> 改之前建议先备份 `package.json`。

#### 第三步：重启 dsh

**必须完全退出再打开**：

- 桌面版：到**系统托盘**右键退出，或用任务管理器结束**所有** `DeepSeek Harness` / `DSH` 进程。
- 只点窗口右上角的 ✕ **不算退出** —— Electron 应用常常只是把窗口藏起来，插件不会被重新加载。

判断有没有真的重启成功：看有没有生成**新时间戳**的启动日志。

---

## 提示词的生成规则

提示词由风格自身的数据拼出来，遵循原风格库的硬规则：

```
请用【Playful Deadpan Doodle】的手绘插画风格创作一张图。
风格要点：松散黑线、怪萌人物、少量点色。
视觉参考方向：Gemma Correll。
主题色：克莱因蓝（Klein Blue）。      ← 选了才加
画面主题：<你填的>。                  ← 填了才加
要求：单幅插画，构图完整，风格统一，不要出现任何文字、编号或水印。
```

> **风格编号（如 `FA-001`）只用于界面索引，绝不写进提示词正文** ——
> 编号进入提示词会污染出图结果。这一条有专门的测试守着。

---

## 结构

```
dsh-style-gallery/
├── package.json          # dsh.bundle.patch + dsh.client.inject 声明
├── cordis.patch.yml      # 把插件插进 profile 的 layer stack
├── lib/index.js          # 宿主半区：HTTP 路由，供目录与预览图
├── client.js             # 浏览器半区：两个 React 界面（无 JSX / TS）
├── data/catalog.json     # 288 风格 + 36 主题色 + 8 流派（58KB）
├── assets/               # 288 张预览图（webp，约 11MB）
├── LICENSE               # MIT + 上游署名条款
├── README.md
└── dev/                  # 开发与验证用，不属于运行时（可不发布）
    ├── test-*.cjs        # 7 套测试
    ├── preview-server.mjs
    ├── build_workbuddy_html.py   # 导出单文件 HTML
    ├── measure_sizes.py          # 实测压缩参数下的体积
    └── pack.py                   # 打发布 zip
```

### 主题色为什么带 `hex`

`catalog.json` 里每个主题色是 `{id, name_zh, name_en, hex}`。**`hex` 是我们自己补的**
（上游只给了名字），用来把主题色按钮直接画成那个颜色：

```
{"id":"C-01","name_zh":"克莱因蓝","name_en":"Klein Blue","hex":"#002FA7"}
```

- **想改某个颜色，只改这里。** dsh 插件和单文件 HTML 都从这一处读，没有第二份色板。
- 按钮上的文字颜色由 **WCAG 相对亮度**自动选黑或白（不是固定阈值 ——
  暖灰 `#ACA39A` 用白字只有 2.5:1，用黑字有 8.4:1）。
  黑/白二选一的最坏情况恰好落在 4.58:1，稳过 AA 的 4.5:1。
- **选中的主题色不影响筛选结果**，只往生成的提示词里加一行「主题色：xxx」。
  理由见下面「已知限制」。

### 发布打包

两种产物，内容相同，用途不同：

```bash
python dev/pack.py                 # → ../dsh-style-gallery-1.0.0.zip   给人手动拷贝
npm pack --pack-destination ..     # → ../dsh-style-gallery-1.0.0.tgz   给 DSH 界面安装
```

**zip 是给人看的，tgz 是给 DSH 装的** —— DSH 的插件页只接受 `.tgz` / `.tar.gz`，
zip 递进去会被判为无效 spec。两者都是 295 个文件，`npm pack` 与 `dev/pack.py`
都按 `package.json` 的 `files` 白名单收口，`dev/` 与 `node_modules/` 一律不进包，
并且会拦掉 `.bak-*` 这类就地生成的备份残渣 —— 少图/多文件这类回归肉眼看不出来。

### 为什么分两个半区

dsh 插件的**浏览器半区能 `require` 的东西被严格限制**（只有 `react`、`react/jsx-runtime`
和少数几个官方客户端包），**不能打包图片**。所以图片走宿主半区的 HTTP 路由按需取：

- `GET /dsh-style-gallery/catalog.json` — 目录数据
- `GET /dsh-style-gallery/preview/<FA-014>.webp` — 单张预览图

路由对路径做了**白名单校验**（`^[A-Z]{2}-\d{3}$` + 扩展名白名单 + 目录逃逸检查），
任何 `../` 或编码变体都会在碰文件系统前被拒。

---

## 安全

- **不联网**：图片和数据全部来自本插件自己的 `data/` 与 `assets/`。
- **不写盘**：只读自己的目录。
- **路径穿越防护**：已针对 `../`、URL 编码、混合编码、空字节等变体实测拒绝。
- **无凭据访问**：不读取、不外传任何环境变量或密钥。

---

## 开发与验证

测试都在 `dev/` 下。`test-render` 需要 `react` / `react-dom`（开发依赖）：

```bash
npm install react@18 react-dom@18 --no-audit --no-fund
```

跑全部测试：

```bash
cd dev
node test-client.cjs && node test-render.cjs && node test-launcher.cjs && node test-host.e2e.cjs
```

两套浏览器测试需要先起预览服务：

```bash
node dev/preview-server.mjs          # 默认 http://127.0.0.1:3088/
# 另开一个终端：
cd dev && DSG_URL=http://127.0.0.1:3088/ node test-browser.cjs
cd dev && DSG_URL=http://127.0.0.1:3088/ node test-launcher-browser.cjs
```

| 测试 | 验什么 | 项数 |
| --- | --- | --- |
| `test-client.cjs` | 模块契约、两个插槽注册、目录完整性、**色板 hex**、**界面署名** | 26 |
| `test-render.cjs` | 用**真实 React** 服务端渲染出 HTML | 16 |
| `test-launcher.cjs` | 启动器确实调用 `inputActions.setDraft` | 12 |
| `test-host.e2e.cjs` | 起真 HTTP 服务，288 张图全可访问 + 穿越防护全拒 | 24 |
| `test-browser.cjs` | **真实无头 Chromium**：288 格渲染、图片实际占位、搜索可用、**主题色块**、零报错 | 18 |
| `test-launcher-browser.cjs` | 浏览器里点风格 → 提示词真的进了草稿 | 8 |
| `test-workbuddy-html.cjs` | 单文件 HTML 导出：288 图内嵌可渲染、搜索/分组可用、**主题色不误筛** | 35 |

**合计 139 项。**

### 本地预览（不用装进 dsh 就能看）

`dev/preview-server.mjs` 起一个独立页面，里面跑的就是 **dsh 将要加载的同一个 `client.js`**，
数据走同一个宿主路由：

```bash
node dev/preview-server.mjs          # → http://127.0.0.1:3088/
```

### 导出成单文件 HTML（给不支持插件的客户端用）

不是所有客户端都能装 cordis 插件（例如 WorkBuddy AI 就没有 UI 组件扩展点）。
这种情况下可以把整个图库**打包成一个自包含 HTML**：288 张预览图全部内嵌成
`data:` URI，零外链，单文件双击就能看，也能丢进任何只托管单个 HTML 的预览面板。

**产物落在 WorkBuddy 的技能目录里**（那是唯一的家，别在别处再放一份）：

```bash
python dev/build_workbuddy_html.py . \
  "C:/Users/19980/.workbuddy-ai/skills/handraw-gallery/风格图库.html" 80 512
#                                     ↑输出              ↑webp质量 ↑长边封顶
```

装好之后在 WorkBuddy 里说一句「**打开风格图库**」就能调出来
（技能 `handraw-gallery` 负责这件事）。

实测（288 张）：`512/q80` ≈ **7.5MB**。想更小就压长边，`384/q80` ≈ 6.2MB。

```bash
python dev/measure_sizes.py .        # 换参数前先量一遍，别凭感觉
node   dev/test-workbuddy-html.cjs   # 无头 Chrome 跑 35 项断言
```

这个导出里有个容易踩的坑：**主题色不是风格的属性**。`catalog.json` 的
`styles[i]` 只有 `{number, group, name, reference, alias_zh, traits}`，**没有 `color`**。
主题色是用户自由选的「配色参数」，只影响生成的提示词。所以它**不能参与筛选** ——
按 `s.color` 过滤会让每种颜色都筛出 0 条。`test-workbuddy-html.cjs` 里有一条
断言专门守着这个（选完颜色后卡片数必须仍是 288）。

---

## 数据来源与授权

风格数据与预览图来自 **[yang0/handraw-style](https://github.com/yang0/handraw-style)**，
授权为 **MIT（附署名条款）**。

该条款要求：**在使用方项目的文档、仓库、产品说明或用户界面中，保留并明确展示
对原作者（yang0）与原仓库链接的署名。**

本扩展已据此在**界面底部**、`LICENSE` 和本文件中给出署名。
**如果你二次分发或基于此开发，请同样保留署名。**

本扩展只做**可视化呈现**，不主张对任何风格资产的著作权。

## 已知限制

- **设置区的「拿去创作」按钮只复制提示词**，不直接写入输入框。因为设置区是
  root 作用域插槽，拿不到 session 作用域的输入机 —— 这是 dsh 的插槽作用域约束，
  不是 bug。要"直接填入"请用**输入框旁边那个启动器**。
- 预览图取自原库的 `individual/` 目录，与原图一致，**未做二次压缩**。
- **主题色是「配色参数」，不是风格的属性**，所以它**不参与筛选**，只往提示词里
  加一行「主题色：xxx」。`catalog.json` 的 `styles[i]` 里根本没有 `color` 字段 ——
  如果拿它去过滤，每种颜色都会筛出 0 条。这是设计如此，不是缺功能。

## 跑浏览器测试时的坑

`test-browser.cjs` / `test-launcher-browser.cjs` 需要一个**活着的**预览服务。
如果服务和测试不在同一个 shell 会话里，服务会随上一个 shell 退出而消失，
测试就会以「**0 卡片**」失败 —— 看起来像插件坏了，其实是页面根本没加载。
**判据**：截图字节数恒定在 21771 左右，且 `console errors` 为空。

```bash
# ✅ 服务和测试放同一条命令里
node dev/preview-server.mjs & SRV=$!
sleep 3
cd dev && DSG_URL=http://127.0.0.1:3088/ node test-browser.cjs
kill $SRV
```
