# 演示成片与下一镜

> 状态：**已上架** [`opensider.mp4`](./opensider.mp4)（采集原分辨率 **2880×1800**，**43.8s**）：页 A Wikipedia Ada Lovelace → Agent `openTab` 页 B [Project Gutenberg](https://www.gutenberg.org/)，检索框恰好 `Ada Lovelace`，结果列表入画，侧栏写出姓名 / 生卒 / 一句评价后停在 `Worked for 1m 15s`。侧栏是 Chrome **窗口内右侧 Side Panel**（约 1/4 宽），菜单栏、标签栏与地址栏入画。打字约 2.2x，片头空坐切到约 2s，发送前空等硬切，Agent 等待 5x，新标签 / 填框 / 结果 1.6x，终稿约 2.5x 后留 1x 收住。BGM 为 Kevin MacLeod《Wallpaper》（CC BY 3.0，1x）。
>
> take6 raw（144.5s）在结果入画后被 SIGINT，Agent 仍停在 `Read` / “page may still be loading”，终稿不在素材里。本镜是 take7 raw（237.1s，2880×1800），等到回合结束后再停录。
>
> 录前输入法锁 **ABC / U.S.**，禁止拼音候选条。

片中口播 / UI / Agent 回复一律 **英文**。本文件给录制的人看，所以规格用中文。

---

## Primary：Wikipedia → Project Gutenberg 检索

**标题：** Cross-page: Wikipedia facts → Gutenberg search

**一句话：** 在 Ada Lovelace 的英文维基上读出结构化事实，再 **新开标签** 到 Project Gutenberg，把检索框填成可提交状态并搜出结果。

**为什么能证明「浏览器扩展 + 跨页 Agent」：**

- 画面始终是 **一个** Chrome 窗口：菜单栏 + 标签栏 + 地址栏 + 网页 + **右侧停靠侧栏**（不是 popup、不是拖出去的 App 窗）。
- Agent 用现有页面工具读 **源站 A**，再用 `openTab` 打开 **另一源站 B**（`en.wikipedia.org` → `gutenberg.org`），在 B 上 `fill` / `fillForm` / `press`。
- 观众能看见 **第二条标签出现**、地址栏换成 Gutenberg、页面上的 **Agent 光标** 滑到检索框并填字。不是写本地 HTML，也不进 Finder。

### 站点语言（强制）

只用 **英文站点**，或不会按地区切语言的英文 URL。禁止：

- `openlibrary.org`（会 geo 切到中文 UI）
- DuckDuckGo、Google、GitHub locale 等会按地区/浏览器语言本地化的站
- 用拼音输入法「英文模式」打英文字（候选条仍会入画）

页 A 用英文维基（`en.wikipedia.org`）会保持英文。页 B 用 Gutenberg 英文目录。录页 B 前先在抛开窗口打开 Gutenberg 确认 UI 是英文；若居然本地化了，改用 Backup arXiv。

### 现有能力（脚本只使用这些）

读：`getReadable` / `getInteractive` / `getMeta` / `getOutline` / 工作区 `snapshot.md` / `interactive.md` / `current.json` / `tabs.json`。

做：`openTab`（新开 http(s)，不覆盖当前页）、`switchTab`、`fill` / `type` / `fillForm`、`click`、`press`（Enter）、`waitFor`、`scrollIntoView`。必要时 `screenshot` 核对布局。

不要依赖：本机写报告、`reportArtifacts`、Finder、`runScript` 批量（单框检索不需要）、登录后的站点。

### 精确 URL

| 角色 | URL |
|---|---|
| 页 A（开录前用户停在这里） | `https://en.wikipedia.org/wiki/Ada_Lovelace` |
| 页 B（Agent `openTab`，禁止用户先打开） | `https://www.gutenberg.org/` |

### 精确用户 Prompt（原样打进侧栏，英文）

```
Read this Wikipedia article with page tools. Extract her full name, birth and death years, and one sentence on why she is often called the first computer programmer.

Then open https://www.gutenberg.org/ in a NEW browser tab with openTab. Do not replace this Wikipedia tab with navigate.

On Project Gutenberg, fill the main search with exactly: Ada Lovelace
Then submit search so results appear.

Do not write local HTML, Markdown, or PDF. Do not call reportArtifacts. Do not use the shell to open Finder. Stay in the live pages.
```

期望 Agent 从页 A 用到的事实（供核对，不必在侧栏念全文）：

- 全名：Augusta Ada King, Countess of Lovelace（Ada Lovelace）
- 生卒：1815–1852（10 December 1815 – 27 November 1852）
- 一句：Notes on Babbage’s Analytical Engine / 常被视为第一位程序员

Gutenberg 检索框填 **恰好** `Ada Lovelace`（框短时用这个；框够长可用 `Ada Lovelace Analytical Engine`）。提交后结果列表必须入画。

### 镜头表（成片时钟；括号内是剪辑倍率）

成片目标 **≤45s**。打字可加速；发送前空等必须硬切；Agent 空等/流式可跳切。用户点击、新标签出现、填框与结果落地要能看清。

| 成片 | 谁 | 倍率 | 观众必须看见 |
|---|---|---|---|
| 建立 | — | 1x（只留约 2s，切掉开录后空坐） | Chrome **采集原尺寸**，右侧 Side Panel，深色英文 UI，**新空会话且历史抽屉已关**，页 A 维基 + 侧栏。菜单栏、标签栏、地址栏都在画面里。鼠标可见。 |
| 打字 | 用户 | 1.8x–2.5x | 点击输入框，**逐字键入**上面整段 prompt（ABC/US 键盘；禁止整段粘贴；禁止 Chrome 页内查找 Cmd+F）。 |
| 发送 | 用户 | 1x；**删掉打完到点发送之间的停顿** | Enter / 点发送。用户气泡出现，输入框四色进行中描边。 |
| Agent 读维基 | Agent | 4x–6x | 侧栏灰字工具：读 `snapshot` / `getReadable` / `interactive.md`。**主区仍是维基**。 |
| 新标签 | Agent | 1x–2x | `openTab`：标签栏 **多出** Gutenberg；地址栏变为 `gutenberg.org`。若 Agent 误用 `navigate` 把维基覆盖掉：本条作废，重来。 |
| 填框 / 结果 | Agent | 填框与结果落地 1x–2x；中间空等 4x–6x | 页上 Agent 光标滑到检索框，`fill`/`fillForm` 出现 `Ada Lovelace`，提交。结果列表出现。 |
| 收住 | Agent | 1x–2x | 双标签仍在；Gutenberg 结果可见；侧栏已写出姓名/生卒/一句评价且无转圈。录完后再空等 10–20s 确认回合结束再停 ffmpeg。**不要** 打开产物条、不要切出浏览器。 |

BGM：`MUSIC.md` 那条已下载的 CC 曲，成片 **1x**，头尾淡入淡出 0.4–0.5s，不跟 setpts 升调。不要自己合成。

---

## Backup：Wikipedia → arXiv 检索

Gutenberg 挂了、检索框进不了 `interactive.md`、或（极少见）UI 本地化时改用此条。页 A 与 prompt 前半相同，只换页 B 与最后两句。arXiv UI 是英文。

| 角色 | URL |
|---|---|
| 页 A | `https://en.wikipedia.org/wiki/Ada_Lovelace` |
| 页 B | `https://arxiv.org/search` |

Prompt 把 Gutenberg 段换成：

```
Then open https://arxiv.org/search in a NEW browser tab with openTab. Do not replace this Wikipedia tab with navigate.

On arXiv, fill the search with Ada Lovelace / Analytical Engine and submit so results appear.

Do not write local HTML, Markdown, or PDF. Do not call reportArtifacts. Do not use the shell to open Finder. Stay in the live pages.
```

（不要退回 Open Library、DuckDuckGo、Google。）

---

## 输入法（强制，开 ffmpeg 之前做完）

中文 IME（拼音）即使切到「英文模式」也会弹出候选条、来回翻 中/EN，成片作废。

录前必须：

1. 把 macOS 输入源切到 **ABC** 或 **U.S.**（`com.apple.keylayout.ABC` / `com.apple.keylayout.US`）。**不要**用拼音的英文模式冒充。
2. 尽量关掉「自动按文稿切换输入法」（系统设置 / `defaults`）。
3. 在 OpenSider 输入框 **试打** `abc XYZ test`。只要出现候选条/气泡——哪怕字母是拉丁文——立刻中止，修好 IME 再试，直到按键直接出拉丁字母且 **没有气泡**。
4. 试打通过后 **全选删除** 清空输入框。
5. 正式镜头用 ABC/US 的真实按键逐字输入。中途冒出候选条：中止重录。
6. **禁止**用拼音打英文。**禁止**整段粘贴 prompt（看起来假）。必须先锁 ABC，再逐字击键。

---

## 录制几何与 Chrome 侧栏（强制）

### 窗口

- 只用 **Mac 内建屏**（ffmpeg `Capture screen 0`）。外接屏禁止。
- Chrome 铺满内建屏即可。ffmpeg 在 Retina 上会采到逻辑分辨率的 2 倍（本机常见 **1440×900 → 2880×1800**）。**成片必须等于这份采集尺寸**：不要中心裁 16:9，不要 scale 到 1920×1080，不要加黑边。上一镜裁掉顶上菜单栏后，鼠标点按看起来不完整。
- **不要** 把侧栏拖成独立窗口，**不要** 用 Side Panel 的「在新标签打开 / 弹出」类控件，**不要** 只录侧栏、不要裁掉菜单栏、标签栏和地址栏。
- 侧栏宽度拖到约窗口的 **1/4**（用分隔条；不要停在 Chrome 默认偏窄）。
- 侧栏必须在 **右边**（Chrome Side Panel 可改左边：录前确认在右）。

### 扩展如何打开（避免录成 popup）

产品是 MV3 **`side_panel.default_path`**，**没有** `action.default_popup`。Service Worker 里 `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`：点工具栏 OpenSider 图标 = 在 **当前浏览器窗口内** 打开侧栏。

录前自检（缺一条就停）：

1. 聊天 UI 与维基 **同一窗口**，中间有竖向分隔条。
2. 上方仍是菜单栏 + Chrome 标签条 + 地址栏；维基 URL 在地址栏里。
3. 扩展页 `chrome://extensions` 为 **未打包** 加载（开发 `packages/extension/dist` 或用户 `~/.opensider/extension`），不是商店包。
4. 关掉 Chrome「停用开发者模式扩展」、测试模式、翻译条、维基筹款/cookie 条。
5. 界面语言 **English**；侧栏语言 **EN**；**已有会话不要再新建**。
6. 权限档 **Allow all**（允许一切操作），避免权限卡打断。Agent：已登录的 **Cursor**，模型用列表里的 **Auto**（或当前默认；全片不要换模型）。
7. 系统指针可见（macOS 辅助功能不要藏光标）。禁止演示 Chrome 页内查找。
8. 输入法已锁 ABC/US，试打无候选条（见上文）。
9. 不要重启 Chrome、不要重载扩展（除非连接已死）。不要预开 Gutenberg 标签（预检用抛开窗口）。

### ffmpeg（剪辑规则）

- 采集：内建屏 `Capture screen 0` + 系统指针。
- 成片 H.264，**分辨率 = raw**。禁止 crop / scale / pad。
- 打字 `setpts` **1.8x–2.5x**（能读，不要 8x）。
- 打完字到点发送：硬切，不要留空镜。
- Agent 流式/等待 **4x–6x**；新标签出现、填框、结果落地 **1x–2x**；用户点击 1x。
- 跳切只切「无变化的等待」，不要切掉 `openTab`。
- 音床见 `MUSIC.md`：下载的 CC 曲，BGM 1x，不升调。

---

## 风险 / 中止条件

| 现象 | 处理 |
|---|---|
| 登录墙、CAPTCHA、Cloudflare 人机 | 停。改 Backup arXiv；仍不行当天不录。 |
| Agent 写 `outputs/*.html` 或出现产物条 / Finder | 停。新空会话，prompt 已禁止写文件；不要把错片剪进去。 |
| 只用 `navigate` 覆盖维基，标签栏始终一条 | 停。必须看见 **新标签**。 |
| 侧栏变成独立窗口、或画面里没有标签栏 | 停。不是 Side Panel。 |
| 维基/Gutenberg 弹层挡住正文或检索框 | 录前关掉；录到了就重来。 |
| Agent 提问卡 / 计划卡 | 停。确认已是 Allow all 再开新会话。 |
| 检索框没填上（SPA 未吃到 fill） | 可允许 Agent 再 `type`/`press`；超过 ~20s 墙钟仍空则改 Backup。 |
| 打字时出现 IME 候选条 / 中英切换气泡 | 停。锁回 ABC/US，试打通过后再试。 |
| 页 B UI 变成中文或其他本地化语言 | 停。改 Backup arXiv。不要用 Open Library / DDG / Google。 |
| 成片被裁成 16:9 / 1920×1080 | 停。从 raw 重剪，保持采集尺寸。 |

---

## 明确不做

- 不再拍「分析页面 → 写 HTML 报告 → Show in folder / Finder」。
- 不录拖出的侧栏、popup、独立 Electron 式窗口。
- 不做 iPhone 式三点卖点字幕/分镜。
- 不换中文 UI、不发中文 prompt、不用会本地化的站点（含 Open Library）。
- 不用拼音打英文、不整段粘贴 prompt。
- 不在本轮改产品 UI（脚本用现有工具即可完成）。
- 不要重启 Chrome / 重载扩展（连接已死除外）。
- 不要把采集画面裁成 16:9 或垫到 1920×1080。
- 不要用 ffmpeg 合成或 AI 生成的音床。
