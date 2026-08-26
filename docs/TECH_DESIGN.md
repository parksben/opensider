# Cursor Sidebar — 技术设计

> Chrome 扩展通过 Native Messaging 托管 `agent acp`；页面感知用内容脚本 + 工作区文件，不使用 MCP，不运行常驻本地服务。

## 总览

```
Chrome Side Panel (ChatPane)
        │ chrome.runtime
Service Worker
        │ Native Messaging (stdio, Chrome 按需拉起)
Native Host
        ├─ child process: `agent acp`   (JSON-RPC over stdio)
        └─ 工作区文件: ~/.cursor-sidebar/workspace
               browser/current.json
               browser/snapshot.md
               browser/commands/*.json
               browser/results/*.json
               AGENTS.md

Content Script  ←── 当前标签的读取 / 操作方法
Service Worker  ←── navigate / goBack / goForward / reload
```

浏览器扩展不能 spawn 本机进程。Cursor CLI 的自定义客户端协议是 ACP（`agent acp`，stdio JSON-RPC）。二者之间只加一层 **Chrome Native Messaging Host**：Chrome 在扩展连接时启动它，断开后退出。用户不必先开一个 Node 服务。

## 为什么不用 MCP

ACP 的 `session/new` 可以带 `mcpServers`，这是给 Agent 加工具的官方方式。页面读写和自动化都走同一套工作区命令文件，不必再加 MCP。

Cursor Agent 在 ACP 模式下仍然自己执行本地工具（读文件、写文件、Shell 等）。Client 的 `fs` / `terminal` capability 只是让 IDE 代管文件，不是 Agent 用工具的前提。因此：

- 本地工具：什么都不加，`mcpServers: []`，模式用 `agent`。
- 页面工具：内容脚本提供方法；Host 把「当前页」写成工作区文件；Agent 用已有 Read/Write 读写这些文件。工作区里的 `AGENTS.md` 告诉 Agent 协议。

这不是通用工具总线，但够用，也避免再跑一个 MCP 进程。

备选（未采用）：在 Host 进程内嵌 stdio MCP。能力更「正式」，但多一套握手，和「尽量不增加东西」冲突。

## 进程职责

### Side Panel

- 消息列表、输入框、进行中状态由侧栏自己的 React state 驱动（不依赖 assistant-ui 的 `useAuiState` 选择器，避免和 ExternalStore 不同步：表现为发了消息没动效、也没有停止按钮）
- 会话列表、当前选中会话、语言也由 App state 驱动，写入 `chrome.storage.local`
- 工具调用、思考、markdown 由侧栏自己的折叠行 / Markdown 组件展示
- 发出用户输入（可带本机附件路径）、取消、权限决定、提问/计划回答、新建 / 切换 / fork 会话、选模型
- 展示当前页 favicon（hover 看标题 + 完整 URL）、进行中的页面命令、无边框连接状态、输入框上方的 todo 与权限/提问/计划卡片、输入栏附件芯片、元素拾取蒙层与模型下拉
- 离线发送会立刻报错；Service Worker 断开时显示原因（含扩展 ID / `lastError`）并允许重试
- 侧栏先 `sendMessage({ type: "ping" })` 唤醒 SW，再 `connect`。React StrictMode 卸载只摘监听器，不拆端口。端口若在 SW 还在加载时空断，自动重连，避免永远停在 Lost connection
- 不再挂载 assistant-ui runtime；旧的 `ExternalStoreThreadRuntimeCore` 会在端口断开后抛错，把扩展标红

### Service Worker

- Service Worker 一启动就 `connectNative`，不依赖侧栏先连上；`ping` / `onConnect` 也会再拉一次，避免第一次 `connect` 落在 listener 注册之前
- `chrome.runtime.connectNative` 连接 Host；重试时强制拆掉旧端口再连，避免僵尸 `nativePort` 让 `if (nativePort) return` 直接跳过
- 往 Native / 侧栏端口发消息一律 try/catch，断开时清掉引用并写出 `chrome.runtime.lastError`
- 缓存最近一次 `status` / `session` / `page` / `models`，侧栏 `onConnect` 或 `ping` 时立即回放，避免 Host 已 ready 但面板因 React StrictMode 重挂而一直显示离线
- 在 Side Panel、Content Script、Host 之间转发消息；`page.pick` 只走内容脚本，不进 Native Host。先 ping，失败则按 manifest 注入内容脚本再拾取
- 监听 `tabs.onActivated` / `tabs.onUpdated`，通知内容脚本刷新当前页
- 点击工具栏图标打开 Side Panel
- Host 包装脚本一启动就往 `~/.cursor-sidebar/host.log` 打一行，便于判断 Chrome 有没有真正拉起 Host

### Content Script

运行在隔离世界，不往 `window` 挂 API，也不执行任意 JS。元素定位：`args.selector`（CSS）和 / 或 `args.text`（可见文本包含），可选 `args.nth`。侧栏发起 `page.pick` 时进入拾取：悬停高亮、点击生成全局唯一 CSS selector（id 优先，否则 `tag:nth-of-type` 路径，并校验 `querySelectorAll` 唯一），Esc 取消。

读取：

| 方法 | 作用 |
|---|---|
| `getMeta` | url、title、description、canonical |
| `getReadable` | 正文纯文本（简单可读性抽取，截断） |
| `getSelection` | 当前选区 |
| `getLinks` | 同源链接（text + href，截断条数） |
| `getOutline` | h1–h3 文本 |
| `queryText` | 匹配节点的 textContent |
| `queryAll` | 匹配节点摘要列表（tag / text / href） |
| `getAttribute` | `args.attribute` 对应属性 |
| `getValue` | input / textarea / select 的当前值 |
| `exists` | 是否找得到匹配节点 |

操作：

| 方法 | 作用 |
|---|---|
| `click` / `dblclick` | 滚入视口、高亮、派发指针事件后点击 |
| `hover` / `focus` | 悬停或聚焦 |
| `fill` / `type` / `clear` | 填值 / 追加 / 清空，并派发 input+change |
| `select` / `check` | 下拉框和 checkbox / radio |
| `press` | 对焦点或指定元素派发按键（如 Enter） |
| `scroll` / `scrollIntoView` | 窗口滚动或滚到元素 |
| `waitFor` | 轮询直到元素出现，默认 8s，最长 20s |

视觉（Service Worker 截图，内容脚本只负责量元素）：

| 方法 | 作用 |
|---|---|
| `screenshot` | 当前可见视口；可选 `x,y,width,height` 裁切视口区域 |
| `screenshotElement` | 滚入视口后按元素包围盒裁切 |

`chrome.tabs.captureVisibleTab` 得到 JPEG，按 devicePixelRatio 裁切，最长边压到约 1280，质量约 0.72，保证 Native Messaging 帧小于 1MB。Host 把 base64 落成 `browser/screenshots/<id>.jpg`，结果 JSON 只保留绝对路径、宽高、mime。Agent 用已有 Read 打开该图片做视觉分析。v1 不拼整页长截图。

标签级操作由 Service Worker 执行：`navigate`（仅 http(s)）、`goBack`、`goForward`、`reload`。完成后重新抓快照。

### Native Host

- 解析 Chrome Native Messaging 长度前缀帧（**禁止往 stdout 打日志**）
- spawn `~/.local/bin/agent acp`（PATH 不足时用绝对路径）
- 作为 ACP Client：`initialize`（声明 `parameterizedModelPicker`）→ `authenticate(cursor_login)` → 按侧栏指令 `session/load`、`session/new` 或尝试 `session/fork`
- 每个 `AcpClient` 是一条 `agent acp` 进程，同一时刻只能跑一轮 `session/prompt`。要并行跑多个会话时，Host 再拉一条进程（initialize + authenticate），按 ACP `sessionId` 把 `update` / 权限 / Cursor 方法 / `turn.end` 标回去。空闲进程复用，不在一轮结束后立刻杀掉。
- 禁止对正在 prompt 的进程再发 `session/load` / `session/new` / `session/fork`：切走或新建时用空闲进程（没有就新开）。
- 把 Side Panel 的 prompt/cancel/permission、会话新建 / 切换 / fork、模型切换转成 ACP；`cancel` / `permission.reply` / `cursor.reply` 打到发出该请求的那条进程
- 用本机系统对话框选出文件/文件夹的绝对路径（Chrome `<input type=file>` 给不出真路径）
- 用 `agent models` 列出账号可选模型，并结合 `session/new` 的 `configOptions`
- 把 Agent 的 `session/update`、权限请求、Cursor 扩展方法推给扩展
- 把页面快照和 `browser/tools.json` 写入工作区；监视 `browser/commands/`，转给扩展，再把结果写回 `browser/results/`（截图另存 `browser/screenshots/`）

Host 用 Node 24 直接跑 TypeScript（类型擦除）。stdout 只给 Chrome，ACP 走子进程管道，日志只写 `~/.cursor-sidebar/host.log`。

## 工作区布局

```
~/.cursor-sidebar/
  runtime/                   # Chrome 实际拉起的 Host 副本（不在 Desktop）
    packages/host/src
    packages/shared/src
  workspace/                 # ACP session cwd
    AGENTS.md                # 页面协议说明，会话开始就会被读到
    browser/
      tools.json             # 机器可读方法目录，Host 启动时写入
      current.json           # 当前标签：tabId, url, title, updatedAt
      snapshot.md            # 最近一次可读正文
      commands/<id>.json     # Agent 写入的页面命令
      results/<id>.json      # 扩展写回的结果
      screenshots/<id>.jpg   # 视口 / 元素截图
      pasted/<id>.jpg        # 用户从输入框粘贴的截图
  session.json               # 最近一次选中的 ACP sessionId（兼容旧版）
  host.log
```

侧栏状态（语言、会话目录、消息、选中项）存在 `chrome.storage.local`，key 为 `cursor-sidebar/state`。Host 只记当前 ACP `sessionId`，方便进程重启后 `session/load`。

`current.json` 示例：

```json
{
  "tabId": 128,
  "url": "https://example.com/docs",
  "title": "Example Docs",
  "updatedAt": "2026-08-26T03:40:00.000Z"
}
```

命令文件：

```json
{
  "id": "cmd_01",
  "method": "click",
  "args": { "text": "Sign in", "nth": 0 }
}
```

结果文件：

```json
{
  "id": "cmd_01",
  "ok": true,
  "method": "getReadable",
  "data": { "text": "..." }
}
```

命令默认超时 20s（`waitFor` / 导航可能更久）。失败结果带 `ok: false` 和错误信息。文本结果约 200KB 截断。截图走 JPEG 压缩，结果 JSON 不内嵌像素。操作类命令成功后刷新 `current.json` / `snapshot.md`。侧栏通过 `browser.command` / `browser.result` 显示当前页面动作。

Host 在 `session/new` 之前写好 `AGENTS.md` 和 `browser/tools.json`，这样 Agent 一进工作区就能感知读、操作和视觉方法。

## 多会话与 fork

工作区仍是一个。ACP 会话可以有多条，侧栏用本地 `id` 和 `acpSessionId` 对应。

```
chrome.storage.local
  locale: "en" | "zh"          # 默认 en
  theme: "light" | "dark" | "system"  # 默认 dark；system 跟 prefers-color-scheme
  selectedId: <local session id>
  selectedModelId?: string     # 具体模型 id；auto / 空 = 不指定，不调用 set_model
  agentMode: "ask" | "auto"    # 默认 ask；auto 自动回 permission.reply
  sessions[]:
    id, acpSessionId?, title, titleManual?, createdAt, updatedAt
    parentId?, forkedFromMessageId?
    pendingForkContext?        # 下一条 prompt 要带的节点前文
    messages[]               # assistant 带 modelId / modelName，首段流式写入时盖上；结束时写 durationMs
```

协议：

| 侧栏 → Host | Host 行为 |
|---|---|
| `session.new` | 在空闲（或新开的）ACP 进程上 `session/new`，回 `session`。不打断正在跑的进程 |
| `session.use` + `sessionId` | 该会话已在某进程上且正在跑则只回 `session`（replay），不 `session/load`；否则在空闲进程上 `session/load`，失败则 `session/new` |
| `session.fork` + `sessionId` | 在空闲进程上先试不稳定的 `session/fork`（整段历史）；失败则 `session/new` |
| `prompt` 可带 `sessionId` | 绑到已持有该会话的进程，或空闲进程 `session/load` 后再 prompt。同一会话已有一轮在跑则拒绝；不同会话并行 |
| `cancel` 可带 `sessionId` | 只取消该 ACP 会话所在进程的一轮 |
| `update` / `turn.end` / `permission` / `cursor` 带 `sessionId` | 侧栏按 ACP id 映射到本地会话，不按当前选中项 |
| `fs.pick` | Host 弹出本机选文件/文件夹对话框，回 `fs.picked`（绝对路径 + kind） |
| `fs.save` | Host 把侧栏压好的 JPEG 写到 `browser/pasted/`，回 `fs.saved`（绝对路径 + kind=image） |
| `page.pick` | SW 让当前标签内容脚本拾取元素，回 `page.picked`（CSS selector，kind=element）；不转发 Host |
| `model.set` | 非 `auto` 时 `session/set_config_option`（`category: model`）；失败再试 `session/set_model` |

从某一轮之后 fork：

1. 新本地会话，复制该消息及之前的气泡，原会话不动。
2. 若 fork 的是**最后一条**且 Agent 支持 `session/fork`，用 ACP fork，Agent 历史与 UI 对齐，不必再灌上下文。
3. 否则 `session/new`。Agent 是空会话，把截断后的对话写成 `pendingForkContext`，**下一条用户消息**前缀带上（UI 不显示这段包装）。这样 Agent 不会为了灌上下文先回一嘴。

侧栏用 `runningIds`（不持久化）记哪些本地会话有一轮在飞，不再用全局一把锁。`isRunning` 只表示**当前选中**会话在跑（输入框描边、停止钮、该会话的 fork / 重生成 / 改历史）。新建和切换始终允许；流式 `update` / `turn.end` / HITL 按消息上的 ACP `sessionId` 写回对应本地会话。切到别的会话时，若目标自己正在跑则不要再 `session.use`。权限 / 提问 / 计划按会话存放，只在看着该会话时画出来；「全部允许」仍会自动回掉所有会话里待批的权限。页面工具仍共用一个工作区，两条 Agent 同时改页面时可能打架，这是并行的取舍。会话列表里进行中的卡片旁转圈提示。

重新生成（同一会话抽卡）：

1. 只挂在 Agent 回复底部，和 Fork 同一行，整行居左（Fork 左、刷新右）。用户气泡不放这两个按钮。
2. 截掉该条 assistant 及之后的消息，保留对应的用户气泡和附件。
3. 当前会话 `session/new` 换一条空 ACP 会话：旧会话里已有上次回复，再 prompt 会叠一层，抽卡不干净。
4. 该用户消息之前的记录写成 `pendingForkContext` 同款前文，立刻把同一条用户正文 / 附件再 `prompt`。新会话上重套当前模型（清掉 `appliedModelRef`，等 `models` 再 `model.set`）。
5. 界面不新增用户气泡，等流式 `update` 长出新的 assistant。

改已发送的用户消息：

1. 点用户气泡（`isRunning` 时忽略）把 `textOf` + `attachments` 填回 composer，并记住 `editingId`。若输入栏里已有未发送草稿，先 stash，取消时还原。
2. composer 顶部一行：左 muted 提示，右 `RippleButton` 黄铜字「取消修改 / Cancel edit」。
3. 再发送走同一套 `startReplayTurn`：用新正文/附件替换该 user，截掉其后，`session/new` + 前文再 prompt。不另开本地会话。
4. 切会话时退出编辑态；当前会话进行中不允许进入。

旧的 `session.json` `{ sessionId }` 在侧栏还没有本地目录时，迁成第一条会话。

## 语言

`packages/extension/src/sidepanel/i18n.ts` 提供 `en` / `zh` 词条。默认 `en`。完整 state 仍写 `chrome.storage.local`；切换时同步镜像 `localStorage` 的 `cursor-sidebar/locale`。`theme-boot.js` 同时读这份镜像并设 `document.documentElement.lang`，避免每次打开先闪英文。React 初始 state 也从镜像读。连接错误原文（Host / Chrome `lastError`）不翻译。

## 主题

`theme.ts`：偏好 `light | dark | system`，解析后给 `document.documentElement.dataset.theme`。`system` 时听 `prefers-color-scheme`。完整 state 仍写 `chrome.storage.local`（`theme` 必填）；切换时同步镜像 `localStorage` 的 `cursor-sidebar/theme`。`index.html` 用 `public/theme-boot.js`（非 inline，避免 MV3 CSP；Vite 拷到扩展根）在 React 之前读这份镜像并设 `data-theme`，避免每次打开先闪默认深色。React 初始 state 也从镜像读，`useLayoutEffect` 再 apply。颜色全走 CSS 变量：`:root` / `[data-theme=dark]` 是现有橄榄黑；`[data-theme=light]` 是中性浅灰层次（画布 `--ink` `#f3f4f6` → 抬升 `--panel` 近白 → 凹陷 `--panel-2`），少蓝、少脏；正文冷灰黑（muted 用石板灰）+ 钢蓝强调（仍走 `--brass` token）。`--hover` / `--code` / `--user` / `--on-brass` / `--overlay` 两套分开，组件不再写死 `#161910` 这类只适合深色的底。Mermaid 按解析后的主题重 `initialize`。顶栏 `Sun` / `Moon` / `Monitor` 循环三态。

## 附件（只传路径）

Chrome 的文件选择器不会给出本机绝对路径。加号因此发给 Host `fs.pick`。`install-host` 用 `swiftc` 编 `PickFiles.app`（常规激活策略，能到前台）放到 `~/.cursor-sidebar/runtime/`。Host **直接 exec** 包内二进制（不用 `open -W`，Chrome 子进程里 `open` 经常立刻返回、面板也不出现）。面板可同时选文件和文件夹、可多选；若进程在 400ms 内空退，再退回访达 `choose file`。`fs.stat` 分成 `image` / `file` / `folder`。侧栏芯片只展示 `basename`，`title` 是全路径。未连上就点加号，侧栏写明确错误。

剪贴板里的截图同样没有本机路径，不能当文件选。composer `paste` 若带 `image/*`，先按页面截图那套压成 JPEG（最长边约 1280、质量约 0.72、base64 &lt; 700KB，以免 Native Messaging 超 1MB），再 `fs.save` 落到 `~/.cursor-sidebar/workspace/browser/pasted/`。回包后当普通 `kind: image` 芯片，走同一套 `wrapAttachments`。Chrome 会把同一张图同时挂在 `clipboardData.files` 和 `items` 上，且 `getAsFile()` 的 `lastModified` 往往对不上，按 name/size/mtime 去重会漏。`clipboardImages` 只读 `files` 里的图片；没有才退到 `items`。有图时 `preventDefault`，避免二进制糊进 textarea；若同时带纯文本则插到光标处。落盘完成前不让发送，以免消息先走、图还没进附件。未连上或压图/写盘失败写明确错误。

`session/prompt` 在用户正文后追加：

```
[Attachments]
Local paths. Read these files or folders if needed.
- /abs/path/photo.png
- /abs/path/src
```

不把文件内容塞进 Native Messaging。用户气泡可带同样的芯片，方便回看。未发送的芯片只活在输入栏 state 里。

拾取元素不经过 Host：侧栏 `page.pick` → SW → 当前标签内容脚本。侧栏遮罩挂在 `App` 根上（`fixed inset-0` + `backdrop-blur`），盖住顶栏和会话列表，不因 ChatPane 高度裁切；点遮罩不取消。SW 用 `lastFocusedWindow` 找普通 http(s) 标签，`sendMessage` 失败则 `chrome.scripting.executeScript` 注入 manifest 里的内容脚本再试（扩展重载后旧标签默认没有脚本）。点中后回 `page.picked`，芯片 `kind: element`，`path`/`name` 都是唯一 CSS selector。Prompt 另附：

```
[Picked page elements]
The user picked these elements on the current browser tab. Inspect or operate
on them with page tools using args.selector.
- html > body > main > button:nth-of-type(2)
```

## 模型选择

1. Host 启动时跑 `agent models`（与 `agent --list-models` 相同），解析 `id - name` 行，按 id 去重后推 `models` 给侧栏。目录初始为空，不预置 Auto。
2. `initialize` 带 `_meta.parameterizedModelPicker: true`，以便 Cursor ACP 返回 `configOptions`。
3. `session/new|load|fork` 若带 `category: "model"` 的选项，用其 `currentValue` 和名称覆盖/补全列表。
4. 用户改模型：`session/set_config_option`（发现的 `configId`，通常是 `model`）；失败则 `session/set_model`。`auto` / 空不是合法 ACP 值，跳过 RPC。
5. 侧栏只在 `status === ready` 且列表非空时渲染下拉。连上后若列表含 `auto` 且用户没有已记住的具体模型，选中态为 `auto`。`selectedModelId` 写入 `chrome.storage.local`；仅当选的是具体模型时再 `model.set`。
6. 下拉外壳不滚：顶部是固定筛选 `input`（无边框 / outline / ring），`open` 后 `focus()`；下面才是 `overflow-y-auto` 的条目。筛选只对已加载的 `models` 做 `name` / `id` 的 `toLowerCase().includes`，不另发请求。关掉下拉清空关键词。`ArrowDown` / `ArrowUp` 在 `visible` 上取模换 `highlightId`（打开时落在当前模型），`scrollIntoView({ block: "nearest" })` 跟滚；`Enter` 对高亮项 `onModel` 并关下拉。中文 placeholder 为「筛选...」。

## 权限模式

`agentMode`：`ask`（默认）弹 HITL 卡片；`auto` 在收到 `permission` 时按 option 文案/id 打分，优先 always / 其次 once，立刻 `permission.reply`，不渲染卡片。提问和计划仍走 HITL。切到 `auto` 时若已有待确认权限，同一套逻辑马上回。输入栏 `ModeSelect` 向上弹出，每项标题 + `text-[11px] text-[var(--muted)]` 解释（文案对齐 Copilot 前两项：Default permissions / Allow all）；点选后关闭。

## 标签切换

1. SW 收到 `onActivated` / 完整 URL `onUpdated`
2. 向该 tab 的内容脚本要 `getMeta` + `getReadable`
3. 发给 Host：`page.update`
4. Host 写 `browser/current.json` 和 `browser/snapshot.md`
5. Side Panel 更新顶栏右侧 favicon（`favIconUrl` 由 SW 从 `chrome.tabs` 并进 `CurrentPage`，不写进 workspace）
6. 下一条 `session/prompt` 在用户文本前加一行 `[Current tab] {title} — {url}`（UI 不显示这行）
7. 若有文件附件，再追加 `[Attachments]` 绝对路径；若有拾取的元素，再追加 `[Picked page elements]` 和 CSS selector，并写明用页面工具的 `args.selector` 去查看或操作（UI 气泡里只显示用户正文和芯片）

不在切换时往会话里塞一条用户消息，以免污染对话。Agent 需要更多页面内容时，按 `AGENTS.md` 读 snapshot 或写命令文件。

## ACP 映射

Host 是 ACP Client，`clientCapabilities` 关闭 `fs` / `terminal`，让 Agent 自己在工作区里用本地工具。

| ACP | 侧栏 |
|---|---|
| `agent_message_chunk` | 只追加到**末尾**的 assistant；若末尾是 user 则先新建一条。禁止写进上一轮 assistant（否则新用户气泡会被往下挤） |
| `agent_thought_chunk` | reasoning part；展示时去掉空行，原文仍按流式存 |
| `tool_call` / `tool_call_update` | tool-call part（title、kind、status、input、output、diff） |
| `session/request_permission` | 权限卡片（输入框上方，正文 `max-height: 9.5lh`） |
| `cursor/ask_question` | 选择题 |
| `cursor/create_plan` | 计划审批 |
| `cursor/update_todos` | 输入框上方可折叠 TodoList |
| `cursor/task` | 子任务卡片 |
| `session/prompt` 结束 | 对应本地会话移出 `runningIds`，给**该会话**末尾 assistant 打上 `durationMs` |

消息状态由 Side Panel 持有并持久化。Host 重启后 `session/load` 只负责恢复 Agent 侧上下文；Panel 以本地存储的消息为准，不因为 `replay` 清空界面。

## 扩展身份

未打包扩展的 ID 必须稳定，Native Messaging 的 `allowed_origins` 才能写死。`manifest.json` 带固定 `key`，ID 为 `gcblddgaifebccglndkaccmibhechimj`。

Host 注册名：`com.cursor.sidebar.host`  
macOS 清单路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cursor.sidebar.host.json`

`pnpm install-host`（`pnpm build` 也会跑）把 `packages/host` 和 `packages/shared` 的源码拷到 `~/.cursor-sidebar/runtime/`，再生成带本机 Node 绝对路径的启动脚本。Chrome 的 Native Messaging 清单 `path` 指向这份副本，而不是 Desktop 仓库里的脚本：macOS TCC 会拦 Chrome 执行 Desktop / Documents / Downloads 下的文件，Chrome 只报 `Native host has exited`，宿主日志也不会出现。nvm 的 `node` 也必须写绝对路径，因为 Chrome 拉起 Host 时 PATH 很瘦。Host 日志只写 `~/.cursor-sidebar/host.log`，不写 stderr，避免 Chrome 把 stderr 当成协议失败。

## UI

- Agent 回复链接：`Markdown` 自定义 `a`，一律 `preventDefault`（侧栏是扩展页，默认点击会把面板自己导航走）。解析 `href`（相对地址相对当前页），只放行 `http(s)`。把主机名小写、去掉末尾 `.`、剥一层前导 `www.` 后和当前标签 `page.url` 比；相同且 `page.tabId` 仍在则 `chrome.tabs.update`，否则 `chrome.tabs.create`。`www.example.com` 与 `example.com` 算同域，`docs.example.com` 与 `example.com` 不算。侧栏已有 `tabs` 权限，不经 Host。计划条里的 Markdown 同一套逻辑。
- 聊天：`ChatPane` 由当前会话的 `messages` / `isRunning` 驱动；消息列表滚动容器 `flex-col-reverse` + 内层正序消息（工业界贴底：`scrollTop === 0` 就是底部，流式长高不必每帧 `scrollTo`；用户上翻后 `scrollTop` 变负，不再被新内容拽走；滚回距底 &lt; 96px 又贴住）。`column-reverse` 会把唯一子项吸在底：在消息块**之前**插一个 `flex-1 min-h-0` 占位（DOM 里先写占位、后写消息，视觉上占位在下、消息在上），内容不够高时把第一条顶到消息区顶部；撑满后占位收成 0，恢复贴底滚动。「回到底部」不读 `scrollTop` 正负（`col-reverse` 贴底是 0、上翻变负、外滚变正，经过 0 会先显后隐再显）。消息列末尾放 1px sentinel，`IntersectionObserver` 以 `.cs-thread` 为 root、`rootMargin` 底部扩 96px：相交则贴底附近，不相交才稳定显示按钮。离开底部才在输入区上方绝对定位一层 `ArrowDown` 圆钮（约 39px，原 56 的 0.7）：外包一层 `absolute inset-x-0 bottom-full` 居中，避免 `IconButton` 自带的 `relative` 把 `absolute` 顶掉、占满一行。半透明 `--panel` 底、轻投影，hover 提高不透明度，沿用 `IconButton` 涟漪。用户气泡 `w-fit max-w-[80%] ml-auto`，相对消息列表内容区收缩；工具调用和思考不再用带边框的 `details` 卡片，与过程收起同一套 `TextFold`：灰字 + 可选 lucide 图标（`text-[var(--muted)]`）+ 紧挨着的箭头。点开后 `FadeScroll` 用 `max-height` 限高、内容不够则贴内容（过程区 `max-h-[min(36vh,16rem)]`，工具 / 思考 `max-height: 5lh`，约 5 行 11px 灰字），`mix-blend-mode` 上下遮罩。`flex-col-reverse` 下展开用 `scrollTop` 把灰字钉住。markdown 仍是现有组件。`Markdown` 对 ` ```mermaid ` 围栏动态加载 `mermaid` 再 `render` 成 SVG（`securityLevel: strict`、`suppressErrorRendering: true`、暗色黄铜主题），约 160ms 防抖。先 `parse`，通过才 `render`；失败或流式半截仍走原来的 `pre > code`，并清掉 mermaid 挂到 `body` 上的 error SVG（默认会插「Syntax error in text」炸弹图，把输入框顶上去）。`body` 也 `overflow: hidden`，漏网节点不能撑高侧栏。进行中不再在消息底插「Agent is working」转圈，只靠 `.cs-composer.is-running` 描边。权限 / 提问 / 计划走 `PermissionBar`，作为 `hitl` 插在消息列表和输入框之间（不在输入框下面）；正文 `max-height: 9.5lh` 可滚，按钮露在外面。`TodoList` 同样插在输入框上方（`hitl` 之上）：标题「Todo List - done/total」，整行切换折叠，右侧 `ChevronRight` / `ChevronDown`；完成项右侧 `CircleCheck`（`--ok`）。用 `id+content` 签名检测新规划，变化则 `open=true`，只改 status 不弹开。输入区：可选附件芯片 → textarea（默认 `2lh + padding`，`useLayoutEffect` 按 `scrollHeight` 长高，封顶 `10lh + padding` 后 `overflow-y: auto`；镜像节点量 caret `offsetTop`，编辑 / 粘贴 / 方向键都把光标行滚进视口）→ 第二行左 Lucide `MousePointer2` 拾取 + `Plus` + 权限模式（`ModeSelect`：`Shield` 确认 / `Zap` 无人值守，菜单项含灰色解释，`agentMode` 写入 storage）+ 右模型下拉（仅 `ready` 且列表非空；顶部固定筛选框，打开即聚焦，不区分大小写过滤已加载列表；上下键循环高亮并滚入视口，回车切换）+ `Send` 小飞机 / 停止（14px，与顶栏 icon 同大；hover 半透明白圆）。`isRunning` 时 `.cs-composer` 用 `@property --cs-spin`：圆锥渐变经 mask 只画 1px 描边，opacity 淡入铺满 360°，再 4s linear 转一圈；结束只淡出 opacity，sweep 保持满圈以免描边收起。`prefers-reduced-motion` 时只铺满不转。工具卡片标题用 `toolTitle(locale, part)`：按 `kind` 与常见英文前缀映射到 i18n，后面的路径/查询不翻译。拾取时 `App` 全栏模糊遮罩 + 居中提示，完成或 Esc 才收。`IconButton` 的 tooltip 用 `position: fixed` 挂到 `document.body`，按锚点测量后翻边/平移，与视口保持 8px。除顶栏外，按钮统一 `hover:bg-[var(--hover)]` + CSS 涟漪（`RippleButton` / `IconButton`）。芯片统一 `max-width: 200px`（文件 / 文件夹 / 图片 / 拾取元素相同），文案 `truncate`，`title` 为完整路径或 selector。
- 顶栏：左语言按钮（英显示「中」、中显示「EN」）+ 开关灯（`Sun` / `Moon` / `Monitor`，tooltip 浅色 / 深色 / 跟随设备）。会话名与列表按钮绝对居中成一组（标题左、按钮右）；`max-width` 按左右簇各留 32px 用 `ResizeObserver` 算，标题 `whitespace-nowrap truncate`，`title` 为全文。按钮始终 Lucide `MessageCirclePlus`（tooltip「会话 / Sessions」），打开居中 `SessionModal`。右无边框连接状态与 offline「Connection / 重连」（icon 已是重试语义），再跟当前页 favicon（无 banner）。favicon 用 `IconButton` 两行 tooltip：标题 + 完整 URL；取不到图标时用 `Globe`。顶栏按钮不加涟漪。
- 会话列表是遮罩模态（无关闭钮、无底栏）：顶行左 `MessageSquarePlus` + 新建文案、右无边框筛选；列表按 `updatedAt` 倒序，标题包含匹配。面板 `max-h-[calc(100dvh-400px)]` 上下各留 200px，列表内部滚。`ArrowUp`/`ArrowDown` 循环高亮并 `scrollIntoView({ block: "nearest" })`，`Enter` 切换并关闭，Esc / 点遮罩关闭。卡片上 Pencil / Trash2；`titleManual` 为真时不再用首条消息改标题
- 空会话：消息区垂直居中，Lucide `MessageSquareMore` 约 120px + 一行淡灰提示，不抢视觉。提示不再 `max-w-16rem`，而是 `w-full` + `padding-inline: min(200px, max(1rem, 50% - 12rem))`：宽时两侧约 200px、一句不折；窄侧栏再收 padding 并允许换行
- 一轮开始记 `turnStartedAt`；`turn.end` / 停止 / 连接报错结束时，若末尾 assistant 的 `createdAt` 不早于开始时间，写入 `durationMs` 并持久化。`AssistantMessage`：找最后一段 `type=text`，它之前是过程。`isRunning` 且该条是最后一条时不收成耗时行：`liveVisibleParts` 把连续的 `reasoning` / `tool-call`（中间没有 `text`）收成只渲最后一条，同一行被新步骤替换。结束后默认收起过程，只留正文；用户展开耗时行时再按原顺序把每一步各占一行。耗时行、思考、工具调用共用 `TextFold`：无底透明全宽 `button`，muted 12px 文案 + 可选 kind 图标 + 紧挨着的箭头（`inline-flex`，不要 `justify-between`）。收起时 `ChevronRight` 仅该行 hover 出现（`group/fold`，避免吃到 `MessageFrame` 的 `group`）；展开后换成 `ChevronDown`。过程区走 `.cs-process-scroll`（只设 `max-height`），思考 / 工具内容走 `max-height: 5lh` 的 `.cs-fold-scroll`。线程是 `flex-col-reverse` 贴底，展开会长高把灰字顶上去：toggle 前记下 `getBoundingClientRect().top`，`useLayoutEffect` 里给 `.cs-thread` 的 `scrollTop` 加上位移，把灰字钉回原处，看起来是向下展开。滚动盒由 `FadeScroll` 包一层 `isolation: isolate`，上下各一条 `mix-blend-mode` 渐变（深色 `multiply`、浅色 `lighten`，色用 `--ink`）；`scrollTop>2` 才显示顶遮罩，距底 `>2` 才显示底遮罩。没有过程（只有正文）不渲染这一行。
- Agent 回复底部 hover 才出现一行（`MessageFrame` 用 `group/msg`，避免和折叠箭头抢未命名 `group`）：左灰色「由 {name} 生成 / Generated by {name}」，右无边框 `Copy` + `GitFork` + `RefreshCw`（`justify-between`）。复制取 `lastTextIndex` 之后的 `type=text`（有过程折起时就是可见正文），`navigator.clipboard.writeText`，不含 reasoning / tool-call。`isRunning` 且该条是最后一条时不渲染这一行。用户气泡 `mt-6`，其余消息 `mt-3`。用户气泡不放操作钮。模型名在本轮第一条 assistant 落盘时写入 `modelId` / `modelName`
- 视觉：窄侧栏（约 380px）、深色橄榄黑 / 浅色中性浅灰层次、深色黄铜 / 浅色钢蓝强调；图标只用 `lucide-react`
- 字体：IBM Plex Sans / Mono（中英都不用衬线体）
- 工具行左侧按 ACP `kind` 换 lucide 图标：read / edit / execute / search / fetch 等，颜色跟灰字走。`pending` / `in_progress` 时只渲 `LoaderCircle`，结束后才换回 kind 图标，二者不同时出现

## 品牌图标

- 源文件 `packages/extension/assets/icon.svg` 由 `scripts/generate_icon.py` 生成，勿手改：Cursor 官方 CUBE_2D 复合路径做 clipPath（nonzero 规则中央光标自动镂空），360 个 1° 扇形逼近 conic 渐变，实现红→黄→绿顺时针风车，交界 40° smoothstep 平滑过渡
- PNG 用 `rsvg-convert` 从 SVG 导出（16/32/48/128，保留透明），放 `packages/extension/public/icons/`，crxjs 构建时拷到 `dist/icons/`
- manifest 的 `icons` 与 `action.default_icon` 都指向这四张图

## 仓库结构

```
packages/shared     扩展 ↔ Host 消息类型
packages/host       Native Messaging Host + ACP Client
packages/extension  Chrome MV3（background / content / sidepanel）
scripts/            安装 Host、构建
```

pnpm workspace。扩展用 Vite + `@crxjs/vite-plugin` 打包。

## 风险

| 风险 | 处理 |
|---|---|
| Native Messaging 环境 PATH 很瘦 | 默认调用 `~/.local/bin/agent`，可覆盖 |
| macOS 拦 Chrome 执行 Desktop 上的 Host | `install-host` 把运行副本放到 `~/.cursor-sidebar/runtime` |
| 未登录 | 侧栏提示先跑 `agent login` |
| `session/load` 不支持或失败 | 新建 ACP 会话，界面历史保留，下一条消息带前文 |
| `session/fork` 不可用或不支持指定消息 | 新会话 + 首条 prompt 前缀截断记录 |
| chrome.storage 变大 | 工具输出超长时截断再写入 |
| 内容脚本无法注入 | `current.json` 只写 url/title，命令返回明确错误 |
| Chrome 杀 Service Worker | 重连 Native Host；ACP 子进程随 Host 退出，重连后 load/new |
| 侧栏晚于 Host ready 才连上 | SW 回放最近状态 |
| React StrictMode 拆掉端口后再 postMessage | 页面存活期间不拆端口；卸载只摘监听器 |
| 侧栏 connect 时 SW 还在加载 crx loader | 先 ping 再 connect；空断后自动重连 |
| 重试无效 | 强制重连 Native Host；`connect` 唤醒 SW，失败原因写到顶栏 |
| 发消息无反馈 | 输入和 isRunning 由 App state 驱动，不走 useAuiState |
| 命令文件误触发 | 只认 `browser/commands/*.json` 且含 `id`+白名单 `method` |
| 受控输入收不到赋值 | fill/type 用原生 value setter + input/change |
| 点击找不到可点目标 | 同时支持 selector 与可见文本，失败返回明确错误 |
| 导航后内容脚本被卸掉 | 标签级导航走 `chrome.tabs.update`，完成后再抓快照 |
| 系统页无法拾取 | chrome:// 等直接报错；Esc / 再点拾取取消 |
| 截图超过 Native Messaging 1MB | JPEG + 最长边 1280 + 质量下调；只传 base64，落盘后再给 Agent 路径 |
| 元素截图像素比不对 | 用 `devicePixelRatio` 把 CSS 盒映射到截图像素 |
| 扩展选文件没有真路径 | Host 用 `PickFiles.app`（`open -W`）弹出访达多选，回绝对路径 |
| Chrome 子进程弹不出 NSOpenPanel | 直接 exec `PickFiles`（regular 激活）到前台；空退则访达 `choose file` |
| 点拾取后旧标签没有内容脚本 | SW `scripting.executeScript` 按 manifest 补注入 |
| ACP 不广告模型列表 | 用 `agent models` 解析账号模型；有 `configOptions` 时合并并用于 set |
| `session/set_model` 被拒 | 先 `session/set_config_option`；initialize 声明 `parameterizedModelPicker` |
| ACP 拒绝 `auto` | Auto 只表示不指定；不调用 set_model / set_config_option |
