# 演示下一镜（计划中，尚未录制）

> 状态：**只对齐脚本与录制规格**。不要替换 `opensider.mp4`，不要按本文件去改 UI。仓库里现成的片子仍是上一镜（Linear → 本地 HTML 报告 → Finder）。
>
> 上一镜失败原因：① 故事停在「读页 → 写 HTML → Finder」，看不出跨页用浏览器；② 录成了拖出去的独立窗口，不像 Chrome **Side Panel**。

片中口播 / UI / Agent 回复一律 **英文**。本文件给录制的人看，所以规格用中文。

---

## Primary：Wikipedia → Open Library 检索

**标题：** Cross-page: Wikipedia facts → Open Library search

**一句话：** 在 Ada Lovelace 的英文维基上读出结构化事实，再 **新开标签** 到 Open Library，把检索框填成可提交状态并搜出结果。

**为什么能证明「浏览器扩展 + 跨页 Agent」：**

- 画面始终是 **一个** Chrome 窗口：标签栏 + 地址栏 + 网页 + **右侧停靠侧栏**（不是 popup、不是拖出去的 App 窗）。
- Agent 用现有页面工具读 **源站 A**，再用 `openTab` 打开 **另一源站 B**（`en.wikipedia.org` → `openlibrary.org`），在 B 上 `fill` / `fillForm` / `press`。
- 观众能看见 **第二条标签出现**、地址栏换成 Open Library、页面上的 **Agent 光标** 滑到检索框并填字。不是写本地 HTML，也不进 Finder。

### 现有能力（脚本只使用这些）

读：`getReadable` / `getInteractive` / `getMeta` / `getOutline` / 工作区 `snapshot.md` / `interactive.md` / `current.json` / `tabs.json`。

做：`openTab`（新开 http(s)，不覆盖当前页）、`switchTab`、`fill` / `type` / `fillForm`、`click`、`press`（Enter）、`waitFor`、`scrollIntoView`。必要时 `screenshot` 核对布局。

不要依赖：本机写报告、`reportArtifacts`、Finder、`runScript` 批量（单框检索不需要）、登录后的站点。

### 精确 URL

| 角色 | URL |
|---|---|
| 页 A（开录前用户停在这里） | `https://en.wikipedia.org/wiki/Ada_Lovelace` |
| 页 B（Agent `openTab`，禁止用户先打开） | `https://openlibrary.org/` |

### 精确用户 Prompt（原样打进侧栏，英文）

```
Read this Wikipedia article with page tools. Extract her full name, birth and death years, and one sentence on why she is often called the first computer programmer.

Then open https://openlibrary.org/ in a NEW browser tab with openTab. Do not replace this Wikipedia tab with navigate.

On Open Library, fill the main catalog search with exactly: Ada Lovelace Analytical Engine
Then press Enter or click Search so results appear.

Do not write local HTML, Markdown, or PDF. Do not call reportArtifacts. Do not use the shell to open Finder. Stay in the live pages.
```

期望 Agent 从页 A 用到的事实（供核对，不必在侧栏念全文）：

- 全名：Augusta Ada King, Countess of Lovelace（Ada Lovelace）
- 生卒：1815–1852（10 December 1815 – 27 November 1852）
- 一句：Notes on Babbage’s Analytical Engine / 常被视为第一位程序员

### 镜头表（成片时钟；括号内是剪辑倍率）

成片目标 **≤30s**；Agent 空等太长可 **≤45s**，只对等待/流式跳切。用户打字、点发送、标签出现、光标填框必须 **1x**。

| 成片 | 谁 | 倍率 | 观众必须看见 |
|---|---|---|---|
| 0:00–0:02 | — | 1x | 建立镜头：Chrome **1920×1080**，右侧 Side Panel ≈480px，深色英文 UI，**New chat** 空会话，页 A 维基正文 + 侧栏 logo/空态。标签栏、地址栏都在画面里。鼠标可见。 |
| 0:02–0:11 | 用户 | 1x | 点击输入框，键入上面整段 prompt（可事先复制；**禁止** Chrome 页内查找 Cmd+F）。不要加速打字。 |
| 0:11–0:12 | 用户 | 1x | Enter 发送。用户气泡出现，输入框四色进行中描边。 |
| 0:12–0:20 | Agent | 3x–6x | 侧栏灰字工具：读 `snapshot` / `getReadable` / `interactive.md`。**主区仍是维基**，不要切走。可跳切掉空转。 |
| 0:20–0:24 | Agent | 1x（标签出现的那几帧） | `openTab`：标签栏 **多出** Open Library；地址栏变为 `openlibrary.org`。若 Agent 误用 `navigate` 把维基覆盖掉：本条作废，重来。 |
| 0:24–0:34 | Agent | 填框/点击 1x；中间等待 2x–6x | 页上 Agent 光标滑到检索框，`fill`/`fillForm` 出现 `Ada Lovelace Analytical Engine`，Enter 或点 Search。结果列表出现。 |
| 0:34–0:38 | Agent | 1x 定住 | 双标签仍在；侧栏可有一句英文确认。**不要** 打开产物条、不要切出浏览器。 |

原始素材会更长：只加速「思考 / 读文件 / 等 results.json」；**不要**加速用户击键和 `openTab` 那一下。

BGM：`MUSIC.md` 那条合成床，成片 **1x**，头尾淡入淡出 0.4–0.5s，不跟 setpts 升调。

---

## Backup：Wikipedia → DuckDuckGo

Open Library 慢、挂了、捐款/登录墙、检索框进不了 `interactive.md` 时改用此条。页 A 与 prompt 前半相同，只换页 B 与最后两句。

| 角色 | URL |
|---|---|
| 页 A | `https://en.wikipedia.org/wiki/Ada_Lovelace` |
| 页 B | `https://duckduckgo.com/` |

Prompt 把 Open Library 段换成：

```
Then open https://duckduckgo.com/ in a NEW browser tab with openTab. Do not replace this Wikipedia tab with navigate.

On DuckDuckGo, type Ada Lovelace Analytical Engine into the search box and submit (Enter or the search button) so results appear.

Do not write local HTML, Markdown, or PDF. Do not call reportArtifacts. Do not use the shell to open Finder. Stay in the live pages.
```

DuckDuckGo 中部大搜索框在镜头里更「一眼能懂」；叙事比图书馆检索稍泛。仍是跨源、仍是填框。

（若连 DDG 也翻车：最后手段是 `https://httpbin.org/forms/post` 的 Customer name 等字段，用维基里的姓名填表。画面土，但 `fillForm` 稳。不要用 demoqa.com：广告层经常挡住 Submit。）

---

## 录制几何与 Chrome 侧栏（强制）

### 窗口

- 只用 **Mac 内建屏**（ffmpeg `Capture screen 0`）。外接屏禁止。
- Chrome 窗口 **1920×1080**。能在系统显示器里选 1920×1080 就选，然后 Chrome 铺满该逻辑分辨率（保留系统菜单栏也可以，事后中心裁 16:9）。源已经是 1920×1080 时，裁切应接近恒等。
- **不要** 把侧栏拖成独立窗口，**不要** 用 Side Panel 的「在新标签打开 / 弹出」类控件，**不要** 只录侧栏、不要裁掉标签栏和地址栏。
- 侧栏宽度拖到约窗口的 **1/4**：1920 上约 **480px**（用分隔条；不要停在 Chrome 默认偏窄）。
- 侧栏必须在 **右边**（Chrome Side Panel 可改左边：录前确认在右）。

### 扩展如何打开（避免录成 popup）

产品是 MV3 **`side_panel.default_path`**，**没有** `action.default_popup`。Service Worker 里 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`：点工具栏 OpenSider 图标 = 在 **当前浏览器窗口内** 打开侧栏。

录前自检（缺一条就停）：

1. 聊天 UI 与维基 **同一窗口**，中间有竖向分隔条。
2. 上方仍是 Chrome 标签条 + 地址栏；维基 URL 在地址栏里。
3. 扩展页 `chrome://extensions` 为 **未打包** 加载（开发 `packages/extension/dist` 或用户 `~/.opensider/extension`），不是商店包。
4. 关掉 Chrome「停用开发者模式扩展」、测试模式、翻译条、维基筹款/cookie 条。
5. 界面语言 **English**；侧栏语言 **EN**；新会话（顶栏 New chat / 空状态 logo）。
6. 权限档 **Allow all**（允许一切操作），避免权限卡打断。Agent：已登录的 **Cursor**，模型用列表里的 **Auto**（或当前默认；全片不要换模型）。
7. 系统指针可见（macOS 辅助功能不要藏光标）。禁止演示 Chrome 页内查找。

### ffmpeg（与上一镜质量规则相同）

- 采集：内建屏 `Capture screen 0` + 系统指针。
- 成片 H.264、16:9。先中心裁 16:9（源已是 1920×1080 则几乎不用裁），再必要时 scale。
- 只对 Agent 流式/等待 `setpts` **2x–6x**；用户打字、点击、导航、新标签出现保持 1x。
- 跳切只切「无变化的等待」，不要切掉 `openTab`。
- 音床见 `MUSIC.md`，BGM 1x。

---

## 风险 / 中止条件

| 现象 | 处理 |
|---|---|
| 登录墙、CAPTCHA、Cloudflare 人机 | 停。改 Backup DDG；仍不行当天不录。 |
| Agent 写 `outputs/*.html` 或出现产物条 / Finder | 停。新空会话，prompt 已禁止写文件；不要把错片剪进去。 |
| 只用 `navigate` 覆盖维基，标签栏始终一条 | 停。必须看见 **新标签**。 |
| 侧栏变成独立窗口、或画面里没有标签栏 | 停。不是 Side Panel。 |
| 维基/Open Library 弹层挡住正文或检索框 | 录前关掉；录到了就重来。 |
| Agent 提问卡 / 计划卡 | 停。确认已是 Allow all 再开新会话。 |
| 检索框没填上（SPA 未吃到 fill） | 可允许 Agent 再 `type`/`press`；超过 ~20s 墙钟仍空则改 Backup。 |

---

## 明确不做

- 不再拍「分析页面 → 写 HTML 报告 → Show in folder / Finder」。
- 不录拖出的侧栏、popup、独立 Electron 式窗口。
- 不做 iPhone 式三点卖点字幕/分镜。
- 不换中文 UI、不发中文 prompt、不用中文站点。
- 不在本轮改产品 UI（脚本用现有工具即可完成）。
- 对齐本脚本之前 **不** 覆盖 `docs/demo/opensider.mp4`。
