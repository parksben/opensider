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
- 工具卡片 / markdown 仍复用现有展示组件
- 发出用户输入（可带本机附件路径）、取消、权限决定、提问/计划回答、新建 / 切换 / fork 会话、选模型
- 展示当前页、进行中的页面命令、连接状态、todo、权限条、输入栏附件芯片、元素拾取蒙层与模型下拉
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
- 把 Side Panel 的 prompt/cancel/permission、会话新建 / 切换 / fork、模型切换转成 ACP
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
  selectedId: <local session id>
  selectedModelId?: string     # 具体模型 id；auto / 空 = 不指定，不调用 set_model
  sessions[]:
    id, acpSessionId?, title, titleManual?, createdAt, updatedAt
    parentId?, forkedFromMessageId?
    pendingForkContext?        # 下一条 prompt 要带的节点前文
    messages[]
```

协议：

| 侧栏 → Host | Host 行为 |
|---|---|
| `session.new` | `session/new`，设为当前，回 `session` |
| `session.use` + `sessionId` | 已是当前则 noop；否则 `session/load`，失败则 `session/new` |
| `session.fork` + `sessionId` | 先试不稳定的 `session/fork`（整段历史）；失败则 `session/new` |
| `prompt` 可带 `sessionId` | 先切到该 ACP 会话再 prompt，避免切换竞态 |
| `fs.pick` | Host 弹出本机选文件/文件夹对话框，回 `fs.picked`（绝对路径 + kind） |
| `page.pick` | SW 让当前标签内容脚本拾取元素，回 `page.picked`（CSS selector，kind=element）；不转发 Host |
| `model.set` | 非 `auto` 时 `session/set_config_option`（`category: model`）；失败再试 `session/set_model` |

从某一轮之后 fork：

1. 新本地会话，复制该消息及之前的气泡，原会话不动。
2. 若 fork 的是**最后一条**且 Agent 支持 `session/fork`，用 ACP fork，Agent 历史与 UI 对齐，不必再灌上下文。
3. 否则 `session/new`。Agent 是空会话，把截断后的对话写成 `pendingForkContext`，**下一条用户消息**前缀带上（UI 不显示这段包装）。这样 Agent 不会为了灌上下文先回一嘴。

`isRunning` 时拒绝 new / switch / fork / regenerate。流式 `update` 只写进当前选中会话。

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
4. 切会话时退出编辑态；进行中不允许进入。

旧的 `session.json` `{ sessionId }` 在侧栏还没有本地目录时，迁成第一条会话。

## 语言

`packages/extension/src/sidepanel/i18n.ts` 提供 `en` / `zh` 词条。默认 `en`。切换后立刻写 `chrome.storage.local`，并设 `document.documentElement.lang`。连接错误原文（Host / Chrome `lastError`）不翻译。

## 附件（只传路径）

Chrome 的文件选择器不会给出本机绝对路径。加号因此发给 Host `fs.pick`。`install-host` 用 `swiftc` 编 `PickFiles.app`（常规激活策略，能到前台）放到 `~/.cursor-sidebar/runtime/`。Host **直接 exec** 包内二进制（不用 `open -W`，Chrome 子进程里 `open` 经常立刻返回、面板也不出现）。面板可同时选文件和文件夹、可多选；若进程在 400ms 内空退，再退回访达 `choose file`。`fs.stat` 分成 `image` / `file` / `folder`。侧栏芯片只展示 `basename`，`title` 是全路径。未连上就点加号，侧栏写明确错误。

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

## 标签切换

1. SW 收到 `onActivated` / 完整 URL `onUpdated`
2. 向该 tab 的内容脚本要 `getMeta` + `getReadable`
3. 发给 Host：`page.update`
4. Host 写 `browser/current.json` 和 `browser/snapshot.md`
5. Side Panel 更新顶栏
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
| `session/request_permission` | 权限条 |
| `cursor/ask_question` | 选择题 |
| `cursor/create_plan` | 计划审批 |
| `cursor/update_todos` | 顶栏 todo |
| `cursor/task` | 子任务卡片 |
| `session/prompt` 结束 | 本轮 `isRunning=false` |

消息状态由 Side Panel 持有并持久化。Host 重启后 `session/load` 只负责恢复 Agent 侧上下文；Panel 以本地存储的消息为准，不因为 `replay` 清空界面。

## 扩展身份

未打包扩展的 ID 必须稳定，Native Messaging 的 `allowed_origins` 才能写死。`manifest.json` 带固定 `key`，ID 为 `gcblddgaifebccglndkaccmibhechimj`。

Host 注册名：`com.cursor.sidebar.host`  
macOS 清单路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cursor.sidebar.host.json`

`pnpm install-host`（`pnpm build` 也会跑）把 `packages/host` 和 `packages/shared` 的源码拷到 `~/.cursor-sidebar/runtime/`，再生成带本机 Node 绝对路径的启动脚本。Chrome 的 Native Messaging 清单 `path` 指向这份副本，而不是 Desktop 仓库里的脚本：macOS TCC 会拦 Chrome 执行 Desktop / Documents / Downloads 下的文件，Chrome 只报 `Native host has exited`，宿主日志也不会出现。nvm 的 `node` 也必须写绝对路径，因为 Chrome 拉起 Host 时 PATH 很瘦。Host 日志只写 `~/.cursor-sidebar/host.log`，不写 stderr，避免 Chrome 把 stderr 当成协议失败。

## UI

- 聊天：`ChatPane` 由当前会话的 `messages` / `isRunning` 驱动；用户气泡 `w-fit max-w-[80%] ml-auto`，相对消息列表内容区收缩；工具卡片 / markdown 仍是现有组件。输入区：可选附件芯片 → textarea → 第二行左 Lucide `MousePointer2` 拾取 + `Plus`、右模型下拉（仅 `ready` 且列表非空）+ `Send` 小飞机 / 停止（14px，与顶栏 icon 同大；hover 半透明白圆）。`isRunning` 时 `.cs-composer` 用 `@property --cs-spin`：圆锥渐变经 mask 只画 1px 描边，opacity 淡入铺满 360°，再 4s linear 转一圈；结束只淡出 opacity，sweep 保持满圈以免描边收起。`prefers-reduced-motion` 时只铺满不转。工具卡片标题用 `toolTitle(locale, part)`：按 `kind` 与常见英文前缀映射到 i18n，后面的路径/查询不翻译。拾取时 `App` 全栏模糊遮罩 + 居中提示，完成或 Esc 才收。`IconButton` 的 tooltip 用 `position: fixed` 挂到 `document.body`，按锚点测量后翻边/平移，与视口保持 8px。除顶栏外，按钮统一 `hover:bg-white/15` + CSS 涟漪（`RippleButton` / `IconButton`）。芯片统一 `max-width: 200px`（文件 / 文件夹 / 图片 / 拾取元素相同），文案 `truncate`，`title` 为完整路径或 selector。
- 顶栏：左会话开关（收起时 Lucide `MessageSquarePlus` 气泡加号，tooltip「会话 / Sessions」；展开时 `PanelLeftClose`，tooltip「收起列表 / Collapse list」）+ 语言按钮（英显示「中」、中显示「EN」）；正中会话名；右连接状态与 offline「Connection / 重连」（icon 已是重试语义）。顶栏按钮不加涟漪。
- 会话列表是主区域左侧栏：新建、卡片上 Pencil / Trash2 重命名与删除；`titleManual` 为真时不再用首条消息改标题
- 空会话：消息区垂直居中，Lucide `MessageCircle` 约 120px + 一行淡灰提示，不抢视觉
- Agent 回复底部用 lucide 的 `GitFork` + `RefreshCw`，整行居左；fork tooltip「从此处复制新会话 / Fork from here」，刷新 tooltip「重新生成 / Regenerate」。用户气泡不放操作钮
- 视觉：窄侧栏（约 380px）、橄榄黑底、黄铜强调色；图标只用 `lucide-react`
- 字体：IBM Plex Sans / Mono（中英都不用衬线体）
- 工具卡片按 ACP `kind` 换图标：read / edit / execute / search / fetch 等

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
