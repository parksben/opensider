# OpenSider — 技术设计

> 产品名 OpenSider。Chromium 扩展通过 Native Messaging 托管 `agent acp`；页面感知用内容脚本 + 工作区文件，不使用 MCP，不运行常驻本地服务。Host 是一份预编译 Go 二进制（`cmd/opensider`：无参=Host，`install`，`pick`）。对外名称、包名、Native Host、本机目录和 storage key 都用 `opensider` / `com.opensider.host` / `~/.opensider`。不迁旧目录 `~/.cursor-sidebar`。

## 总览

```
Chrome Side Panel (ChatPane)
        │ chrome.runtime
Service Worker
        │ Native Messaging (stdio, Chrome 按需拉起)
Native Host
        ├─ child process: `agent acp`   (JSON-RPC over stdio)
        └─ 工作区文件: ~/.opensider/workspace
               browser/current.json
               browser/snapshot.md
               browser/interactive.md
               browser/commands/*.json
               browser/results/*.json
               AGENTS.md
               outputs/              # 用户可见产物（引导，不拦截写入）

Content Script  ←── 当前标签的读取 / 操作方法
Service Worker  ←── navigate / goBack / goForward / reload
```

浏览器扩展不能 spawn 本机进程。Cursor CLI 的自定义客户端协议是 ACP（`agent acp`，stdio JSON-RPC）。二者之间只加一层 **Chrome Native Messaging Host**（Go 二进制 `opensider`）：浏览器在扩展连接时启动它，断开后退出。用户不必先开一个 Node 服务，本机也不需要 Node。

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
- 发出用户输入（可带本机附件路径）、取消、权限决定、提问/计划回答、新建 / 切换 / fork 会话、选模型；进行中再发送的消息进该会话内存队列，`turn.end` 后按序发出
- 展示进行中的页面命令、无边框连接状态、连接进度条（文案右侧「取消 / Cancel」）、输入框上方的 todo、消息队列与权限/提问/计划卡片、输入栏附件芯片、`@` 提及菜单、元素拾取蒙层与模型下拉。顶栏不放当前页 favicon。
- 离线发送会立刻报错；Service Worker 断开时显示原因（含扩展 ID / `lastError`）并允许重试
- 侧栏先 `sendMessage({ type: "ping" })` 唤醒 SW，再 `connect`。React StrictMode 卸载只摘监听器，不拆端口。端口若在 SW 还在加载时空断，自动重连，避免永远停在 Lost connection
- 不再挂载 assistant-ui runtime；旧的 `ExternalStoreThreadRuntimeCore` 会在端口断开后抛错，把扩展标红

### Service Worker

- Service Worker 一启动就 `connectNative`，不依赖侧栏先连上；`ping` / `onConnect` 也会再拉一次，避免第一次 `connect` 落在 listener 注册之前
- `chrome.runtime.connectNative` 连接 Host；重试时强制拆掉旧端口再连，避免僵尸 `nativePort` 让 `if (nativePort) return` 直接跳过
- `starting` 有看门狗：连上后约 10s 还没离开 starting，广播 `error`（附 `~/.opensider/host.log`），避免点 Connection 空转。若已经收到非空 `agents`，看门狗直接当 detect 完成（回放名单并视为 idle），不要再报 starting。侧栏「没有找到 CLI」只在收到过 `agents` 且为空时出现。
- 往 Native / 侧栏端口发消息一律 try/catch，断开时清掉引用并写出 `chrome.runtime.lastError`
- 缓存最近一次 `status` / `session` / `page` / `models`，侧栏 `onConnect` 或 `ping` 时立即回放，避免 Host 已 ready 但面板因 React StrictMode 重挂而一直显示离线。连接中的空 `models` 不写入缓存（那是还在加载，不是确认空名单）。Host 在 `hello` 且已 `ready` 时再推一次 catalog。
- 在 Side Panel、Content Script、Host 之间转发消息；`page.pick` 只走内容脚本，不进 Native Host。内容脚本 `run_at: document_start`，避免 YouTube `/watch` 迟迟不到 `document_idle`。先在活动主框探测 `__opensiderPage` API，失败则 `executeScript` 补注入（`injectImmediately`，先 `allFrames` 再退回主框），并轮询等到 CRXJS loader 的 `import()` 挂上 API。**页面命令、快照、量测、未保存探测与拾取走同一通道**：就绪后在**当前活动文档的主框**里直接调用 `runCommand` / `snapshot` / `measure` / `viewport` / `startPick`。不用 `tabs.sendMessage` 做页面 RPC：扩展重载后旧标签内容脚本已成孤儿、CRXJS loader 尚未 `import`、YouTube 预渲染文档都会变成 `Receiving end does not exist`。`dispatchCommand` 的目标标签与 `current.json` 相同——焦点普通窗口的活动标签，不用 Service Worker 的 `currentWindow`。YouTube / youtu.be 是普通 http(s)，不当系统页。系统页不注入，命令回明确 restricted 错误；http(s) 注入失败则 `ok: false` 并写清原因。`requestPage` 同样先 ensure 再 snapshot，避免 `snapshot.md` / `interactive.md` 只剩 url/title。
- 监听 `tabs.onActivated` / `onUpdated` / `onRemoved` / `onReplaced` / `onCreated` / `onMoved` / `onAttached` / `onDetached` 以及 `windows.onFocusChanged` / `onRemoved`。活动标签可能变化时，解析焦点普通窗口里当前 `active` 的标签（不要用刚关掉的 tabId），立刻并在 250ms 防抖后再推 `page.update`，同时防抖写 `tabs.update`。Chrome 关掉活动标签后不一定再发 `onActivated`，所以 `onRemoved` 必须自己跟上替换标签，禁止 `current.json` 停在已关闭 tabId
- 点击工具栏图标打开 Side Panel（`setPanelBehavior({ openPanelOnActionClick: true })`）。manifest **没有** `default_popup`：工具栏点击不会弹出独立 action 窗，侧栏画在当前浏览器窗口里。录演示时禁止把 Side Panel 拖出窗口。
- Go Host 一启动就往 `~/.opensider/host.log` 打一行，便于判断 Chrome 有没有真正拉起 Host

### Content Script

运行在隔离世界，不往页面 `window` 挂 API，也不执行任意 JS。模块加载后把 `__opensiderPage` 挂到隔离世界 `globalThis`：`ping` / `startPick` / `stopPick` / `snapshot` / `viewport` / `measure` / `runCommand`。SW 用 `executeScript` 调这些方法，不依赖 `onMessage` 是否已经挂上。元素定位优先级：`args.index`（`interactive.md` 里从 1 起的编号）→ `args.label` / `args.name`（对到控件本身，不是 label 节点）→ `args.selector`（CSS）→ `args.text`（先按控件标签 / placeholder / name 匹配，再退回可见文本包含），可选 `args.nth`。侧栏发起 `page.pick` 时进入拾取：悬停高亮、点击生成全局唯一 CSS selector（id 优先，否则 `tag:nth-of-type` 路径，并校验 `querySelectorAll` 唯一），Esc 取消。拾取层挂 closed Shadow + 尽量 `popover` 进顶层，避免压在 YouTube `#movie_player` 下面；遮罩自己吃指针（再 `elementsFromPoint` 看底下节点），忽略开拾取后约 200ms 内的残留 pointerdown，并在 `yt-navigate-*` / `fullscreenchange` 时把层补回去。预渲染文档上的 `startPick` 直接 return。

交互快照（对齐 page-agent 的 numbered interactive elements，不引入他们的 DOM walker / 任意 JS）：

- 收集可见的 a / button / input / textarea / select / summary / contenteditable，以及 button、textbox、combobox、listbox、option、checkbox、radio、switch、tab、menuitem、slider 等 ARIA 角色；开放 Shadow Root 与同源 iframe 一并走进去。
- 过滤 `display:none` / `visibility:hidden` / `aria-hidden` / 无盒模型的节点；去掉套在已收录控件里的装饰节点；`<label>` 只在没有关联控件时单独编号。
- 每条写成 `[index] role "label" value=… placeholder=…`，并带上是否在视口内。内容脚本模块里保留 `index → HTMLElement`；元素被卸掉时按 role+label+name 回配。
- 标签切换和操作成功后写入 `browser/interactive.md`，同时叠进 `snapshot.md` 的 Interactive 段。`click` / `fill` / `fillForm` 的结果 JSON 也带最新列表，避免 Agent 复用过期编号。
- 操作光标：内容脚本在页面上挂 `#opensider-agent-cursor`（closed Shadow，`pointer-events: none`，z-index 低于拾取层）。`click` / `fill` / `hover` / `check` 等先 `scrollIntoView`，再把光标从上次位置（第一次从视口中心）按 0.2 插值滑到元素中心，到位或约 450ms 后再派发事件；点按播放涟漪并画一圈目标高亮。不引入 page-agent 的全屏拦截遮罩。`prefers-reduced-motion` 时瞬移。交互收集忽略该节点。空闲约 1.6s 后淡出。

读取：

| 方法 | 作用 |
|---|---|
| `getMeta` | url、title、description、canonical |
| `getReadable` | 正文纯文本（简单可读性抽取，截断） |
| `getInteractive` | 刷新并返回编号交互控件（text + elements） |
| `getUnsavedChanges` | 探测表单 / contenteditable / beforeunload 是否有未提交编辑 |
| `runScript` | 在当前 http(s) 标签执行 `args.code`（async 函数体）；`world` 默认 ISOLATED，可 MAIN；SW `chrome.scripting.executeScript`，超时与 JSON 结果封顶 |
| `getSelection` | 当前选区 |
| `getLinks` | 同源链接（text + href，截断条数） |
| `getOutline` | h1–h3 文本 |
| `queryText` | 一个节点的 textContent |
| `queryAll` | 匹配节点摘要；不带定位参数时等于当前交互列表 |
| `getAttribute` | `args.attribute` 对应属性 |
| `getValue` | input / textarea / select / 可填控件的当前值与标签 |
| `exists` | 是否找得到匹配节点 |

操作：

| 方法 | 作用 |
|---|---|
| `click` / `dblclick` | 滚入视口、Agent 光标滑到中心并涟漪、再按坐标派发 pointer/mouse 后点击 |
| `hover` / `focus` | 悬停或聚焦 |
| `fill` / `type` / `clear` | 填值 / 追加 / 清空：原生 setter + beforeinput/input/change；contenteditable 失败则 `execCommand`；combobox 点开再选 |
| `fillForm` | 一次填多个字段：`args.fields` 每项 `index` / `label` / `name` / `selector` + `value` |
| `select` / `check` | 原生 `<select>` 按 value 或 option 文本；自定义下拉同 `fill`；checkbox / radio / switch |
| `press` | 对焦点或指定元素派发按键（如 Enter） |
| `scroll` / `scrollIntoView` | 窗口滚动或滚到元素 |
| `waitFor` | 轮询直到元素出现，默认 8s，最长 20s |

视觉（Service Worker 截图，内容脚本只负责量元素）：

| 方法 | 作用 |
|---|---|
| `screenshot` | 当前可见视口；可选 `x,y,width,height` 裁切视口区域 |
| `screenshotElement` | 滚入视口后按元素包围盒裁切 |

`chrome.tabs.captureVisibleTab` 得到 JPEG，按 devicePixelRatio 裁切，最长边压到约 1280，质量约 0.72，保证 Native Messaging 帧小于 1MB。Host 把 base64 落成 `browser/screenshots/<id>.jpg`，结果 JSON 只保留绝对路径、宽高、mime。Agent 用已有 Read 打开该图片做视觉分析。v1 不拼整页长截图。

标签级操作由 Service Worker 执行：`navigate`（仅 http(s)）、`goBack`、`goForward`、`reload`。窗口级也走 SW（不经内容脚本）：`listTabs`、`switchTab`（`args.tabId` + 聚焦窗口）、`openTab`（`args.url` 新开标签，仅 http(s)）、`closeTab`（`args.tabId?`，默认当前活动标签）、`moveTabsToWindow`（`args.tabIds`，可选 `args.windowId`；没有则 `chrome.windows.create` 再 `tabs.move`）。`navigate` / `goBack` / `goForward` / `reload` / `closeTab` 执行前 SW 向目标标签发 `getUnsavedChanges`；若 `dirty` 且未带 `args.force=true`，返回失败并附上未保存字段摘要，迫使 Agent 改用 `openTab` 或先 `cursor/ask_question` 确认。`runScript` 由 SW 直接 `chrome.scripting.executeScript`（不经内容脚本 RPC）：`args.code` 最大约 80KB，默认 `world: "ISOLATED"`（可 `"MAIN"`），超时默认 10s、上限 20s；注入体包一层 async 函数，返回值 `JSON.stringify` 后回传，不可序列化则改成字符串。完成后刷新 `current.json`，并重写 `browser/tabs.json`。manifest 加 `windows`。

### Native Host

- Chrome / Edge / Brave 拉起 Host 时会把调用方 origin 放进 `argv`（macOS/Linux 为 `chrome-extension://<id>/`，Windows 再加窗口句柄）。`cmd/opensider` 只把 `install` / `pick` 当子命令；**剥掉 origin / `--parent-window=` / 纯数字句柄之后若没有子命令，就进 Host**。禁止把 origin 当成 unknown command 写 stderr 再 `exit 2`——那会让 Chrome 秒杀进程，侧栏永远收不到 `idle` / `agents`。
- 解析 Chrome Native Messaging 长度前缀帧（**禁止往 stdout 打日志**）
- 启动后立刻 `status=starting` 并应答 `hello`；CLI 探测在后台跑，**不得**挡住读循环或把 `hello` 拖到探测结束。探测有总时限（约 8s）；超时仍按已找到的二进制列名单并转 `idle`。一帧 header+body 一次 `Write`，避免半帧卡死 Chrome。
- spawn `~/.local/bin/agent acp`（PATH 不足时用绝对路径）
- 作为 ACP Client：`initialize`（声明 `parameterizedModelPicker`）→ `authenticate(cursor_login)` → 按侧栏指令 `session/load`、`session/new` 或尝试 `session/fork`
- 每个 `AcpClient` 是一条 `agent acp` 进程，同一时刻只能跑一轮 `session/prompt`。要并行跑多个会话时，Host 再拉一条进程（initialize + authenticate），按 ACP `sessionId` 把 `update` / 权限 / Cursor 方法 / `turn.end` 标回去。空闲进程复用，不在一轮结束后立刻杀掉。
- 禁止对正在 prompt 的进程再发 `session/load` / `session/new` / `session/fork`：切走或新建时用空闲进程（没有就新开）。
- 把 Side Panel 的 prompt/cancel/permission、会话新建 / 切换 / fork、模型切换转成 ACP；`cancel` / `permission.reply` / `cursor.reply` 打到发出该请求的那条进程
- 用本机系统对话框选出文件/文件夹的绝对路径（Chrome `<input type=file>` 给不出真路径）
- 用 `agent models` 列出账号可选模型，并结合 `session/new` 的 `configOptions`
- 把 Agent 的 `session/update`、权限请求、Cursor 扩展方法推给扩展
- 把页面快照和 `browser/tools.json` 写入工作区；监视 `browser/commands/`，转给扩展，再把结果写回 `browser/results/`（截图另存 `browser/screenshots/`）。`reportArtifacts` 由 Host 自己消化，不得把页面方法拦下。页面命令发出后若约 30s 还没有 `browser.result`，Host 仍写 `results/<id>.json`（`ok: false`，说明等扩展超时），避免 Agent 空等。

Host 是一份 Go 二进制（`cmd/opensider` + `internal/`）。`browser/tools.json` 由 `internal/protocol.ToolCatalog` 在启动时写入，不在 TS 里再维护一份。stdout 只给 Chrome，ACP 走子进程管道，日志只写 `~/.opensider/host.log`。`fs.pick` 时 exec 自己的 `pick` 子命令（独立进程才能把系统对话框拉到前台）。`hello` 不带 os；选文件分流用侧栏 UA。`page.pick` 到不了 Host。

## 工作区布局

```
~/.opensider/
  runtime/
    opensider                # 唯一 Go 二进制（Windows 为 opensider.exe）
  extension/                 # 用户侧已解压的扩展
  workspace/                 # ACP session cwd
    AGENTS.md                # 页面协议说明，会话开始就会被读到
    outputs/                 # 用户会打开的任务产物；Ensure() 每次 0755 创建
    browser/
      tools.json             # 机器可读方法目录，Host 启动时写入（含 outputsDir）
      current.json           # 当前标签：tabId, url, title, updatedAt
      tabs.json              # 全部普通窗口/标签：tabId, windowId, title, url, active, pinned, restricted
      snapshot.md            # 交互控件列表 + 可读正文
      interactive.md         # 仅编号交互控件，填表/点击先读这份
      commands/<id>.json     # Agent 写入的页面命令
      results/<id>.json      # 扩展写回的结果
      screenshots/<id>.jpg   # 视口 / 元素截图
      pasted/<id>.jpg        # 用户从输入框粘贴的截图
  session.json               # 最近一次选中的 ACP sessionId（兼容旧版）
  ui-state.json              # 侧栏权威状态（会话列表/消息/偏好）；扩展卸载后仍在
  host.log
```

侧栏状态（语言、会话目录、消息、选中项、权限模式、模型、抽屉）写两份：`chrome.storage.local` key `opensider/state` 是热缓存；权威副本是 `~/.opensider/ui-state.json`（不进 workspace，免得和 Agent 文件混在一起）。Host `hello` 之后发 `{ type: "ui.state", state }`（没有文件则 `state: null`）。侧栏 `ui.state.set` 把同一份 JSON 交给 Host 落盘，带 `savedAt`。扩展存储为空或 `savedAt` 更旧时用 Host 灌回；**空会话表不得覆盖已有镜像**（避免重装后首帧空态把历史写丢）。Native Messaging 单帧约 1MB，工具输出仍先截到 8KB 再写入。Host 只另记 ACP `sessionId` 到 `session.json`，方便 `session/load`。

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

命令默认超时 20s（`waitFor` / 导航可能更久）。失败结果带 `ok: false` 和错误信息。Host 在约 30s 仍未收到扩展回包时也会写一份失败结果，避免 `results/<id>.json` 缺失。文本结果约 200KB 截断。截图走 JPEG 压缩，结果 JSON 不内嵌像素。操作类命令成功后刷新 `current.json` / `snapshot.md` / `interactive.md`。侧栏把 `browser.command` / `browser.result` 写成当前轮 assistant 的 `tool-call`（`toolCallId` 为 `browser:<id>`），跟 ACP 工具同一套 `ToolCard`，不挂 Header。

Host 在 `session/new` 之前写好 `AGENTS.md` 和 `browser/tools.json`，这样 Agent 一进工作区就能感知读、操作、视觉、交互快照、标签/窗口方法和 `reportArtifacts`。`workspace.Ensure()` 在 Host 启动和 `install` 时创建 `browser/` 子目录以及 `outputs/`（0755），并重写 `AGENTS.md` / `CLAUDE.md` / `browser/tools.json`。`tools.json` 的 `version` 随协议字段变更递增（现为 8），并带 `outputsDir: "outputs"`。Agent 应把用户会打开的 html / pdf / md / 图片写到 `outputs/`（相对工作区 cwd），不要丢在根目录；草稿和临时文件不限。Host **不**拦截 Write / Shell，也不把根目录写入改写到 `outputs/`——这是 AGENTS.md + 目录布局引导，不是写拒绝列表。SW 在标签/窗口变化时（250ms 防抖）发 `tabs.update`，Host 写 `browser/tabs.json`。`listTabs` 结果与该文件同形，给需要立刻拿到列表的命令用。`page.update` 同时写 `interactive.md`。

`reportArtifacts` 不是页面方法。Agent 仍写 `browser/commands/<id>.json`，Host 监视时认出 `method` 后自己解析、写 `browser/results/<id>.json`，**不**转成 `browser.command`。命令监视用 `id + 内容哈希` 去重：同一文件的 Create 后紧跟 Write 只处理一次；Agent 用同一个 id 改写命令（常见于再次 `reportArtifacts`）必须再跑一遍，不能因为 id 已经处理过就丢掉。参数接受 `args.files[{path, name?}]`、`args.paths[]` 或单个 `args.path`；相对路径相对工作区 cwd。示例与说明优先 `outputs/...`，但仍接受任意已存在路径。每条须存在于本机，按路径去重，用和附件同一套规则标 `kind`。随后推 `{ type: "artifacts", items, sessionId? }`：`sessionId` 优先取正在 `prompt` 的 ACP 会话，侧栏映射到本地会话后 **整表覆盖** `Session.artifacts`（新表不含 `missing`，上次打开位置失败留下的失效标记一起清掉，按路径替换而不是按路径合并）。侧栏 `fs.reveal` 让 Host 调系统文件管理器打开目录并选中该文件。路径不存在时 Host 回 `{ type: "fs.revealed", path, missing: true, error }`，不能只打日志；侧栏按 `path` 把该条 `missing: true` 写进 `Session.artifacts` 并随会话持久化。其它 reveal 失败（空路径、非绝对路径、系统文件管理器报错）也回 `fs.revealed` + `error`，但不标 `missing`，按钮保留。成功打开不回结果。

## 多会话与 fork

工作区仍是一个。ACP 会话可以有多条，侧栏用本地 `id` 和 `acpSessionId` 对应。

```
chrome.storage.local 与 ~/.opensider/ui-state.json（同形）
  savedAt?: ISO time           # 镜像比较用
  locale: "en" | "zh"          # 默认 en
  theme: "light" | "dark" | "system"  # 默认 dark；system 跟 prefers-color-scheme
  selectedId: <local session id>
  selectedModelId?: string     # 具体模型 id；auto / 空 = 不指定，不调用 set_model
  agentMode: "ask" | "workspace" | "auto" | "unattended"  # 默认 ask
  selectedProviderId?: string
  onboardingCompleted?: boolean
  selectedModelByProvider?: { [providerId]: modelId }
  sessionsOpen?: boolean       # 右侧会话抽屉是否展开
  sessionDrawerWidth?: number  # 抽屉宽度，默认 248
  sessions[]:
    id, acpSessionId?, title, titleManual?, createdAt, updatedAt
    pinnedAt?                  # ISO；有值即置顶
    artifacts[]?               # reportArtifacts 覆盖写入 {path,name,kind,missing?}；missing 在 reveal 找不到文件后写入，下次 report 整表覆盖会清掉
    parentId?, forkedFromMessageId?
    pendingForkContext?        # 下一条 prompt 要带的节点前文
    acpByProvider?             # { [providerId]: acpSessionId }；换 Agent 不丢本地消息
    messages[]               # assistant 带 modelId / modelName，首段流式写入时盖上；结束时写 durationMs
```

协议：

| 侧栏 → Host | Host 行为 |
|---|---|
| `agent.connect` | 按 `providerId` 拉起对应 ACP：先握手新进程，成功后再停旧 runtime；进行中报 `connecting` + `agent.progress` |
| `agent.cancelConnect` | 取消进行中的 `agent.connect`（`ready` 时空操作）。杀掉正在握手的新进程，不拆已 ready 的旧 runtime；有旧 runtime 则恢复 `currentAgent` 并报 `ready`，否则回 `idle`。用 `connectSeq` 作废进行中的 connect，避免取消后迟到的 `ready` |
| `session.new` | 在空闲（或新开的）ACP 进程上 `session/new`，回 `session`。不打断正在跑的进程 |
| `session.use` + `sessionId` | 该会话已在某进程上且正在跑则只回 `session`（replay），不 `session/load`；否则在空闲进程上 `session/load`，失败则 `session/new` |
| `session.fork` + `sessionId` | 在空闲进程上先试不稳定的 `session/fork`（整段历史）；失败则 `session/new` |
| `prompt` 可带 `sessionId` | 绑到已持有该会话的进程，或空闲进程 `session/load` 后再 prompt。同一会话已有一轮在跑则拒绝；不同会话并行 |
| `cancel` 可带 `sessionId` | 只取消该 ACP 会话所在进程的一轮 |
| `update` / `turn.end` / `permission` / `cursor` 带 `sessionId` | 侧栏按 ACP id 映射到本地会话，不按当前选中项 |
| `fs.pick` | Host 弹出本机选文件/文件夹对话框，回 `fs.picked`（绝对路径 + kind） |
| `fs.save` | Host 把侧栏压好的 JPEG 写到 `browser/pasted/`，回 `fs.saved`（绝对路径 + kind=image） |
| `fs.reveal` + `path` | Host 打开系统文件管理器并选中该文件；路径不存在则回 `fs.revealed`（`missing: true` + error），其它失败也回 error 但不标 missing；成功不回 |
| `fs.revealed`（Host → 侧栏） | reveal 失败时带 `path` / `error` / 可选 `missing`；侧栏只在 `missing` 时按 path 把该条产物标失效并持久化 |
| `fs.preview` + `path` + `requestId` | Host 读本机图片（绝对路径、常规文件、图像类型、上限 32MB），按 512KiB 原文分片 base64 回多条 `fs.previewed` |
| `fs.previewed`（Host → 侧栏） | 成功：`mime` / `size` / `index` / `total` / `data`；失败：`error`。侧栏拼 `blob:`；失败文案走 i18n，不加句号 |
| `artifacts`（Host → 侧栏） | `reportArtifacts` 成功后整表覆盖该会话产物列表 |
| `page.pick` | SW 让当前标签内容脚本拾取元素，回 `page.picked`（CSS selector，kind=element）；不转发 Host |
| `model.set` | 非 `auto` 时 `session/set_config_option`（`category: model`）；失败再试 `session/set_model` |

从某一轮之后 fork：

1. 新本地会话，复制该消息及之前的气泡，原会话不动。
2. 若 fork 的是**最后一条**且 Agent 支持 `session/fork`，用 ACP fork，Agent 历史与 UI 对齐，不必再灌上下文。
3. 否则 `session/new`。Agent 是空会话，把截断后的对话写成 `pendingForkContext`，**下一条用户消息**前缀带上（UI 不显示这段包装）。这样 Agent 不会为了灌上下文先回一嘴。

侧栏用 `runningIds`（不持久化）记哪些本地会话有一轮在飞，不再用全局一把锁。`isRunning` 只表示**当前选中**会话在跑（输入框描边、停止钮、该会话的 fork / 重生成 / 改历史）。新建和切换始终允许；流式 `update` / `turn.end` / HITL 按消息上的 ACP `sessionId` 写回对应本地会话。切到别的会话时，若目标自己正在跑则不要再 `session.use`。权限 / 提问 / 计划按会话存放，只在看着该会话时画出来；「允许工具调用」仍会自动回掉所有会话里待批的权限；「允许一切操作」还会立刻回掉待批的提问和计划。切走后不再自动过。页面工具仍共用一个工作区，两条 Agent 同时改页面时可能打架，这是并行的取舍。会话列表里进行中的卡片左侧用六点盲文字符（`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`）CSS `content` 循环代替圆点，不要再在标题旁挂 `LoaderCircle`。

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

消息队列（进行中再发送）：

1. 队列按本地会话 id 存在 `App` 内存里（`queues`），不写 `chrome.storage`。切走会话不丢；删会话时一并丢掉。
2. `onSend` 抽成 `sendToSession(localId, text, attachments)`。自动发出后台会话的队首时必须带上该会话 id，不得再用 `selectedId`。
3. `ChatPane` 提交：改历史仍走 `onRevise`（进行中拒绝）；改队列项走 `onUpdateQueued`（覆盖后清编辑态再 flush）；否则进行中 `onEnqueue`，空闲 `onSend`。进行中 `Stop` 与 `Send` 并存；回形针 / 拾取 / `@` 不再因 `isRunning` 禁用，方便往队列里组消息。
4. 只在 Host `turn.end` 里 `finishTurn` 之后 `flushQueue`。队空或该会话仍在跑则 return；`editingQueueRef` 指向队首则按住，等用户点发送覆盖后再发。改的不是队首则队首照常 shift。`cancel` 立刻 `finishTurn` 但不 flush，等这条 `turn.end`，避免旧结束事件误结束下一条。连接 `error` / `finishAllTurns` 不自动 flush。
5. 取消队列编辑、删掉一项、或覆盖保存之后，若该会话已空闲，再 `flushQueue` 一次，避免队首解按后卡住。`QueuedMessageList` 画在 composer 上方：左 `displayMentionText`（过长省略，没有正文则附件名），右 `CornerDownLeft`（立即发送）/ `Pencil` / `Trash2`。
6. 立即发送：从队列摘掉这一条（可插队）。该会话若在跑，先 `cancel` + `finishTurn`，把条目推进 `pendingForceSend`，**等**这条 `turn.end` 再 `sendToSession`——Host 在 `prompting` 时会丢掉新 `prompt`。`turn.end` 时若该会话有强制发送，只发这一条、不 `flushQueue`。空闲则当场发出。正在改这一条则退出编辑、还原草稿，不把未保存的改动发出去。

旧的 `session.json` `{ sessionId }` 在侧栏还没有本地目录时，迁成第一条会话。

## 语言

`packages/extension/src/sidepanel/i18n.ts` 提供 `en` / `zh` 词条。默认 `en`。完整 state 仍写 `chrome.storage.local`；切换时同步镜像 `localStorage` 的 `opensider/locale`。`theme-boot.js` 同时读这份镜像并设 `document.documentElement.lang`，避免每次打开先闪英文。React 初始 state 也从镜像读。连接错误原文（Host / Chrome `lastError`）不翻译。composer `placeholder` 在发送提示后补一句 `@` 引用：中「输入@可引用内容」、英「Type @ to mention」。输入框上方 todo 标题走 `todoList`：英「Todo List - {done}/{total}」，中「待办项 - {done}/{total}」。

## 主题

`theme.ts`：偏好 `light | dark | system`，解析后给 `document.documentElement.dataset.theme`。`system` 时听 `prefers-color-scheme`。完整 state 仍写 `chrome.storage.local`（`theme` 必填）；切换时同步镜像 `localStorage` 的 `opensider/theme`。`index.html` 只在 `<head>` 用 `<script src="./theme-boot.js">` 加载同目录的 `src/sidepanel/theme-boot.js`（独立 classic script、非 inline，避免 MV3 CSP），在 React 之前读这份镜像并设 `data-theme`，避免每次打开先闪默认深色。不要放进 `public/`，也不要从 React/TS `import`：Vite 7 + CRXJS serve 会把 HTML script 转成 `import()`，而 public 资源禁止被 import，dev 会 Internal server error、侧栏白屏。构建时 Vite 不会打包无 `type="module"` 的 script，所以 `vite.config.ts` 把同一份文件发到 `dist/src/sidepanel/theme-boot.js`，与 HTML 相对路径对齐。React 初始 state 也从镜像读，`useLayoutEffect` 再 apply。颜色全走 CSS 变量：`:root` / `[data-theme=dark]` 是现有橄榄黑；`[data-theme=light]` 是中性浅灰层次（画布 `--ink` `#f3f4f6` → 抬升 `--panel` 近白 → 凹陷 `--panel-2`），少蓝、少脏；正文冷灰黑（muted 用石板灰）+ 钢蓝强调（仍走 `--brass` token）。`--hover` / `--code` / `--user` / `--on-brass` / `--overlay` 两套分开，组件不再写死 `#161910` 这类只适合深色的底。图走 CSS 变量配色，不跑 mermaid `initialize`。顶栏 `Sun` / `Moon` / `Monitor` 循环三态。

## 附件（只传路径）

Chrome 的文件选择器不会给出本机绝对路径。加号发给 Host `fs.pick`（带 `mode`: `mixed` | `files` | `folders`）。侧栏用 UA 判断：macOS 直接 `mixed`（`NSOpenPanel` 一次混选）；其它系统在回形针上方弹出「多选文件 / 多选文件夹」再发对应 mode。Host **exec 自己**加 `pick`（Chrome 子进程里直接弹框经常出不来）。Windows `IFileOpenDialog` 与 Linux zenity/kdialog/portal 都是文件或文件夹二选一。`fs.stat` 分成 `image` / `file` / `folder`。侧栏芯片只展示 `basename`，`title` 是全路径。未连上就点加号，侧栏写明确错误。

剪贴板里的截图同样没有本机路径，不能当文件选。composer `paste` 若带 `image/*`，先按页面截图那套压成 JPEG（最长边约 1280、质量约 0.72、base64 &lt; 700KB，以免 Native Messaging 超 1MB），再 `fs.save` 落到 `~/.opensider/workspace/browser/pasted/`。回包后当普通 `kind: image` 芯片，走同一套 `wrapAttachments`。Chrome 会把同一张图同时挂在 `clipboardData.files` 和 `items` 上，且 `getAsFile()` 的 `lastModified` 往往对不上，按 name/size/mtime 去重会漏。`clipboardImages` 只读 `files` 里的图片；没有才退到 `items`。有图时 `preventDefault`，避免二进制糊进 textarea；若同时带纯文本则插到光标处。落盘完成前不让发送，以免消息先走、图还没进附件。未连上或压图/写盘失败写明确错误。

`session/prompt` 在用户正文后追加：

```
[Attachments]
Local paths. Read these files or folders if needed.
- /abs/path/photo.png
- /abs/path/src
```

发给 Agent 仍只传路径，不把附件字节塞进 prompt。预览必须走 Host：Chrome 扩展页（`chrome-extension://`）即使 CSP `img-src` 写了 `file:` 也加载不了 `file://`，这就是旧方案从未真正显示出图的原因。侧栏只对已经挂上的 `kind: image` 芯片发 `{ type: "fs.preview", requestId, path }`，拒绝 `http(s)` / 相对路径 / 元素 selector。Host `internal/preview` 校验绝对路径、常规文件、图像类型（魔数优先，扩展名兜底 HEIC/AVIF/SVG），超过 32MB 回错误；字节按 512KiB 切，每片独立 base64，整帧低于 Native Messaging 1MB，连续回 `{ type: "fs.previewed", requestId, mime, size, index, total, data }`。读文件在 goroutine 里做，避免堵住 Native 读循环。侧栏按片 `atob` 再拼 `blob:` 给 `<img>`，关掉预览 `revokeObjectURL`。等 `onLoad` 再藏转圈、再挂变换层；任何失败（离线、超时、非图、读盘、`onError`）都居中显示 `previewImageFailed`（中「无法加载这张图片」/ 英「Couldn't load this image」，无句号），不要静默没反应。`ImagePreview` portal 到 `document.body`：`fixed inset-0`、`--overlay` + `blur(2px)`。变换用 `react-zoom-pan-pinch`（`TransformWrapper` / `TransformComponent` / `useControls`）：滚轮与捏合缩放、拖拽平移、`resetTransform` 复位；`centerOnInit`，图仍 `max-width: 80vw`、`max-height: 100vh`。不引入 antd `Image`，也不用 `react-photo-view`——后者自带一套 icon，和 lucide-only 冲突，为换 icon 再去 restyle 不划算。顶栏自绘在遮罩上：lucide `ZoomIn` / `ZoomOut` / `RotateCcw` / `X`，底用 `--panel`、边 `--line`、字 `--text`，tooltip 走现有 `IconButton`（z 要高于预览层）。点遮罩、点关闭或 Esc 退出；点图或顶栏不关。库给 `img` 设了 `pointer-events: none`，命中的是变换内容盒（`.cs-preview-image`），关闭判定两者都认。按下后移动超过约 4px 当成拖拽，松手不当点遮罩。`isPreviewBackdropClose` 抽在 `image-preview.ts` 里测。转圈用 `.cs-preview-spin`，不依赖 Tailwind `animate-spin`。用户气泡改成外层 `div` 点空白处改历史，图片芯片 `stopPropagation`，进行中也能预览。非图片芯片不可点预览。未发送的芯片只活在输入栏 state 里，不写 `opensider/attachment-history`。附件栏 `onRemove` 按 `path` 从 `attachments` 去掉，并用 `stripAttachmentMentions` 清掉正文里同一路径的 `@att` 芯片，避免栏里删了还能从 `@` 菜单或已插入芯片把路径发给 Agent。

## 提及芯片（`@`）

输入区不用 textarea，改成 contenteditable（对齐 `react-plug-editor` 的 Plug 节点思路，不引入该包）：正文和 `contentEditable=false` 的芯片流式混排。芯片 DOM 用 `data-token` 存序列化值，React root 渲 icon + 标题。占位用 `::before` 绝对定位叠在空编辑器上（不进文档流），避免 caret 落到占位文案后面；删到空时清掉残留 `br` / zwsp，caret 重置到内容区开头。

本地 token（只存在用户气泡 / 草稿，UI 不展示原文）：

```
«@tab:<url-encoded JSON {id,title,url,icon?}>»
«@att:<url-encoded JSON {path,name,kind}>»
```

`wrapUserPrompt` 在发给 Agent 之前把 token 展开：正文里的芯片变成 `@标题`，并追加 Agent 能读的块：

```
[Mentioned tabs]
The user @-mentioned these browser tabs inline. @names match the titles below.
If the tab is still in browser/tabs.json, switchTab with that tabId; otherwise openTab the URL.
- React Docs — https://react.dev (tabId: 42)

[Mentioned attachments]
The user @-mentioned these previously attached items. @names match the names below.
Read file/folder/image paths. For kind=element, use page tools with args.selector.
- shot.jpg — /abs/path/shot.jpg (image)
```

`AGENTS.md` 同步写明这两块。用户气泡和改历史回填都走同一套 parse → 芯片。会话标题用去掉 token、换成 `@标题` 后的纯文本。

`@` 菜单标签页不写历史存储。侧栏启动时 `chrome.tabs.query({ windowType: "normal" })`，并听 `onCreated` / `onUpdated` / `onActivated` / `onRemoved` / `onReplaced` / `onAttached` / `onDetached` 防抖重查；只展示当前仍打开、且有 URL 的标签（按 `lastAccessed` / 当前活动优先）。关掉即消失。菜单第一 tab 用这份列表（左 favicon，失败则 Lucide `Globe`）。`chrome.tabs.favIconUrl` 在 MV3 常是 `chrome://favicon` / `chrome://favicon2/`，侧栏 CSP `img-src` 只有 `'self' data: blob: file: https:`，扩展页拦 `chrome:` 和 `http:`；CSP 拦截还不保证触发 `onError`，于是行里只剩标题、连 Globe 都不出。不把 `chrome:` 写进 CSP。manifest 加 `favicon` 权限，`<img>` 先用已放行的 `https`/`data`/`blob`/`file` favIconUrl（`referrerPolicy=no-referrer`，避免 CDN 拒扩展页 Referer）；否则走官方 `chrome.runtime.getURL("/_favicon/?pageUrl=&size=32")`（`chrome-extension://` 算 `'self'`）。候选都失败再退 Lucide `Globe`。顶栏仍然不画当前页 favicon。附件 tab 直接用当前输入栏 `attachments`（按 `path` 去重）。启动时顺手清掉旧版 `opensider/*-history` 与 `cursor-sidebar/*-history`。

`@` 按钮：focus 编辑器、caret 移到最前、插入 `@`、打开菜单。`AtMenu` portal 到 `document.body`，`position: fixed`，锚点用编辑器上次 range 的 caret 盒；优先放在光标上方（底边 = caret.top - 6），四边夹在视口内缩 16px，高度按上方可用空间收缩，列表 `flex-1 min-h-0` 滚动。mousedown `preventDefault` 以免抢焦点，插入前恢复上次 range。键盘与模型下拉同一套循环高亮 + `scrollIntoView({ block: "nearest" })`；Tab / 左右键切「标签页 / 附件」两个页。回车 / 点击只 `insertMention`。上次没兜住：AtMenu 的 `document` capture 把 `onSelect` 放进 effect 依赖，每次 ChatPane 渲染都拆掉重绑；`stopImmediatePropagation` 拦不住 React 根节点委托；`menuOpen` / `atOpen` 是异步 state，打开菜单的同一拍或 `flushSync` 插芯片之后 Composer 仍会 `onSubmit`；`submit()` 自己也不看菜单。现在用模块级同步锁 `atMenuLock`：输入 `@` 或点 `@` 的当帧就 `open=true`；`installAtMenuGuard` 在 `window` capture 常驻，Enter 只 `confirm` 插芯片；Composer 原生 capture + React `onKeyDown` + `beforeinput` 都认锁；`submit(fromEnter)` 见锁直接 return；菜单在该记 Enter 的 `keyup` 才关，避免同一记回车落到发送。芯片高度跟所在行行高对齐：`.cs-mention-wrap` / `.cs-mention-chip` 继承正文的 `font-size` 和 `line-height`，再 `height: 1lh`。上次写成芯片自己 `font-size: 11px` + `line-height: 1`，`1lh` 就变成 11px，视觉上塌成字高。标签仍 11px，内容 `align-items: center`。padding `0 12px 0 8px`。选中后用芯片替换光标前的 `@` 及紧跟搜索词（`readAtQuery` / `consumeAtBeforeCaret` 共用同一 text-node 规则：caret 须在 `@` 之后，query 不含换行）。**内联搜索**：菜单打开时 `ComposerEditor.getAtQuery()` 读 caret 前 `@` 到 caret 的文本作为 `query` 传给 `AtMenu`；`readAtQuery` 返回 `null`（删了 `@`、caret 移出触发区）则 `closeAtMenu`。`at-menu-search.ts`：`filterAtTabs` / `filterAtAttachments` 对 title+url / name+path 做 `toLowerCase().includes`；标题 / 名称命中排前，仅 URL / 路径命中排后；空 query 不过滤。`HighlightText` + `.cs-at-match` 把匹配子串改成 `color: var(--brass)`，无背景、无选中块。`insertMention` 在插入点看前后第一个非 zwsp 字符：不是空格（` ` / `nbsp`）就在芯片左/右各插一个普通空格，已有则不重复；光标仍落在芯片后的 zwsp 上。点芯片时 `mousedown` `preventDefault`，caret 放到 wrap 后的 zwsp；`.cs-mention-wrap` / `.cs-mention-chip` 及子孙 `user-select: none`，`selectstart` 也拦住，避免光标进芯片或划词。

拾取元素不经过 Host：侧栏 `page.pick` → SW → 当前标签内容脚本。侧栏遮罩挂在 `App` 根上（`fixed inset-0` + `backdrop-blur`），盖住顶栏和会话列表，不因 ChatPane 高度裁切；点遮罩不取消。SW 用 `lastFocusedWindow` 找普通 http(s) 标签（YouTube 不算 restricted）；内容脚本探测失败则立刻 `executeScript`（`injectImmediately: true`，避免 YouTube 视频页长期 `loading` 时等到 `document_idle` 挂死），并等到 CRXJS loader 真正就绪。开拾取走活动主框的隔离世界函数调用，不群发 `tabs.sendMessage`。点中后回 `page.picked`，芯片 `kind: element`，`path`/`name` 都是唯一 CSS selector。Prompt 另附：

```
[Picked page elements]
The user picked these elements on the current browser tab. Inspect or operate
on them with page tools using args.selector.
- html > body > main > button:nth-of-type(2)
```

## 模型选择

1. Host 按 Profile `ListModels` 拉 CLI 目录，目录初始为空，不预置 Auto、不编假名单。Cursor：`agent models`（与 `agent --list-models` 相同），解析 `id - name` 行。OpenCode：`opencode models`，每行一条 `provider/model`（没有 ` - name`，`ParseAgentModels` 会得到空表）。其它 CLI 不跑 list 命令。
2. `initialize` 一律带 `_meta.parameterizedModelPicker: true`，便于返回 `configOptions`。探测阶段不再对每家做 ACP 握手，所以 OpenCode 的模型**不会**在 Host 进 idle 时出现，只能在连上之后拉。
3. `session/new|load|fork` 合并模型来源：`configOptions` 里 `category/id/configId` 为 `model` 的选项，以及 ACP `models.availableModels`（Copilot 用 `modelId`）。之后的 `config_option_update` 同样合并。OpenCode 现代版会在 `session/new|load` 同步带回 `id=model` 的 `configOptions`，但 provider 快照有时仍空；旧版可能完全不带。会话起来后若目录仍空：再等约 1.2s 收迟到的 `config_option_update`，并再跑一次该 CLI 的 list 命令。Copilot 1.0.x 在 CAPI `/models` 为空时 `session/new` 只回 mode / allow_all，不带 model 选项；`session/set_model` 仍可用。此时 Host 用 Copilot CLI 内置公开模型表（`auto` + sonnet/opus/gpt 等）兜底，好让侧栏画出下拉。**确认**没有模型列表才不画下拉。
4. 换 Agent 时立刻清空 Host catalog，但**不要**在握手前推一条空 `models`（否则 SW `lastModels` 和侧栏会把「还在加载」当成空名单）。握手后、`ready` 之前先跑 list 命令再 `sendModels`。侧栏 `hello` 且已 `ready` 时 Host 再推一次当前 catalog，避免 SW 重挂丢掉列表。侧栏在 `status !== ready` 时忽略空 `models`，避免把连接中的空槽当成最终态。
5. 用户改模型：`session/set_config_option`（发现的 `configId`，通常是 `model`）；失败则 `session/set_model`。`auto` / 空不是合法 ACP 值，跳过 RPC。
6. 侧栏只在 `status === ready` 且列表非空时渲染下拉。连上后若列表含 `auto` 且用户没有已记住的具体模型，选中态为 `auto`。`selectedModelId` 写入 `chrome.storage.local`；仅当选的是具体模型时再 `model.set`。
7. 下拉外壳不滚：顶部是固定筛选 `input`（无边框 / outline / ring），`open` 后 `focus()`；下面才是 `overflow-y-auto` 的条目。筛选只对已加载的 `models` 做 `name` / `id` 的 `toLowerCase().includes`，不另发请求。关掉下拉清空关键词。`ArrowDown` / `ArrowUp` 在 `visible` 上取模换 `highlightId`（打开时落在当前模型），`scrollIntoView({ block: "nearest" })` 跟滚；`Enter` 对高亮项 `onModel` 并关下拉。中文 placeholder 为「筛选...」。

## 权限模式

`agentMode` 四档，写入 `chrome.storage.local`，默认 `ask`。前三档语义不变，第四档才是真正无人值守：

| id | 中 / 英 | 自动过什么 |
|---|---|---|
| `ask` | 默认权限 / Ask every time | 无。每次 `request_permission` 弹卡 |
| `workspace` | 允许文件修改 / Allow workspace edits | 仅编辑/写入类工具回 always/once；Shell / 网络仍弹卡 |
| `auto` | 允许工具调用 / Auto-run tools | 全部工具权限回 always/once。**提问和计划仍要人点** |
| `unattended` | 允许一切操作 / Allow all | 工具同 `auto`；`cursor/create_plan` 自动 `accepted`；`cursor/ask_question` 确定性作答（每题选第一项，没有选项则空数组）。三张 HITL 卡都不留着等人 |

不要把 `auto` 改名叫 Allow all。切到更宽的档位时，已弹出且符合该档的卡立刻回：`auto` / `workspace` 只冲权限卡；`unattended` 同时冲权限、提问、计划。切走 `unattended` 后新到的卡不再自动过。

Host `session/set_mode` 仍按 Profile `modeMap` 推。**Cursor ACP 没有第四种 session mode**：`ask` / `workspace` / `auto` / `unattended` 都映射到 `agent`，真正的「允许一切」只在侧栏拦卡。其它 CLI 的 `unattended` 复用该家最宽的已有 mode（与 `auto` 相同：`bypassPermissions` / `autopilot` / `agent-full-access` 等）；没有 `session/set_mode` 则只在客户端拦卡。提问/计划自动答不经过 Host，侧栏直接 `cursor.reply`。

侧栏 `ModeSelect` 外壳与 `ModelSelect` 一样**不要** `overflow-hidden`：省略只写在触发钮的 `truncate` 上。菜单用 `absolute bottom-full`（或 portal + `fixed`）画在按钮上方；外壳一裁，点击就像没反应（模型下拉能开、权限下拉不能，就是这个差）。文案走 `i18n`，按系统设置口吻写（短标题 + 一句说明，不要营销句）：`ask`「默认权限 / Ask every time」灰字「用户确认后方可调用工具 / Confirm each tool」；`workspace`「允许文件修改 / Allow workspace edits」灰字「允许工作区内文件修改，执行命令、联网操作仍需确认 / Workspace file edits skip confirmation; commands and network still ask」；`auto`「允许工具调用 / Auto-run tools」灰字「直接执行工具调用，问题和计划仍需确认 / Tools skip confirmation; questions and plans still need a click」；`unattended`「允许一切操作 / Allow all」灰字「工具、问题、计划无需确认 / Don't ask about tools, questions, or plans」。图标：`Shield` / `FolderPen` / `Zap` / `Unlock`。`isWorkspaceWritePermission` 按 `toolCall.kind` / `title` 启发式：命中 execute/shell/bash/terminal/command/fetch/http/network/web_search/mcp 则仍弹卡，命中 edit/write/delete/move/create/patch/apply 才自动过。客户端不按路径判断是否出目录；出目录仍问靠 Agent 的 `acceptEdits`。`autoQuestionAnswers`：每题取 `options[0].id`，没有则 `selectedOptionIds: []`。

## 多 Agent CLI

Host 是通用 ACP Client + 数据驱动 `AgentProfile`（启动命令、鉴权、modeMap、contextFiles、gates）。不经 acpx。探测：内置名单（Cursor / OpenCode / Copilot / CodeBuddy / Claude 适配器 / Codex 适配器 / Gemini / Qwen / Kimi / iFlow / Trae / Qoder 等）+ Chrome 传入的 PATH + 本机常见 bin（`~/.local/bin`、`~/.opencode/bin`、`~/.npm-global/bin`、`~/.bun/bin`、nvm / fnm / volta / asdf）+ ACP Registry。Chrome Native Messaging 的 PATH 不含 nvm，只搜系统目录会漏掉 `copilot` 这类 `#!/usr/bin/env node` 安装。Claude Code 只认 `claude-agent-acp` / `claude-code-acp`，不把交互式 `claude` 当成 ACP（`--acp` 不存在，硬加会把 TUI 当已安装）。探测在 Host 进 `idle` 之前于后台完成，而且**只看二进制在不在**（`ResolveOnPath`），启动阶段不再对每家跑 `initialize`——握手会把 `agent acp` / `copilot` 的 stdout 弄脏 Native Messaging 管道，hello/status 就被堵住。同一绝对路径不重复列。真正点连接再走完整握手。ProbeACP 仍给按需解析用：子进程必须自建 stdin/stdout、不能继承 Host 管道，超时后杀进程组且 `Wait` 有上限。Registry HTTP 在本地名单已经 `idle` 之后再补，失败就跳过。拉起子进程时把该 CLI 所在目录和上述 bin 预进 PATH，避免 `env node` 找不到。Copilot 的 `modeMap` 用 ACP session-modes URL（`#agent` / `#plan` / `#autopilot`），不要发 `default`/`ask`。`~/.gemini` 属 root 时 Gemini `session/new` 会 EACCES，Host 把错误改写成 chown 说明。OpenCode 常见安装是 Bun 打成的单文件（`~/.opencode/bin/opencode`），`acp.Client.Start` 只 `exec` 探测到的绝对路径加 `acp`，不复制、不解压、不改 `com.apple.quarantine`。该二进制 adhoc/linker 签名；启动时 Bun 把内嵌的 `watcher.node`（`@parcel/watcher` 一类）解到 macOS `$TMPDIR`，文件名形如 `.<hash>-00000001.node`，同样只有 adhoc 签名，Gatekeeper 会弹「未打开 / Apple 无法验证」。这是 OpenCode 自己的未公证 addon，任何父进程拉起 `opencode` 都可能触发。产品代码禁止给用户整份 OpenCode 安装去隔离属性。用户应点「完成」、在系统设置 → 隐私与安全性允许，或从官方渠道重装；不要把 `.node` 丢进废纸篓。侧栏会话自己持有消息；`Session.acpByProvider` 记各家 ACP id。换 Agent 不删本地历史；该家没有绑定则 `session/new` 并带本地前文。模型列表按当前 provider 的 `configOptions` / `session.models` / list 命令刷新（OpenCode 为 `opencode models`），Copilot 空名单走内置公开表。引导是标题栏下方内容区垂直居中的纯文本按钮，点即连接。顶栏 Agent 下拉 portal 到 `document.body`，避免被消息盖住。会话标题相对 header 居中，左右各留 32px。引导完成前 Host 不拉起 Agent 进程。换 Agent（或首次点连接）时 Host **先**握手新进程、成功后再 `Stop` 旧 runtime，这样取消只需停新进程、旧会话还在。侧栏在 `requestConnect` 之前记下上一份 `providerId` 与是否 `ready`；点取消发 `agent.cancelConnect`，立刻还原 `selectedProviderId` / 会话绑定，清掉进度，且不再把随后的 `idle` 自动连到被取消的那一家。已 `ready` 不画取消钮。Service Worker 若约 10s 仍停在 `starting`（Host 没回 `idle` / `ready` / `error`），改报 error 并写 `~/.opensider/host.log`，不要转圈到永远。

## 标签切换

活动标签以浏览器焦点普通窗口里 `active: true` 的标签为准，不以「上次成功抓过快照的 tabId」为准。Chrome 在关掉当前活动标签并激活另一张已打开标签时，**不保证**再发 `tabs.onActivated`；只听激活事件会把 `current.json` 留在已关闭的 tabId，而 `tabs.json` 已经是新列表。因此关标签、换窗、移动/挂接都必须自己解析替换后的活动标签。

1. SW 在这些事件上认为活动标签可能变了：`tabs.onActivated`、`tabs.onRemoved`（尤其是关掉当前活动标签）、`tabs.onReplaced`、`tabs.onCreated`（新标签常被激活）、`tabs.onMoved` / `onAttached` / `onDetached`、`windows.onFocusChanged` / `onRemoved`，以及活动标签的完整 URL `onUpdated`
2. 不要用事件里的 tabId 当最终写入目标（它可能刚被关掉）。先立刻 `windows.getAll({ populate, windowTypes: ["normal"] })` 解析焦点窗口的活动标签并 `requestPage`，再按与 `tabs.json` 相同的 250ms 防抖再解析一次，避免关掉当前标签后丢掉随后才稳定的激活。进行中的旧 `requestPage` 用代数作废，禁止晚到的关标签快照盖住新页
3. 向该 tab 的内容脚本要 `getMeta` + `getReadable` + 交互控件列表。http(s) 页先 `ensureContent`（等 `__opensiderPage`），再在主框调 `snapshot`；系统页或不允许注入时仍写 url/title（更新身份，不注入）
4. 发给 Host：`page.update`
5. Host 写 `browser/current.json`、`browser/snapshot.md` 和 `browser/interactive.md`
6. Side Panel 仍收 `CurrentPage`（`favIconUrl` 由 SW 从 `chrome.tabs` 并进，不写进 workspace），但顶栏不再画 favicon
7. 下一条 `session/prompt` 在用户文本前加一行 `[Current tab] {title} — {url}`（UI 不显示这行）
8. 若有文件附件，再追加 `[Attachments]` 绝对路径；若有拾取的元素，再追加 `[Picked page elements]` 和 CSS selector，并写明用页面工具的 `args.selector` 去查看或操作。正文里的 `@` 芯片先展开成 `@标题`，再按种类追加 `[Mentioned tabs]` / `[Mentioned attachments]`（UI 气泡里只显示用户正文和芯片，不显示这些块）
9. 同时防抖写 `browser/tabs.json`。若当前 tabId 已不在打开集合里，立刻清掉 `current.json` 里的旧 tabId（空 url/title），不得停在已关闭标签。Agent `switchTab` / `moveTabsToWindow` 成功后再抓当前页快照

不在切换时往会话里塞一条用户消息，以免污染对话。Agent 需要更多页面内容时，按 `AGENTS.md` 读 snapshot 或写命令文件。跨标签先读 `tabs.json`（或 `listTabs`）拿 `tabId`，再 `switchTab`，然后用原来的页面方法操作新的当前页。同域链接点击规则不变（见聊天正文链接）：这套同步管的是标签身份 / 当前页，不是页内链接点击。

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
| `cursor/update_todos` | 输入框上方可折叠 TodoList。新一轮 `beginTurn` 先清空 `session.todos`。下发时若 `merge` 且只是已有 id+文案的状态更新则合并；一旦出现新的 id/文案则整表覆盖，不保留上一轮条目 |
| `cursor/task` | 子任务卡片 |
| `session/prompt` 结束 | 对应本地会话移出 `runningIds`，给**该会话**末尾 assistant 打上 `durationMs`。Cursor 在正文/工具已经流完后，偶尔用 JSON-RPC error `RetriableError: WritableIterable is closed` 收尾，或再推一段同样文案的 `agent_message_chunk` / `agent_thought_chunk`。这是 CLI 自己的流拆掉，不是 Host 提前关了 stdin。Host 若本轮已经转发过正文、思考或工具，把该 error 记日志并按 `end_turn` 结束，不发 `stopReason: error`。转发 update 前丢掉整段（或首尾整行 / 句末）的这一句。侧栏 `applyAcpUpdate` / `settleFinishedContent` 同样剥，避免旧 Host 或已落盘记录再画出来。空轮（只有这句、没有任何内容）仍当失败；鉴权 / 崩溃 / 其它 RPC error 照旧 `turn.end` + 顶栏错误 |

消息状态由 Side Panel 持有并持久化。Host 重启后 `session/load` 只负责恢复 Agent 侧上下文；Panel 以本地存储的消息为准，不因为 `replay` 清空界面。`session/load` / `session/new` / `session/fork` 以及为了切会话而做的 `session/load` 期间，Agent 会把历史当 `session/update` 回放（常常是一整段带 `[Current tab]` 前缀的 `user_message_chunk`）。三层拦住：

1. Host 在该进程 `binding` 且未 `prompting` 时丢掉这些 update（`config_option_update` 除外）。
2. 侧栏只在该本地会话 `runningIds` 有一轮、或末尾 assistant 还没有 `durationMs`（重连赶上直播）时才 `applyAcpUpdate`。`user_message_chunk` 一律忽略：气泡是发送时自己加的。
3. `lastAssistant` 只续写没有 `durationMs` 的末尾 assistant，避免回放把多轮 Agent 正文叠进上一条。

`hydrateSession` 对已落盘的坍缩记录跑 `repairCollapsedMessages`：去掉 `[Current tab]` / fork 包装，能按 `User:` / `Assistant:` 切开的就拆回多轮。展示和 `titleFromMessages` 走 `stripEnvPrompt`。

## 扩展身份

未打包扩展的 ID 必须稳定，Native Messaging 的 `allowed_origins` 才能写死。`manifest.json` 带固定 `key`，未打包 ID 为 `gcblddgaifebccglndkaccmibhechimj`。

CRX 安装包用 `scripts/keys/extension.pem` 签 CRX3，打包 ID 为 `clnpnldmjaklambmaglpckjlgkicmcpb`。当初生成 `key` 时私钥没有留档，不能用同一把钥匙签包，否则会改未打包 ID、侧栏 `chrome.storage` 会丢。因此打包 ID 与未打包 ID 不同，Host 清单 `allowed_origins` 同时写这两个 origin。私钥只用来固定打包 ID，不代表商店发布者身份，跟仓库一起走，保证本地 `pnpm build` 和 tag Release 签出同一份 ID。

Host 注册名：`com.opensider.host`  
macOS 清单路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opensider.host.json`

用户：`releases/latest` 的 `install.sh` / `install.ps1` 下一份 `opensider` 并 `opensider install`，清单 `path` 指向 `~/.opensider/runtime/opensider`。开发：`pnpm install-host` = `go run ./cmd/opensider install --local`，必须 `go build` 出真实二进制拷到 runtime（**禁止**把 `go run` 写成 Native Host path，Chrome 保不住这个进程）。`install` 同时 `workspace.Ensure()`，马上就有 `AGENTS.md` / `browser/tools.json` / `outputs/`。macOS TCC 仍要求二进制不在 Desktop / Documents / Downloads。Host 日志只写 `~/.opensider/host.log`，不写 stderr。从 Node 时代留下的 `~/.opensider`（`PickFiles.app`、`runtime/packages`、旧 `session.json`）可能和 Go Host 打架；开发机应备份后重新 `install --local`。推送 `v*` tag 触发 Actions：darwin 在 macOS 开 cgo 编，linux/windows 交叉编译；Release 说明只列该版本 commit。桥接未注册时 SW 轮询 `connectNative`。不迁旧目录。

## UI

- Agent 回复链接：`Markdown` 自定义 `a`，一律 `preventDefault`（侧栏是扩展页，默认点击会把面板自己导航走）。解析 `href`（相对地址相对当前页），只放行 `http(s)`。把主机名小写、去掉末尾 `.`、剥一层前导 `www.` 后和当前标签 `page.url` 比；相同且 `page.tabId` 仍在则 `chrome.tabs.update`，否则 `chrome.tabs.create`。`www.example.com` 与 `example.com` 算同域，`docs.example.com` 与 `example.com` 不算。侧栏已有 `tabs` 权限，不经 Host。计划条里的 Markdown 同一套逻辑。
- 聊天：`ChatPane` 由当前会话的 `messages` / `isRunning` 驱动；消息列表滚动容器 `flex-col-reverse` + 内层正序消息（工业界贴底：`scrollTop === 0` 就是底部，流式长高不必每帧 `scrollTo`；用户上翻后 `scrollTop` 变负，不再被新内容拽走；滚回距底 &lt; 96px 又贴住）。`column-reverse` 会把唯一子项吸在底：在消息块**之前**插一个 `flex-1 min-h-0` 占位（DOM 里先写占位、后写消息，视觉上占位在下、消息在上），内容不够高时把第一条顶到消息区顶部；撑满后占位收成 0，恢复贴底滚动。「回到底部」不读 `scrollTop` 正负（`col-reverse` 贴底是 0、上翻变负、外滚变正，经过 0 会先显后隐再显）。消息列末尾放 1px sentinel，`IntersectionObserver` 以 `.cs-thread` 为 root、`rootMargin` 底部扩 96px：相交则贴底附近，不相交才稳定显示按钮。离开底部才在输入区上方绝对定位一层 `ArrowDown` 圆钮（约 39px，原 56 的 0.7）：外包一层 `absolute inset-x-0 bottom-full` 居中，避免 `IconButton` 自带的 `relative` 把 `absolute` 顶掉、占满一行。半透明 `--panel` 底、轻投影，hover 提高不透明度，沿用 `IconButton` 涟漪。用户气泡 `w-fit max-w-[80%] ml-auto`，相对消息列表内容区收缩；工具调用和思考不再用带边框的 `details` 卡片，与过程收起同一套 `TextFold`：灰字 + 可选 lucide 图标（`text-[var(--muted)]`）+ 紧挨着的箭头。点开后 `FadeScroll` 用 `max-height` 限高、内容不够则贴内容（过程区 `max-h-[min(36vh,16rem)]`，工具 / 思考 `max-height: 5lh`，约 5 行 11px 灰字），`mix-blend-mode` 上下遮罩。`flex-col-reverse` 下展开用 `scrollTop` 把灰字钉住。markdown 仍是现有组件。`Markdown` 对 ` ```mermaid ` 围栏走自研 `flowchart-svg`：只认 `flowchart`/`graph`（含 TD/TB/BT/LR/RL），`@dagrejs/dagre` 算坐标，同步吐出带 CSS 变量的 SVG（`text` 节点、无 `foreignObject`、不往 `document` 插临时节点）。其它图种或解析失败仍走 `pre > code`。Tailwind preflight 会把 `table` 边框清掉，所以 GFM 表外包 `.cs-md-table`（`overflow-x: auto`），`th`/`td` 用 `color-mix(text 22%, line)` 画 1px 边框（浅色下纯 `--line` 几乎看不见）。`ChatPane` 把消息列抽成 `memo` 的 `MessageThread`，`draft` 只活在输入区，打字不重绘历史消息。`body` 仍 `overflow: hidden`。进行中不再在消息底插「Agent is working」转圈，只靠 `.cs-composer.is-running` 描边。权限 / 提问 / 计划走 `PermissionBar`，作为 `hitl` 插在消息列表和输入框之间（不在输入框下面）；正文 `max-height: 9.5lh` 可滚，按钮露在外面。`TodoList` 同样插在输入框上方（`hitl` 之上）：标题「Todo List - done/total」，整行切换折叠，右侧 `ChevronRight` / `ChevronDown`；完成项右侧 `CircleCheck`（`--ok`）。用 `id+content` 签名检测新规划，变化则 `open=true`，只改 status 不弹开。输入区：可选附件芯片 → `ComposerEditor` contenteditable（默认 `2lh + padding`，封顶 `10lh + padding` 后滚动；`@` 芯片 `height: 1lh`、`max-width: 200px`、与文字混排）→ 第二行 `flex min-w-0`：左簇 `flex-1 min-w-0`（Lucide `Paperclip` / `MousePointer2` / `AtSign` 三钮 `gap-0 shrink-0`，与权限下拉仍 `gap-1`）+ 权限模式（`ModeSelect`：`flex-1 min-w-[5rem] max-w-full`，`Shield` 默认权限 / `FolderPen` 允许文件修改 / `Zap` 允许工具调用 / `Unlock` 允许一切；触发钮单行 `whitespace-nowrap`，文案 `truncate`，`title` 仍是全名；菜单项含灰色解释且不省略，`agentMode` 写入 storage）+ 右簇 `min-w-0 shrink`：模型下拉（仅 `ready` 且列表非空；外壳 `min-w-0 max-w-[9.5rem]`，触发钮同样单行 `truncate`；顶部固定筛选框，打开即聚焦，不区分大小写过滤已加载列表；上下键循环高亮并滚入视口，回车切换）+ `Send` 小飞机 / 停止（14px，`shrink-0`，与顶栏 icon 同大；hover 半透明白圆）。进行中多出停止钮时先挤权限文案；权限触达 5rem 后才 `shrink` 模型钮。`AtMenu` 两 tab（当前打开的标签 / 最近 20 条附件），点选项插入芯片；用户气泡 `UserRichText` 按同一 token 渲芯片。`isRunning` 时 `.cs-composer` 用 `@property --cs-spin`：圆锥渐变经 mask 只画 1px 描边，opacity 淡入铺满 360°，再 4s linear 转一圈；结束只淡出 opacity，sweep 保持满圈以免描边收起。未进行中且 `:focus-within` 时四边 `border-color` 都改成 `--line-focus`（深色把 `--line` 往白混约 22%，浅色往正文混约 22%），`transition` 用 160ms 不要 480ms。`prefers-reduced-motion` 时只铺满不转。工具卡片标题用 `toolTitle(locale, part)`：按 `kind` 与常见英文前缀映射到 i18n，后面的路径/查询不翻译。拾取时 `App` 全栏模糊遮罩 + 居中提示，完成或 Esc 才收。`IconButton` 的 tooltip 用 `position: fixed` 挂到 `document.body`，按锚点测量后翻边/平移，与视口保持 8px。除顶栏外，按钮统一 `hover:bg-[var(--hover)]` + CSS 涟漪（`RippleButton` / `IconButton`）。芯片统一 `max-width: 200px`（文件 / 文件夹 / 图片 / 拾取元素 / `@` 提及相同），文案 `truncate`，`title` 为完整路径、selector 或标签标题。
- 顶栏一行 `flex`：宽栏时左簇为 Agent 下拉或连接状态，标题用 `absolute inset-0` 居中（`TITLE_GAP` 32px 加上左右簇实测宽度，避免叠上按钮），右簇只有抽屉钮（关 `ChevronsLeft` / 开 `ChevronsRight`）。开关灯和语言不在顶栏。`App` 对会话主体（不含抽屉）做 `ResizeObserver`，宽度 `< 348` 为 `compact`：藏 Agent 下拉，标题改居左（不再绝对居中），输入栏只藏 `ModeSelect`，回形针 / 拾取 / `@` 仍留着。拖 Chrome 侧栏或打开/拖宽抽屉都会改主体宽度，同一套阈值。顶栏标题只展示：宽栏槽用明确宽度 `calc(100% - leftPad - rightPad)`（左右簇实测宽 + `TITLE_GAP` 32px），不要 `w-max` + `min-w-0`（flex 项会收成 0，未命名的「新会话」就看不见）。槽内 `justify-center` + `truncate`。窄栏标题在状态条右侧 `flex-1` 居左。没有铅笔、没有顶栏 `input`；改名只走 `SessionDrawer` 卡片上的 `Pencil`。标题 `truncate`，过长省略。`isPlaceholderTitle`（空 / `新会话` / `New Chat`）只在展示层换成 i18n `untitled`（中「新会话」、英「New Chat」），**不写入** `session.title`。空/`新会话`/`New Chat` 视为占位：`titleManual` 也不锁，发消息后走 `titleFromMessages`（首条用户正文首行压空白，或附件名，整行保留）。顶栏不再放 `MessageSquarePlus` / `History` / 开关灯 / 语言。抽屉关闭态入口是 `ChevronsLeft`，展开后换成 `ChevronsRight`。tooltip 用 i18n `expandSessions` / `collapseSessions`（中「展开」「收起」，英 Expand / Collapse）。顶栏按钮不加涟漪。
- 会话列表是右侧抽屉 `SessionDrawer`，不是遮罩模态。`App` 根节点 `flex` 横排：左侧 `flex-1 min-w-0` 是顶栏 + 聊天 + 输入，右侧抽屉 `shrink-0`，打开时把主体往左挤。宽度默认 248px，左缘 6px 拖拽条 `cursor-col-resize`，`pointermove` 时 `newWidth = startWidth + (startX - clientX)`，夹在 196px 与 `min(420, viewport-220)` 之间；拖的时候同样挤压主体。`sessionsOpen` 与 `sessionDrawerWidth` 写入 `PersistedState`。抽屉顶部两个 tab（`会话` 左 `MessageSquare` / `设置` 左 `Settings`，样式对齐 `AtMenu` 顶栏：`flex` + `border-b`，选中 `bg-[var(--hover-strong)] text-[var(--text)]`，未选 `text-[var(--muted)]`）。会话 tab 自上而下：全宽筛选（中文 placeholder「输入关键字以筛选会话...」，英「Filter sessions...」，`py-3` 比原先 `py-1` 上下各多 8px）→ 全宽「新会话」`RippleButton`（Lucide `Plus` + 文案）→ 分组列表。设置 tab 两行 `PrefixedSelect`：左 Prefix `text-[var(--muted)]`（主题 / 语言），右触发钮展示当前值 + `ChevronDown`，菜单向下展开（不要 `overflow-hidden` 裁掉）。主题选项 `light` / `dark` / `system`，文案走 i18n：`themeLight` / `themeDark` / `themeSystem`（中「浅色模式」「深色模式」「跟随设备」，英 Light / Dark / Device），每项左侧 `Sun` / `Moon` / `Monitor`（触发钮也带当前项图标）；语言 `zh` / `en`，选项文案固定「简体中文」/ `English`，不走 i18n 翻译。`App` 把 `theme` / `onTheme` / `onLocale` 传给抽屉，不再传给 `Header`。`groupSessions`：有 `pinnedAt` 的进 Pinned（按 `pinnedAt` 倒序）；其余按本地零点分成 Today / Last 7 days（今天之前、零点往回 6 天）/ Older；空组不渲染。组头是全宽 `button`：左簇为标题 + 紧贴的 `ChevronDown` / `ChevronRight`（展开向下、收起向右），右簇仍是该组条数；`pt-2.5 pb-1.5`（比原先 `pt-1.5 pb-0.5` 上下各多 4px）。点整行切换 `collapsed`（按 `group.id` 记在抽屉 state，默认全开）。英文组名 `uppercase`。键盘上下键只走展开组里的会话。筛选按标题包含、组内 `updatedAt` 倒序。`ArrowUp`/`ArrowDown` 在摊平后的可见列表循环高亮并 `scrollIntoView({ block: "nearest" })`，`Enter` 切换且不关抽屉；Esc 在非输入框时收起。卡片 `py-3.5`（比原先 `py-1.5` 上下各多 8px）。第一行：左侧指示（空闲圆点 / 进行中 `.cs-braille-spin`）+ 标题 `flex-1 truncate` + hover 才 `flex` 出的 `Pin` / `Pencil` / `Trash2`（与标题 `items-center`）。未 hover 时按钮 `hidden`，标题吃满剩余宽度。点 `Trash2` 不立刻删：`ConfirmPopover` portal 到 `document.body`，无遮罩，锚在删除钮。优先下方、右对齐（抽屉在右侧），四边夹 16px，不够翻到上方或压 `max-width` / `max-height`；标题 `truncate`。Esc / 点外面取消；确认才 `onDelete`。确认中该行操作钮保持 `flex`，避免锚点随 hover 卸掉。置顶写 `pinnedAt`，取消则清掉，不改 `updatedAt`。`titleManual` 为真且标题不是占位时不再用首条消息改标题
- 空会话：消息区垂直居中，外层 `select-none`（`user-select: none`），logo 和引导文案都不能划词选中。`<img>` 引用 `packages/extension/assets/icon.svg`（`?url` 打包），约 120×120、`opacity-30 saturate-[.2]`（`filter: saturate(20%)`，不改 SVG 源文件），装饰图 `alt=""` / `aria-hidden`；下面一行淡灰提示。不再用 Lucide `MessageSquareMore`。提示 `w-full` + `padding-inline: min(200px, max(1rem, 50% - 12rem))`：宽时两侧约 200px、一句不折；窄侧栏再收 padding 并允许换行
- 一轮开始记 `turnStartedAt`；`turn.end` / 停止 / 连接报错结束时，若末尾 assistant 的 `createdAt` 不早于开始时间，写入 `durationMs` 并持久化。`AssistantMessage`：找最后一段 `type=text`，它之前是过程。`isRunning` 且该条是最后一条时不收成耗时行：`liveVisibleParts` 把连续的 `reasoning` / `tool-call`（中间没有 `text`）收成只渲最后一条，同一行被新步骤替换。结束后默认收起过程，只留正文；用户展开耗时行时再按原顺序把每一步各占一行。耗时行、思考、工具调用共用 `TextFold`：无底透明全宽 `button`，muted 12px 文案 + 可选 kind 图标 + 紧挨着的箭头（`inline-flex`，不要 `justify-between`）。收起时 `ChevronRight` 仅该行 hover 出现（`group/fold`，避免吃到 `MessageFrame` 的 `group`）；展开后换成 `ChevronDown`。过程区走 `.cs-process-scroll`（只设 `max-height`），思考 / 工具内容走 `max-height: 5lh` 的 `.cs-fold-scroll`。线程是 `flex-col-reverse` 贴底，展开会长高把灰字顶上去：toggle 前记下 `getBoundingClientRect().top`，`useLayoutEffect` 里给 `.cs-thread` 的 `scrollTop` 加上位移，把灰字钉回原处，看起来是向下展开。滚动盒由 `FadeScroll` 包一层 `isolation: isolate`，上下各一条 `mix-blend-mode` 渐变（深色 `multiply`、浅色 `lighten`，色用 `--ink`）；`scrollTop>2` 才显示顶遮罩，距底 `>2` 才显示底遮罩。没有过程（只有正文）不渲染这一行。
- Agent 回复底部 hover 才出现一行（`MessageFrame` 用 `group/msg`，避免和折叠箭头抢未命名 `group`）：左灰色「由 {name} 生成 / Generated by {name}」，右无边框 `Copy` + `GitFork` + `RefreshCw`（`justify-between`）。复制取 `lastTextIndex` 之后的 `type=text`（有过程折起时就是可见正文），先 `navigator.clipboard.writeText`，失败再临时 `textarea` + `execCommand("copy")`，不含 reasoning / tool-call。成功后 `copied`：该行强制 `opacity-100`（避免移开鼠标就看不见），icon 原地换 `Check` 并用 `--ok`，1.5s 后还原。`isRunning` 且该条是最后一条时不渲染这一行。用户气泡 `mt-6`，其余消息 `mt-3`。用户气泡不放操作钮。模型名在本轮第一条 assistant 落盘时写入 `modelId` / `modelName`
- 视觉：窄侧栏（约 380px）、深色橄榄黑 / 浅色中性浅灰层次、深色黄铜 / 浅色钢蓝强调；图标只用 `lucide-react`
- 字体：IBM Plex Sans / Mono（中英都不用衬线体）。Google Fonts 只拉 400/500。`html`/`body` 默认 `font-weight: 400`；`b`/`strong`/标题/`th`、Markdown 标题与表头、以及 Tailwind `font-medium`/`semibold`/`bold` 一律 500（`@theme` 把更重的 weight token 压到 500），避免浏览器 `bolder` 或 preflight 跳出 600/700。
- 工具行左侧按 ACP `kind` 换 lucide 图标：read / edit / execute / search / fetch 等，颜色跟灰字走。`pending` / `in_progress` 时只渲 `LoaderCircle`，结束后才换回 kind 图标，二者不同时出现。标题始终用 `toolLiveHeadline`：短名（`toolLabel`）+ 全角 `：` + `primaryArg`。`tool_call` / 更新时 `withPrimaryArg` 把关键参数写进 `ToolPart.primaryArg` 并落盘；hydrate 时缺了再补算。二次进会话只读已存的 `primaryArg`，不因 args 形态变化丢掉拼接。`TextFold` 一行：外层 `w-full min-w-0`，内层簇 `max-w-full` 随文案变窄；文案 `min-w-0 truncate`（不要 `flex-1`），箭头 `shrink-0` 紧贴文案，只有标题被省略时才顶到行尾。展开后的入参 / 返回走 `ToolJsonView`：字符串以 `{`/`[` 包住才 `JSON.parse`，失败则原文；对象 / 数组直接拆。最外层单 key 只渲 value；其余层每项一段 `key：value`，复合 value 先写 `key：` 再以 `padding-left: 1em` 递进。`formatScalar` / 原文把 `\n{2,}` 压成 `\n`，只空白的段不渲。不再 `JSON.stringify` 进 `pre`。

## 品牌图标

- 源文件 `packages/extension/assets/icon.svg` 由 `scripts/generate_icon.py` 生成，勿手改：Cursor 官方 CUBE_2D 六边形路径做 clipPath 外轮廓；镂空为圆角等腰三角形（`TRI_VERTICES` + `CORNER_R`，经 `ARROW_SCALE`=√3/2 缩放、净逆时针 90° 旋转）；360 个 1° 扇形逼近 conic 渐变，红→黄→绿顺时针风车、交界 40° smoothstep 平滑过渡，整体 `GRADIENT_ROTATE_DEG`=30° 顺时针旋转。空会话占位图直接引用这份 SVG，不另做淡色线稿
- PNG 用 `rsvg-convert` 从 SVG 导出（16/32/48/128，保留透明），放 `packages/extension/public/icons/`，crxjs 构建时拷到 `dist/icons/`
- manifest 的 `icons` 与 `action.default_icon` 都指向这四张图

## 仓库结构

```
README.md           面向用户的产品页与安装（不写开发命令或仓库树）
docs/REQUIREMENTS.md  需求：做什么、为什么
docs/TECH_DESIGN.md   本文件：怎么做、为什么选这个方案
docs/DEVELOPMENT.md   开发构建、Host 注册、工作区、打 CRX、tag 发 Release
docs/images/          README 用的 logo 与海报（不引用 packages/ 源码路径）
docs/demo/            README 用的侧栏演示视频（H.264 MP4）。`opensider.mp4` 仍是上一镜 Wikipedia → Gutenberg 检索（2880×1800，不裁 16:9）；下一镜计划「今日 AI 新闻 TOP 10 → HTML → 浏览器滚动预览」，分镜在 `NEXT-TAKE.md`，点头前不替换成片。打字可 setpts 加速，发送前空等硬切，Agent 流式/等待 4x–6x，新标签/产物/打开简报 1x–2x，滚动预览 1x；BGM 用已下载的 CC 曲、始终 1x（见 MUSIC.md）
cmd/opensider       唯一 Go 入口（host / install / pick）
internal/           Host / install / pick / ACP
packages/shared     扩展 ↔ Host 消息类型（TS）
packages/extension  Chrome MV3（background / content / sidepanel）
scripts/install     用户壳 install.sh / install.ps1
scripts/pack-extension.mjs  把 dist 打成 zip + CRX3
scripts/keys        扩展 CRX 签名钥（固定打包 ID）
.github/workflows   tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。开发命令与加载 `packages/extension/dist` 的步骤只写在 `docs/DEVELOPMENT.md`，根目录 README 只服务使用者。

## 演示录制

产品侧栏 = Chrome **Side Panel**（manifest `side_panel` + `sidePanel` 权限 + `openPanelOnActionClick`），不是 `default_popup`。点工具栏图标时，聊天 UI 必须和网页停在同一窗口右侧。

下一镜证明 **跨页读多个真网站 + 交出能在浏览器打开的 HTML**。开录停在 Hacker News（广告少）；Agent `openTab` The Verge / Ars，`reportArtifacts` 后用 localhost `openTab`（或 `open -a Google Chrome` + 人手滚）预览 `outputs/ai-news-top10.html`。`openTab` 不能开 `file://`。不要把 Finder 当高潮。源站必须英文-only。击键走 macOS ABC/US，禁止拼音候选条。

录制约束：侧栏约窗口 1/4 靠右；只采 Mac 内建屏（ffmpeg screen 0）。成片 **保持采集原分辨率**（本机内建屏常见 1440×900@2x → 2880×1800），禁止 crop / scale-to-1080 / pad 成 16:9。剪辑：打字 1.8x–2.5x；打完到发送的停顿硬切；Agent 思考/工具/流式 4x–6x；新标签落地、产物条、打开简报 1x–2x；滚动预览与用户点击 1x。BGM 用网上已授权的开源曲（CC0 / CC-BY），1x、不跟 setpts 升调（见 MUSIC.md）。结尾留到简报已打开并滚过、侧栏回合结束；不要在流式中途 SIGINT。

## 发布与安装壳

用户侧不克隆仓库。一行壳永远打 `releases/latest`，按本机只下一份 Host 二进制，校验后再把安装交给该二进制。

### 用户壳

`scripts/install/install.sh`（darwin / linux）与 `scripts/install/install.ps1`（Windows）是薄包装，不内嵌 Host 逻辑：

1. 识别 OS / arch。POSIX：`uname -s` → `darwin` / `linux`；`uname -m` 把 `aarch64` 映射成 `arm64`、`x86_64` 映射成 `amd64`。Windows：`PROCESSOR_ARCHITECTURE` 为 `ARM64` 时下 `opensider-windows-arm64.exe`，否则 `opensider-windows-amd64.exe`。
2. 从 `https://github.com/parksben/opensider/releases/latest/download/` 拉 `SHA256SUMS` 和对应二进制（名必须与 Release 资产一致）。代码与 Release 都在私仓 `parksben/opensider`。
3. 用本机 `sha256sum` / `shasum -a 256` 或 `Get-FileHash` 核对该文件；对不上或 SUMS 里没有这一行就退出。
4. `chmod +x` 后 `exec ./opensider-<os>-<arch> install`（Windows 为 `.\opensider-windows-*.exe install`）。`--local` 只给仓库里的 `go run`，用户壳不传。
5. 其它 OS / arch 立刻失败，文案写清支持范围。

壳不负责解压扩展或写 Native Messaging 清单；那是 `opensider install` 的事。

### 开发脚本

根 `package.json`：`install-host` → `go run ./cmd/opensider install --local`；`pack-extension` → `node scripts/pack-extension.mjs`（把 `packages/extension/dist` 打成 `dist-release/extension.zip` 和 CRX3 `dist-release/opensider.crx`）；`build` 先编扩展，再打包，再跑 `install --local`。`dev` 仍只起 Vite。不再走 Node 安装器。打包脚本只用 Node 内置 `crypto` / `zlib`，不另加 crx 依赖。`dist-release/` 不入库。

### tag 发 Release

`.github/workflows/release.yml` 在推送 `v*` tag 时跑，`contents: write` 以便 `gh release create`。

| Job | Runner | 做什么 |
|---|---|---|
| `build-darwin` | `macos-latest` | Go 1.22+，`CGO_ENABLED=1`，产出 `opensider-darwin-arm64`；在同一台机器上再试 `GOARCH=amd64`（`CC=clang`），编得出来才上传 |
| `build-cross` | `ubuntu-latest` | `CGO_ENABLED=0`，`GOOS=linux/windows` × `GOARCH=amd64/arm64`（Windows 带 `.exe`） |
| `release` | `ubuntu-latest`（等前两个） | `pnpm install` + `pnpm --filter @opensider/extension build` **一次**，再跑 `pnpm pack-extension` 产出 `extension.zip` 与 `opensider.crx`；拷贝两份安装壳；下载二进制工件；写 `SHA256SUMS`；`scripts/release-notes.sh` 打 commit 列表；`gh release create` |

扩展只在 `release` job 编一次，darwin / cross 不再装 Node。darwin 开 cgo 是为了本机 `pick`（AppKit）；linux / windows 交叉编译关 cgo，避免依赖目标系统的 C 工具链。macos-latest 现在是 Apple Silicon，darwin/amd64 属于尽力：SDK 够就编，不够就跳过，不挡发版。

Release 资产名必须和壳一致：

- `opensider-darwin-arm64` / `opensider-darwin-amd64`（后者可选）
- `opensider-linux-amd64` / `opensider-linux-arm64`
- `opensider-windows-amd64.exe` / `opensider-windows-arm64.exe`（后者可选，流水线仍编）
- `extension.zip`
- `opensider.crx`
- `install.sh` / `install.ps1`
- `SHA256SUMS`

`scripts/release-notes.sh` 找当前 tag/HEAD 之前最近的 `v*` tag（没有则为空），打印 `git log --pretty=format:'- %h %s'`。Release body 只有这份 commit 列表，不加产品介绍。

## 风险

| 风险 | 处理 |
|---|---|
| Native Messaging 环境 PATH 很瘦 | Host 自己扫 nvm / npm-global / bun / `~/.opencode/bin` 等 bin；子进程 PATH 带上 CLI 所在目录。Cursor 仍默认同 `~/.local/bin/agent` |
| macOS 切 Agent 弹 Gatekeeper（`.xxxx.node`） | Host 只 exec 用户 PATH 上的 CLI，不去 quarantine。**OpenCode** 官方二进制（`curl -fsSL https://opencode.ai/install` / GitHub `opencode-darwin-arm64`）仍是 adhoc/linker-signed，启动时把未公证 `watcher.node` 解到 `$TMPDIR`，官方重装不能公证。**Gemini**（`@google/gemini-cli`）和 **Claude ACP**（`@agentclientprotocol/claude-agent-acp`）是 npm，附带 adhoc `.node`，无法 Apple 公证。**Copilot** 官方 cask `copilot-cli` 是 Notarized Developer ID（GitHub `VEKTX9H2N7`）；npm `@github/copilot` 仍有未公证 addon。Homebrew `gemini-cli` 已弃用，`antigravity-cli`（`agy`）不是探测目标（仍认 `gemini --experimental-acp` / `--acp`）。用户点「完成」并在隐私与安全性允许；不要「移到废纸篓」 |
| 探测卡住 starting | 探测后台化 + 总时限；ProbeACP 不继承 Host stdio、杀进程组；SW 10s 看门狗 |
| 换 Agent 卡在鉴权 / 握手 | 进度条右侧取消；Host 先握手新进程再停旧进程，取消回上一份 ready 或 idle |
| 旧 `~/.opensider` 混着 Node Host 残留 | 备份后 `install --local` 重建 runtime / workspace |
| macOS 拦 Chrome 执行 Desktop 上的 Host | `opensider install`（开发时 `--local`）把运行副本放到 `~/.opensider/runtime` |
| macos-latest 编不出 darwin/amd64 | 该资产可缺；Intel Mac 用户要等能编出来的 tag，或用源码 `go run` |
| Cursor `WritableIterable is closed` | 成功轮次按 `end_turn`，剥掉该关流字；空轮仍报错。改不了 Cursor CLI 本身 |
| `session/load` 不支持或失败 | 新建 ACP 会话，界面历史保留，下一条消息带前文 |
| `session/fork` 不可用或不支持指定消息 | 新会话 + 首条 prompt 前缀截断记录 |
| chrome.storage 变大 | 工具输出超长时截断再写入 |
| 卸载/重装扩展清空 chrome.storage | 权威副本在 `~/.opensider/ui-state.json`；空态不得覆盖已有镜像 |
| 内容脚本无法注入 | `current.json` 只写 url/title，命令返回明确错误；Host 超时仍落 `results/<id>.json` |
| 扩展重载 / CRXJS 异步 loader 后旧标签没有接收端 | 页面命令与快照走同一套 `ensureContent` + 主框 `__opensiderPage` 调用，不用 `tabs.sendMessage` |
| Chrome 杀 Service Worker | 重连 Native Host；ACP 子进程随 Host 退出，重连后 load/new |
| 侧栏晚于 Host ready 才连上 | SW 回放最近状态 |
| React StrictMode 拆掉端口后再 postMessage | 页面存活期间不拆端口；卸载只摘监听器 |
| 侧栏 connect 时 SW 还在加载 crx loader | 先 ping 再 connect；空断后自动重连 |
| 重试无效 | 强制重连 Native Host；`connect` 唤醒 SW，失败原因写到顶栏 |
| 发消息无反馈 | 输入和 isRunning 由 App state 驱动，不走 useAuiState |
| 命令文件误触发 | 只认 `browser/commands/*.json` 且含 `id`+白名单 `method` |
| Agent 仍把产物写到工作区根目录 | AGENTS.md + tools.json 引导 `outputs/`；Ensure 建目录。不拦截 Write/Shell |
| 受控输入收不到赋值 | fill/type 用原生 value setter + beforeinput/input/change；contenteditable 再退 `execCommand` |
| 点击找不到可点目标 | 优先 interactive.md 的 index / 控件 label，再 selector 与可见文本 |
| 表单控件没有 innerText | 交互快照带 label/placeholder/name；`text`/`label` 命中控件而不是标题 |
| 自定义下拉不是 `<select>` | fill/select 对 combobox/listbox 先点击再选 option 文本 |
| 导航后内容脚本被卸掉 | 标签级导航走 `chrome.tabs.update`，完成后再抓快照 |
| 系统页无法拾取 | chrome:// 等直接报错；Esc / 再点拾取取消 |
| 截图超过 Native Messaging 1MB | JPEG + 最长边 1280 + 质量下调；只传 base64，落盘后再给 Agent 路径 |
| 扩展页 `<img src="file://…">` 被 Chrome 拦 | 不再走 `file://`；Host 分片回传，侧栏 `blob:` |
| 预览图超过 Native Messaging 1MB | 512KiB 原文分片；单文件上限 32MB，超限回 i18n 失败文案 |
| 元素截图像素比不对 | 用 `devicePixelRatio` 把 CSS 盒映射到截图像素 |
| 扩展选文件没有真路径 | Host 用 `PickFiles.app`（`open -W`）弹出访达多选，回绝对路径 |
| Chrome 子进程弹不出 NSOpenPanel | 直接 exec `PickFiles`（regular 激活）到前台；空退则访达 `choose file` |
| 点拾取后旧标签没有内容脚本 | SW `scripting.executeScript` 按 manifest 补注入（`injectImmediately`，必要时 `allFrames`），并等 CRXJS loader 就绪 |
| YouTube `/watch` 点拾取不进态 | `document_start` + 等 loader；不当系统页；活动主框直接 `startPick`；顶层遮罩 + 短臂保护；`yt-navigate` 后补挂层；注入失败可见报错 |
| ACP 不广告模型列表 | 用该 CLI 的 list 命令（Cursor `agent models`、OpenCode `opencode models`）解析账号模型；有 `configOptions` 时合并并用于 set |
| `session/set_model` 被拒 | 先 `session/set_config_option`；initialize 声明 `parameterizedModelPicker` |
| ACP 拒绝 `auto` | Auto 只表示不指定；不调用 set_model / set_config_option |
