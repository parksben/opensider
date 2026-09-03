# 演示成片与下一镜

> **当前成片（上一镜，先留着）**：[`opensider.mp4`](./opensider.mp4)（采集原分辨率 **2880×1800**，**43.8s**）仍是 **Wikipedia → Gutenberg 检索**。
>
> **下一镜（用户已点头，按此录）**：英文科技 / 产品资讯站（The Verge）→ 两三句人话让 Agent 全网搜今日最热 AI 新闻、按热度出榜、写成 HTML，并 **自己在浏览器打开**。不要人手 File → Open。
>
> 录前输入法锁 **ABC / U.S.**，禁止拼音候选条。

片中口播 / UI / Agent 回复一律 **英文**。本文件给录制的人看，所以规格用中文。

---

## 故事

**标题：** Today's hottest AI news → HTML list → open and scroll

**一句话：** 人停在 The Verge 这类科技 / 产品站；侧栏用两三句人话拜托 Agent 去全网找今天最热的 AI 新闻、按热度排榜、写成一张 HTML，并 **直接在这个浏览器打开**。

**为什么这样讲：**

- 维基 ↔ Gutenberg 搜人名：没人会这么做。
- 上一条脚本把 Verge / Ars URL 和 HTML 规格写进超长 prompt，看起来像 AI 在念 runbook，不像人在用侧栏。
- 「帮我看看今天 AI 什么最热，做成一页我打开」才是日常：跨站取数，再交出能点开的东西。

**观众必须看见：**

- 一个 Chrome 窗口：菜单栏 + 标签栏 + 地址栏 + 网页 + **右侧停靠侧栏**。
- 先是科技 / 产品站，再是 Agent 自己去开其它站（不要预开）。
- 侧栏出现产物后，**同一窗口新标签**打开 HTML 简报。高潮是浏览器里的榜单，不是 Finder，也不要人手去点「打开文件」。

---

## 开录停在哪

只用 **英文科技 / 产品资讯站**。禁止综合新闻和政治站（BBC、Reuters、CNN 等）。不要维基 / 书站 / 检索框站。

| 角色 | URL | 说明 |
|---|---|---|
| 页 A（开录前停在这） | `https://www.theverge.com/` | 英文科技 + 产品资讯首页。Cookie / 订阅条录前关掉。 |
| Backup | `https://techcrunch.com/` | The Verge 登录墙 / 整页中文 / 打不开时换。 |
| Backup 2 | `https://www.wired.com/` | 再不行用这家（仍是科技，不是综合新闻）。 |

不要预开其它媒体标签。Agent 要自己去搜、自己 `openTab`。禁止 36kr / 少数派 / 机器之心，禁止 `openlibrary.org`。

---

## 精确用户 Prompt（原样打进侧栏，最多两句）

看起来要像人随手打的，禁止列 URL、禁止列 HTML 规格、禁止念工具名。

```
Find today's hottest AI news across the web and rank them. Put the list in an HTML file and open it in this browser.
```

**禁止**整段粘贴。逐字击键。中途冒出拼音候选条：中止重录。

期望（不要写进 prompt）：

- Agent 用页面工具 / `openTab` 去真实站点读，不要只靠记忆编 10 条「假今日新闻」。
- 工作区出现一张 HTML（文件名不限，常见 `outputs/ai-news-top10.html` 或相近）。
- 侧栏产物条出现该文件。
- Agent 写完后 **自己在同一 Chrome 窗口打开** 这张 HTML（localhost `openTab` 优先；`open -a "Google Chrome"` 作备）。不要人手 File → Open，不要把 Finder 当高潮。

---

## 打开产物（Agent 自己开，不要人手点文件框）

`openTab` 只接受 http(s)。推荐：

1. Agent 在 `outputs/` 起短时 `python3 -m http.server`，再 `openTab http://127.0.0.1:<port>/….html`。
2. 备：`open -a "Google Chrome"` 打开该文件，新标签须落在 **同一窗口**。
3. 不要人手 File → Open，不要把 Finder 当高潮。

---

## 镜头表（成片时钟；括号内是剪辑倍率）

成片目标 **≤45s**（工艺对齐 take7）。打字可加速；发送前空等硬切；Agent 空等/流式可跳切。 **Agent 打开简报必须能看清（1x–2x）。**

| 成片 | 谁 | 倍率 | 观众必须看见 |
|---|---|---|---|
| 建立 | — | 1x（约 2s） | Chrome **采集原尺寸**，右侧 Side Panel ≈1/4，深色英文 UI，**新空会话且历史抽屉已关**，页 A The Verge（或 Backup）。菜单栏、标签栏、地址栏入画。鼠标可见。 |
| 打字 | 用户 | 1.8x–2.5x | 点输入框，**逐字**打上面两句（ABC/US；禁止粘贴；禁止 Cmd+F）。 |
| 发送 | 用户 | 1x；**删掉打完到发送的停顿** | Enter / 点发送。 |
| 全网取数 | Agent | 空等 4x–6x；**每个新标签落地 1x–2x** | 标签栏陆续多出其它英文站。始终只有一个标签且 10 条像背课文：作废。 |
| 写 HTML + 产物 | Agent | 写文件 4x–6x；产物条 **1x–2x** | 侧栏 Artifacts 出现 HTML 文件名。 |
| 打开简报 | Agent | **1x–2x** | 同一窗口 **新标签** 打开 TOP 榜 HTML。 |
| 收住 | — | 1x | 简报标签仍在；侧栏回合已结束（耗时行、无转圈）。停 ffmpeg 前再空等 10–20s。 |

BGM：`MUSIC.md` 已下载的 CC 曲（Kevin MacLeod《Wallpaper》），成片 **1x**，头尾淡入淡出，不跟 setpts 升调。

---

## 输入法（强制，开 ffmpeg 之前做完）

1. 输入源 **ABC** 或 **U.S.**（`com.apple.keylayout.ABC` / `com.apple.keylayout.US`）。
2. 尽量关掉「自动按文稿切换输入法」。
3. 在 OpenSider 输入框试打 `abc XYZ test`。出现候选条就停，修好再试。
4. 试打通过后 **全选删除**。
5. 正式镜头逐字击键。中途冒出候选条：中止重录。
6. **禁止**整段粘贴 prompt。

---

## 录制几何与 Chrome 侧栏（强制）

- 只用 **Mac 内建屏**（ffmpeg `Capture screen 0`）。
- 成片 **等于采集尺寸**（本机常见 1440×900@2x → **2880×1800**）。禁止中心裁 16:9、scale 到 1920×1080、加黑边、裁掉菜单栏。
- 侧栏停在窗口 **右侧**，宽约 **1/4**。禁止拖成独立窗口、禁止只录侧栏。
- 菜单栏 + 标签栏 + 地址栏必须入画。
- 界面 **English**；权限 **Allow all**；Cursor **Auto**；**新会话 → 再关历史抽屉 → 再开录**。
- 关掉开发者模式横幅、翻译条、订阅弹层。系统指针可见。
- 不要重启 Chrome / 重载扩展（连接已死除外）。
- 不要预开第 2 个媒体标签。

### ffmpeg（剪辑规则）

- 采集：内建屏 + 系统指针。成片 H.264，**分辨率 = raw**。
- 打字 1.8x–2.5x；打完到发送硬切；Agent 读页/等待 4x–6x。
- **新标签落地、产物条：1x–2x。打开 HTML、滚动预览、鼠标点击：1x。**
- 跳切只切无变化等待，不要切掉新标签落地。
- 音床见 `MUSIC.md`，BGM 1x。
- 等到回合结束 **并且** 简报已滚过一轮再停；不要在写 HTML 时 SIGINT。

---

## 风险 / 中止条件

| 现象 | 处理 |
|---|---|
| 标签栏始终只有页 A，10 条像背课文 | 停。必须看见跨页。 |
| 源站 CAPTCHA / 硬登录墙 | 换 Backup；两家都挂当天不录。 |
| 开录停在 BBC / Reuters / CNN 等综合或政治新闻 | 停。换 The Verge / TechCrunch / Wired。 |
| 源站 UI 变成中文 | 停。换英文-only 备用。 |
| 只写 Markdown / 侧栏长文、不写 HTML、无产物条 | 停。重来。 |
| 写了 HTML 但浏览器里没有打开简报 | 停。必须看见新标签打开榜单。 |
| 高潮停在 Finder | 停。必须在 Chrome 里打开并滚动。 |
| 简报 0 条 / 明显编造 | 停。 |
| 权限卡 / 计划卡 | 停。确认 Allow all，新会话。 |
| IME 候选条 | 停。 |
| 成片裁成 16:9 / 裁掉顶栏 | 从 raw 重剪，禁止 crop。 |
| 会话未结束就停录 | 停。等耗时行出现再多留 10–20s。 |
| Prompt 超过三句或带工具说明书 | 停。重打上面那两句。 |

---

## 明确不做

- 不再拍维基 ↔ Gutenberg。
- 不在 prompt 里列 URL、HTML 字段、`openTab`、`reportArtifacts`。
- 不做 iPhone 式三点卖点。
- 不换中文 UI / 中文 prompt / 中文媒体。
- 不把 Finder Reveal 当主叙事。
- 不在本轮改产品 UI。
