# 演示成片与下一镜

> **当前成片（上一镜，先留着）**：[`opensider.mp4`](./opensider.mp4)（采集原分辨率 **2880×1800**，**43.8s**）仍是 **Wikipedia → Gutenberg 检索**。用户认可 take7 **工艺**，但故事先是「反了」，书→维基又太小众。
>
> **下一镜（计划中，未录）**：向 Agent 要「今日各大科技媒体 AI 新闻 TOP 10」→ 写成一张独立 HTML → **在浏览器里打开并滚动预览**。
>
> **在用户点头重录之前：不要替换 `opensider.mp4`，不要开录。**
>
> 录前输入法锁 **ABC / U.S.**，禁止拼音候选条。

片中口播 / UI / Agent 回复一律 **英文**。本文件给录制的人看，所以规格用中文。

---

## 下一镜（计划中，未录）：科技媒体 AI 新闻 → TOP 10 网页 → 浏览器滚动预览

**标题：** Today's AI news TOP 10 → HTML briefing → scroll in Chrome

**一句话：** 人在侧栏下一句需求；Agent **新开多个英文科技媒体标签**读今日 AI 头条，提炼 **TOP 10** 写成 `outputs/ai-news-top10.html`，`reportArtifacts` 后 **在同一 Chrome 窗口打开这张网页并滚动**，让观众看见完整简报。

**为什么换故事：**

- 维基人名 → Gutenberg 搜书：没人会这么做。
- Gutenberg 书页 → 维基查作者：故事顺了，但太小众，看不出产品日常用处。
- 「帮我盯住今天的 AI 新闻，汇总成一页」是侧栏 Agent 的典型活：跨多个真网站取数，再交出能打开的产物。

**为什么能证明「浏览器扩展 + 跨页 Agent + 产物」：**

- 画面始终是 **一个** Chrome 窗口：菜单栏 + 标签栏 + 地址栏 + 网页 + **右侧停靠侧栏**。
- 标签栏会 **陆续多出** The Verge / Ars Technica（或其它备用源）——这是跨页，不是只读当前页、也不是只写本地文件。
- 侧栏出现产物条后，主区切到 **生成的 HTML**，鼠标 **向下滚动** 扫过 TOP 10。不是停在 Finder，也不把「打开文件位置」当高潮。

### 站点语言（强制）

只用 **英文科技媒体**，或不会按地区切中文 UI 的英文 URL。禁止：

- 中文媒体（36kr、少数派、机器之心等）——片子是英文 UI / 英文 prompt / 英文简报
- `openlibrary.org`、会 geo 切中文的检索站
- 用拼音「英文模式」打字（候选条入画即作废）

录前用抛开窗口打开下面三个栏目页，确认：**英文 UI、头条在首屏可读、无登录墙挡死列表**。Cookie / 订阅条录前关掉。不要预开第 2、第 3 个媒体标签（开录时只停在页 A）。

### 现有能力（脚本只使用这些）

读：`getReadable` / `getInteractive` / `getMeta` / `getOutline` / 工作区 `snapshot.md` / `interactive.md` / `current.json` / `tabs.json`。

做：`openTab`（**仅 http(s)**，不覆盖当前页）、`switchTab`、`click`、`press`、`waitFor`、`scroll` / `scrollIntoView`、写文件到 `outputs/`、`reportArtifacts`。

`openTab` **打不开** `file://`。预览生成页用下面「打开产物」两种办法之一，优先 A。

### 精确 URL

| 角色 | URL | 说明 |
|---|---|---|
| 页 A（开录前停在这） | `https://news.ycombinator.com/` | 英文-only，广告少，首屏就是头条列表。 |
| 页 B（Agent `openTab`，禁止预开） | `https://www.theverge.com/ai-artificial-intelligence` | The Verge AI。 |
| 页 C（Agent `openTab`，禁止预开） | `https://arstechnica.com/ai/` | Ars Technica AI。若 404 / 软 404，改 `https://arstechnica.com/information-technology/`。 |

**Backup 源（某个栏目挂了、付费墙挡光、或 CAPTCHA 时换，不要一次开五个）：**

| 备用 | URL |
|---|---|
| Hacker News | `https://news.ycombinator.com/`（英文-only，头条稳） |
| Wired AI tag | `https://www.wired.com/tag/artificial-intelligence/`（若未切语言） |

不要用 Google News、Bing、百度、微博。Agent 必须用页面工具读这些标签上的字，**禁止**只靠模型记忆编 10 条「假今日新闻」。

### 精确用户 Prompt（原样打进侧栏，英文）

```
Read today's AI headlines from major English tech outlets using page tools. Start with this Hacker News page. Then openTab these URLs (do not navigate away from existing tabs):

https://www.theverge.com/ai-artificial-intelligence
https://arstechnica.com/ai/

Skim what is actually on those pages. Pick the 10 most important AI stories from today (or the latest visible if a site is not dated today). Do not invent stories that are not on the pages.

Write a single self-contained visual HTML briefing to outputs/ai-news-top10.html. It must include:
- a clear title and today's date
- a ranked TOP 10 (1–10)
- each item: headline, source name, one-sentence summary, and the article URL if visible
- readable typography, no external fonts or scripts

Then call reportArtifacts on that file.

After the file exists, serve the outputs folder over localhost HTTP if needed and openTab the briefing in this Chrome window. Do not use Finder. Stay in the browser.

Do not write Markdown or PDF. Do not replace the Hacker News tab with navigate.
```

期望核对（不要写进 prompt）：

- 标签栏至少 **3 个** 媒体标签（HN + Verge + Ars，或 Backup 替换后仍 ≥3）。
- `~/.opensider/workspace/outputs/ai-news-top10.html` 存在，侧栏产物条出现该文件名。
- 新标签打开简报（`http://127.0.0.1:…/ai-news-top10.html` 优先；`file://` 仅当 localhost 失败）。
- HTML 上能读到 **TOP 10** 和日期；滚动能扫完列表。

### 打开产物（强制优先浏览器，不要 Finder 高潮）

`openTab` 只接受 http(s)。推荐顺序：

1. **Preferred：** Agent 在 `outputs/` 起一个短时 `python3 -m http.server <port>`（或等价），再 `openTab http://127.0.0.1:<port>/ai-news-top10.html`。内容脚本能注入，之后可以 `scroll`。
2. **Backup：** `open -a "Google Chrome" ~/.opensider/workspace/outputs/ai-news-top10.html`，新标签出现在 **同一窗口**。`file://` 上扩展往往不能滚页面 —— 这时由 **操作者用鼠标滚轮/拖滚动条** 完成预览（1x，光标可见）。
3. **不要** 把「打开文件位置 / Finder」当作成片高潮。Finder 只在 1+2 都打不开时救急，且只停一拍就回到 Chrome。

### 镜头表（成片时钟；括号内是剪辑倍率）

成片目标 **≤45s**（工艺对齐 take7；多站等待靠加速和跳切）。打字可加速；发送前空等硬切；Agent 空等/流式可跳切。 **新标签出现、产物条出现、打开简报、滚动预览** 必须能看清。

| 成片 | 谁 | 倍率 | 观众必须看见 |
|---|---|---|---|
| 建立 | — | 1x（只留约 2s） | Chrome **采集原尺寸**，右侧 Side Panel ≈1/4，深色英文 UI，**新空会话且历史抽屉已关**，页 A Hacker News。菜单栏、标签栏、地址栏入画。鼠标可见。 |
| 打字 | 用户 | 1.8x–2.5x | 点击输入框，**逐字键入**上面整段 prompt（ABC/US；禁止整段粘贴；禁止 Cmd+F）。 |
| 发送 | 用户 | 1x；**删掉打完到发送的停顿** | Enter / 点发送。 |
| 读当前页 | Agent | 4x–6x | 侧栏出现读页工具；**主区仍是 Hacker News**。 |
| 跨页开标签 | Agent | **每个新标签落地 1x–2x**；中间空等 4x–6x | 标签栏 **陆续多出** The Verge、Ars Technica。若始终只有一个标签（纯记忆编新闻）：作废。 |
| 写 HTML + 产物 | Agent | 写文件/工具 4x–6x；产物条出现 **1x–2x** | 侧栏「Artifacts」出现 `ai-news-top10.html`。 |
| 打开简报 | Agent / 用户 | 1x–2x | 同一窗口 **新标签** 打开 TOP 10 页（地址栏是 localhost 或 file）。不要切到 Finder 当主画面。 |
| 滚动预览 | 用户（优先）或 Agent | **1x** | 主区 HTML 向下滚，至少扫过前若干条到能看出「这是一张 TOP 10 简报」。光标/滚动条可见。 |
| 收住 | — | 1x | 简报标签仍在；侧栏回合已结束（耗时行、无转圈）。停 ffmpeg 前再空等 10–20s。 |

BGM：`MUSIC.md` 已下载的 CC 曲（Kevin MacLeod《Wallpaper》），成片 **1x**，头尾淡入淡出，不跟 setpts 升调。不要自己合成。

---

## Backup：源站当天不好用

某个栏目 404 / 硬登录墙 / CAPTCHA / 整页中文：

- 用上表 Backup 源替换 **那一个** URL，prompt 里同步改那一行。
- 至少保住 **两个不同源站 + 当前 HN**，标签栏仍能看出跨页。
- 三个官方栏目全挂：当天改停在 HN 首页，prompt 改为「从 HN 头条里挑 AI 相关再 openTab 进讨论链的外链」。仍要写成 HTML + 浏览器预览。不要退回 Gutenberg / 维基人名。

localhost 起不来：改 Backup 打开方式（`open -a Google Chrome` + **人手滚动**）。不要改成只在侧栏贴 Markdown。

---

## 输入法（强制，开 ffmpeg 之前做完）

中文 IME（拼音）即使切到「英文模式」也会弹出候选条。录前必须：

1. 输入源切到 **ABC** 或 **U.S.**（`com.apple.keylayout.ABC` / `com.apple.keylayout.US`）。
2. 尽量关掉「自动按文稿切换输入法」。
3. 在 OpenSider 输入框试打 `abc XYZ test`。出现候选条就停，修好再试。
4. 试打通过后 **全选删除**。
5. 正式镜头逐字击键。中途冒出候选条：中止重录。
6. **禁止**整段粘贴 prompt。

---

## 录制几何与 Chrome 侧栏（强制）

### 窗口

- 只用 **Mac 内建屏**（ffmpeg `Capture screen 0`）。
- 成片 **等于采集尺寸**（本机常见 1440×900@2x → **2880×1800**）。禁止中心裁 16:9、scale 到 1920×1080、加黑边、裁掉菜单栏。
- 侧栏停在窗口 **右侧**，宽约 **1/4**。禁止拖成独立窗口、禁止只录侧栏。
- 菜单栏 + 标签栏 + 地址栏必须入画（跨页靠标签栏才读得懂）。

### 扩展如何打开

产品是 MV3 Side Panel（`openPanelOnActionClick`），没有 popup。录前自检：

1. 聊天与 Hacker News **同一窗口**，中间有竖分隔条。
2. 未打包扩展；关掉开发者模式横幅、翻译条、订阅弹层。
3. 界面 **English**；权限 **Allow all**；Cursor **Auto**；**新会话 → 再关历史抽屉 → 再开录**。
4. 系统指针可见。禁止 Chrome 页内查找。
5. IME 已锁 ABC/US。不要重启 Chrome / 重载扩展（连接已死除外）。
6. 不要预开 Verge / Ars 标签（只要 HN）。

### ffmpeg（剪辑规则）

- 采集：内建屏 + 系统指针。成片 H.264，**分辨率 = raw**。
- 打字 1.8x–2.5x；打完到发送硬切；Agent 读页/等待 4x–6x。
- **每个新媒体标签落地、产物条出现、打开简报、滚动预览：1x–2x（滚动必须 1x）。**
- 跳切只切无变化等待，不要切掉 `openTab`。
- 音床见 `MUSIC.md`，BGM 1x。
- 等到回合结束 **并且** 简报已滚过一轮再停；不要在写 HTML 或读第 2 个站时 SIGINT。

---

## 风险 / 中止条件

| 现象 | 处理 |
|---|---|
| 标签栏始终只有 HN，10 条像背课文 | 停。必须看见跨页新标签。 |
| 源站 CAPTCHA / 硬登录墙 | 换 Backup 源；三个都挂当天不录这条。 |
| 源站 UI 变成中文 | 停。换英文-only 备用。 |
| Agent 只写 Markdown / 侧栏长文、不写 HTML、无产物条 | 停。重来。 |
| 高潮是 Finder，浏览器里没有打开简报 | 停。必须在 Chrome 里打开并滚动。 |
| 简报打开了但 0 条 / 明显编造日期 | 停。 |
| 权限卡 / 计划卡 | 停。确认 Allow all，新会话。 |
| IME 候选条 | 停。 |
| 成片裁成 16:9 / 裁掉顶栏 | 从 raw 重剪，禁止 crop。 |
| 会话未结束就停录 | 停。等耗时行出现再多留 10–20s。 |

---

## 明确不做

- 不再拍维基 ↔ Gutenberg 人名互搜。
- 不做 iPhone 式三点卖点。
- 不换中文 UI / 中文 prompt / 中文媒体。
- 不把 Finder Reveal 当主叙事（产物条可以入画，高潮是浏览器里的 HTML）。
- 不在本轮改产品 UI。
- **现在不要录、不要替换 `opensider.mp4`。**
