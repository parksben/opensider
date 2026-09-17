# OpenSider — 技术设计

> 产品名 OpenSider。Chromium 扩展通过 Native Messaging 托管 `agent acp`；页面感知用内容脚本 + 工作区文件，不使用 MCP，不运行常驻本地服务。Host 是一份预编译 Go 二进制（`cmd/opensider`：无参=Host，`install`，`uninstall`，`version`，`extension-dir`，`pick`）。对外名称、包名、Native Host、本机目录和 storage key 都用 `opensider` / `com.opensider.host` / `~/.opensider`。不迁旧目录 `~/.cursor-sidebar`。

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
- Go Host 一启动就往 `~/.opensider/host.log` 打一行，便于判断 Chrome 有没有真正拉起 Host（该文件按大小与日期轮转，见下）

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

### Host 请求的可靠性与版本错配

扩展与本机 Host 是**两份各自更新的东西**：扩展随 release 走，Host 只在用户跑安装 / 更新 skill 时才被覆盖。于是「新扩展 + 旧 Host」是常态，而旧 Host 对不认识的消息只有一句 `default: return nil`——静默丢掉。用户看到的就是「拖进去了（提示都弹了）但附件栏没变化」，没有任何线索。三道门都要堵上：

- **Host 必须应答**（`internal/host/host.go`）：带 `requestId` 的消息走 `default` 分支时，回一条 `{type: "host.unsupported", requestId, command, error}`，侧栏当普通失败处理（`hostUnsupported` 文案 + 指向更新 Host）。新命令遇上旧 Host 从此是「一句明确的错」，不是无限等。
- **侧栏侧超时**（`App.tsx`）：`fs.save` / `fs.upload` 这类「发出去等回执」的请求带超时（20s），超时即报错并让那次调用返回空——不能让 `await` 悬死。`fs.pick` / `page.pick` 要等人操作（系统选择器、页面上点元素），不设超时。判定用「回调身份比对」：回执先 `delete` 再调回调，超时回调发现自己的函数已经不在表里就直接返回，不会双次结算。
- **版本错配要明说**：Host 的 `hello` 带 `version`；侧栏用 `isNewer(EXTENSION_VERSION, hostVersion)` 判断 Host 落后，落后就报一次（只报一次，避免刷屏），文案指向更新 Host / 看 `~/.opensider/host.log`。两边版本任何一边解析不出数字（本地 dev 构建）时就闭嘴。
- **提示要看得见**：上面这些失败都走侧栏的 `notice`（输入框上方一条可关闭的提示条），**不是** `error`——`error` 只在 `status === "error"` 时作为正文渲染，`ready` 时只是状态药丸的 `title` tooltip，而拖入 / 粘贴失败恰恰发生在 `ready` 状态下，用 `error` 等于没提示（用户的原话是「拖进去了但附件栏没变化」）。文案口径见 REQUIREMENTS「聊天」第 16 条：按钮叫它自己的名字（「添加附件 / Add attachments」）、位置写「输入框底部 / under the input field」、不出现「回形针」这类图标外号，面向用户也不出现 `Host`（统一叫「本地桥接程序 / the local bridge」，`versionBridge` 与 `hello` 版本错配提示同一套词）。

拖入文件的取数链路也按「不许只有一条路」重写（`packages/extension/src/sidepanel/file-drop.ts`）：每个 `item` 先试 `webkitGetAsEntry()`，拿不到 entry 就用同一个 item 的 `getAsFile()`；**有 entry 时也把 `getAsFile()` 的结果带着**，作为 `entry.file()` 失败或迟迟不回调（3s 超时）时的兜底；一个 entry 都没有、item 也拿不到文件时，才退回 `dataTransfer.files`（放在最后是为了不重复：真拖拽里 `files` 与 `getAsFile()` 是同一批对象，两边都收会变成两份附件）。整条链路跑完一个文件都没有、也没跳过任何文件时，侧栏报「读不出拖入的文件」——用户至少知道拖拽这条路没通。

### 日志轮转（host.log）

`internal/log` 每次写之前先看两件事：当前文件加上这一行会不会超过 `MaxBytes`（2MB），以及文件的修改日期是不是还停在「今天」（本机时区）。任一不成立就把 `host.log` 改名成 `host.log.<YYYYMMDD-HHMMSS>`，再按名字倒序只留最近 `MaxFiles`（5）份。**正在写的那份路径永不变**，所以 README 表格、`doctor`、skill 里的 `tail -n 12 ~/.opensider/host.log` 都不受影响；日期规则保证长期挂着的 Host 跨天也会切片，不会把几天混在一个文件里。

几个不动声色的细节：改名失败（Windows 上用户可能正用编辑器占着这个文件）时记一个 60s 的退避时间戳，期间不再尝试——否则每写一行都要失败一次；调用方完全无感，切片不影响当次写入；历史片只按名字删，不做「按内容/时间排序」的重活（`internal/log/log_test.go` 覆盖大小切片、跨天切片、保留份数、以及切片不丢行）。

## 工作区布局

```
~/.opensider/
  runtime/
    opensider                # 唯一 Go 二进制（Windows 为 opensider.exe）
    claude-acp/              # prefix-local @agentclientprotocol/claude-agent-acp（无 admin）
      node_modules/.bin/     # claude-agent-acp；已在 AgentSearchDirs
    codex-acp/               # 同理存 @agentclientprotocol/codex-acp
      node_modules/.bin/     # codex-acp；同样在 AgentSearchDirs
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
      uploads/<name>         # 拖进侧栏的文件 / 文件夹（复制一份，浏览器不给本机路径）
      native-ui.json         # 最近 50 条原生 UI 事件（alert/confirm/...）
  session.json               # 最近一次选中的 ACP sessionId（兼容旧版）
  ui-state.json              # 侧栏权威状态（会话列表/消息/偏好）；扩展卸载后仍在
  extension-path             # 用户选定的扩展目录（单行绝对路径，`opensider extension-dir` 读写）
  release-check.json         # 最新 Release tag 的 1h 缓存
  host.log                   # 正在写的那份；历史片是同目录的 host.log.<YYYYMMDD-HHMMSS>
```

解压后的扩展**不在** `~/.opensider` 下：它的位置由用户在安装时选定（skill 先问，建议 `~/OpenSider`，`paths.DefaultExtensionDir()` 只在没读过记录时兜底），并记在 `~/.opensider/extension-path`（`opensider extension-dir` 读写）。不默认放下载目录：那是「清理下载」和清理工具的常客，删了扩展就一直失效到重新加载。点目录在系统文件选择器里默认不可见，而「加载已解压的扩展程序」是用户手动的一步，放在看得见的地方才做得下去。

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

reveal 的平台实现分在 `internal/reveal/reveal_{darwin,linux,windows}.go`：macOS `open -R <path>`；Linux 先 `dbus-send … FileManager1.ShowItems`（path 转 `file://` URI），失败退 `xdg-open <dir>`；Windows 用 `explorer.exe /select,"<path>"`。**Windows 这条不能交给 Go 拼参数**：`explorer.exe` 不按 `CommandLineToArgvW` 解析命令行，而 `os/exec` 只要参数里含空格就把整串加引号，拼出来是 `explorer "/select,C:\a b\c.txt"`——explorer 认不出 `/select` 开关，只会弹一个与目标无关的窗口。路径带空格时必现，而 Windows 主目录/用户名带空格极常见，所以这不是边角。做法是自己拼命令行（`SysProcAttr.CmdLine` 原样交给 `CreateProcess`），等价于手敲 `explorer.exe /select,"C:\a b\c.txt"`。拼装函数 `explorerSelectCmdLine` 与断言放在**不带 build tag** 的 `reveal.go` / `reveal_test.go` 里：写进 windows-only 文件就只有 Windows 跑得到，本机与 CI 都测不了。explorer 成功也常返回 1，按老规矩容忍；`CmdLine` 真起不来（含双引号等非法情形）才退到打开所在目录。

**主世界钩子的注入时机（native UI 与页面活动态共用）**：这两层都必须改**页面自己的 JS 世界**（主世界）里的原生 API，而主世界一旦被动过，页面就能探测到——`Function.prototype.toString` 不再是 `[native code]`、`HTMLDocument.prototype` 上多出自有的 `hidden` / `visibilityState` / `hasFocus`、`window` 上多出 `__opensiderNativeUi` / `__opensiderActivity` 两个不可配置全局。实测（`scripts/verify-page-tamper.mjs`，干净 Chromium vs. 装了扩展的 Chromium 逐项对比）这就是 11 个非原生入口 + 2 个全局的「篡改指纹」，而抖音这类站点在加载期做环境自检、判定环境脏就拒绝初始化自己的播放器。所以：

- **不声明成常驻 `content_scripts`**。两个钩子在 `manifest.config.ts` 里仍然登记（`matches: ["<all_urls>"]` + `exclude_matches: ["<all_urls>"]`），**因为只有这样才能在运行时从 `chrome.runtime.getManifest()` 读到 CRXJS 构建出来的带 hash 的文件名**；`exclude_matches` 全覆盖保证 Chrome 自己永远不会注入它们。
- **按需注入**：`background.ts` 的 `ensurePageHooks(tabId)` 用 `chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", files })` 注入，钩子自身的 `if (host[KEY]) return` 保证幂等。触发点是「侧栏开着 + Agent 触及该标签」：`port.onConnect`（面板打开时的活动标签）、`dispatchCommand`（每条命令都先 `armActivity`，读完原生 UI 事件后按需补注入 native UI 钩子）、`runNativeUiMethod`（`getNativeUi` / `setDialogPolicy` 不再报「reload the tab」，而是先补注入再重试）。
- **为什么不能靠 `run_at: document_start`**：内容脚本是经典脚本，CRXJS 把它们编成 `assets/xxx-loader-*.js` + `await import("…")`，真正的代码要等模块 fetch + 编译。实测页面自身首个 `<script>` 已经在 ~18ms 跑完，钩子到 ~39ms 才落地（对照组：手写纯 JS 的 `document_start` 主世界内容脚本在 50ms 落地、页面脚本 52ms，确实在页面之前）。也就是说原先注释里「先于任何页面脚本拿到入口」的承诺从来就不成立，反而是在页面初始化**进行到一半**时把 API 换掉——比 `document_start` 更糟。按需注入就没有这个尴尬：装上时页面早就初始化完了，我们只在「Agent 要动手」的语义下改环境。
- **感知不受影响**：`browser/tabs.json` / `current.json` / 「当前活动标签」全部来自 SW 的 `chrome.tabs` / `chrome.windows`，以及隔离世界的内容脚本；主世界注入范围收窄不会动到它们。
- **未触及的页面必须逐项一致**：`scripts/verify-page-tamper.mjs` 把「什么都别动」变成 CI 能查的断言（未触碰页面 0 个非原生入口 / 0 个全局 / `Object.getOwnPropertyNames(HTMLDocument.prototype) === ["constructor"]`；触及后钩子到位；释放后还原到与未触碰时**完全一致**）。
- **释放即卸载**：`releaseActivity()`（侧栏收起 / 最后一个面板端口断开 / 扩展重置）除了解除武装，还会调 `releasePageHooks()`：两个钩子把包过的入口换回捕获到的原函数、`EventTarget.prototype` 与 `document` 原型上的补丁移除、并把各自挂在 `window` 上的全局删掉（所以是 `configurable: true`）。面板关了之后这个标签页又变回一个普通页面；下次触及再注入（钩子自身的 `if (host[KEY]) return` 保证幂等）。`release` 与 `set` / `read` 不同，**不接受「第一次调用学 token」**——只有已经证明过身份的 SW 能卸载它。
- **已知代价**：注入之前（页面刚打开、Agent 还没碰过）弹的原生对话框不会被记录、也不会被代答；`file-chooser` 拦截同理。这是「不给没在用的页面留痕」换来的，写进 `REQUIREMENTS.md` 第 15 条的边界与 `agents.md`。

**原生 UI 感知与代答**：页面调 `alert` / `confirm` / `prompt` / `print()` / `window.open()`，或点 `<input type=file>` 唤出系统选择器时，扩展要把这件事变成 Agent 能读的事件，并在被授权时同步代答。这些 API 全在页面的 JS 线程里，Chrome 扩展没有别的入口，所以做法是**主世界注入 + 预推策略**：

- `src/native-ui-hook.ts` 是主世界钩子（按上面的「主世界钩子的注入时机」按需注入，`all_frames: true`），在闭包里包住那几个入口，只往 `window` 挂一个不可配置、带 token 校验的 `__opensiderNativeUi`（token 只走 `chrome.scripting.executeScript` 的 args，页面拿不到）。每次调用先生成事件，再决定「放行（调原生）/ 代答（直接返回策略值）」。
- **拉取式，不走 postMessage**：主世界没有 `chrome.*`，所以钩子只负责缓冲事件和持有策略，SW 在命令前后用 `executeScript` 在 `allFrames` 里读回来（`read` / `setPolicy`，token 校验）——没有 relay 文件，也不需要页面配合。
- **默认 `observe`**：只记录、真弹窗照旧。因为放行后我们拿到返回值，所以**用户自己答案是 true/false 还是那段文本都能记下来**。`answer` 模式必须 Agent 显式 `setDialogPolicy` 打开，带过期时间（默认 120s），过期自动回 `observe`——否则用户之后正常浏览时的弹窗会被静默吞掉。
- **为什么不能「挂起等答复」**：`confirm` / `prompt` 是同步 API，代答必须在调用当帧返回，所以策略只能提前推下去缓存。这也决定了工具面的形状：先 `setDialogPolicy`，再触发那一下点击，而不是弹出来再回答。
- 事件汇总：SW 按 tab 留最近 50 条并转发 Host（`browser/native-ui.json`）；命令执行期间到达的事件**并进该命令的结果**（`data.nativeUi`），Agent 点一下就知道弹了什么，不必再读文件。
- 覆盖与边界：JS 弹窗（alert/confirm/prompt）、`print()`、`window.open()`（含被拦下时返回 null）、`<input type=file>` 的 `click()` / `showPicker()` 都能感知，除文件选择器外都能代答。**真正的浏览器 / 系统 UI 做不到**——权限授权框、HTTP 认证框、下载气泡、系统文件选择器窗口、证书警告。只有 `chrome.debugger`（CDP 的 `Page.handleJavaScriptDialog`、`Page.fileChooserOpened` + `DOM.setFileInputFiles`、`Browser.setPermission`）能看能操作，代价是「正在调试此浏览器」横幅 + 与 DevTools 互斥 + `debugger` 权限。做与不做都要写进 `agents.md`，别让 Agent 去猜一个不存在的能力。
- 工具面：新增 `getNativeUi`（事件 + 权限状态 + visibility/fullscreen/beforeunload）与 `setDialogPolicy`，`browser/tools.json` 的 `version` 8 → 9。

**页面活动态（可见 / 有焦点）**：浏览器窗口被盖住、被最小化、或标签不在前台时，Chrome 把页面标成 `hidden`：`document.visibilityState === "hidden"`、`document.hasFocus()` 为假、`requestAnimationFrame` 不再回调、定时器降频（hidden 1/秒，5 分钟后 1/分钟）。不少站点据此自行暂停（懒加载、动画组件、把点击挡在「未激活」遮罩后面），后台跑页面自动化就卡住。扩展侧的处理是把「页面读到的状态」改掉，而不是去动窗口：

- `src/activity-hook.ts` 同样按需注入的主世界钩子（`world: MAIN`、`allFrames: true`），**默认完全惰性**，只往 `window` 挂一个不可配置、带 token 校验的 `__opensiderActivity`（与 native UI 钩子同一套 caller-token 风格；token 只走 `chrome.scripting.executeScript` 的 args，页面拿不到，所以页面无法自己开关）。被武装后：`document.visibilityState` → `visible`、`document.hidden` → `false`、`document.hasFocus()` → `true`；在 `EventTarget.prototype` 上拦掉 `visibilitychange` / `blur` / `pagehide` / `freeze` 的监听注册（含 `document.onvisibilitychange` 访问器），页面因此不会自己暂停；真的被隐藏时把 `requestAnimationFrame` 回退成 ~16ms 定时器（等帧的页面/脚本才会继续跑）。解除武装即**还原原始 descriptor 与函数**，不留常驻 hack。
- 生命周期由 SW 定：只要还有侧栏端口（`sidebars` 非空），就对「Agent 正在动的标签」武装——面板打开时的活动标签、以及 `requestPage` / `dispatchCommand` 每次触及的标签（`openTab` / `switchTab` 换页自然跟上），同时把这些标签的 `autoDiscardable` 置 false，避免后台被 Chrome 直接丢弃。**最后一个侧栏端口断开**（侧栏收起）就把全部标签解除武装、`autoDiscardable` 还原。SW 重启或页面导航会丢掉武装状态，靠「用到就重新武装」自愈（注入是幂等的）。
- 不抢焦点：不 `windows.update({ focused: true })`、不取消最小化、不主动 `tabs.update({ active: true })`——用户看得见的窗口行为一点不变。
- 边界（写进 `agents.md`，不许吹）：这层只改**页面可见的 API**，让页面自己认为可见；Chrome 自己的后台降频 / 渲染降级取消不掉（只有 `chrome.debugger` 的 CDP 能，代价同第 15 条），所以后台执行可能比前台慢，不等于「强制前台渲染」。另外**武装之前**页面已经注册好的 `visibilitychange` 监听会照旧收到事件——钩子是「用到才注入」，页面大概率早就注册完了，所以这条不是边角而是常态；`window.onblur` 这种 `on*` 属性我们只托管 `document.onvisibilitychange`。
- 工具面：`browser/tools.json` 加静态说明项 `pageActivity`（「面板开着时，Agent 在动的标签被强制为可见 / 有焦点；窗口不被抢焦点」），`version` 9 → 10；`getNativeUi` 报的 `visibility` 就是强制后的值。

**页面自己的浮层（模态框 / 抽屉 / 遮罩）**：点一下按钮之后，站点常常不是在原地变，而是弹一个**页面自己**的层（`role=dialog`、`aria-modal`、`<dialog open>`、高 z-index 且 fixed/absolute 盖住可观察面积的容器）。这层不在浏览器原生弹窗那套里，Agent 很容易把「弹了模态框」当成「点了没反应」，重复点或直接告诉用户没效果。做法：

- 页面方法 `getOverlays`：在开放 Shadow DOM 与同源 iframe 里找出上面那几类层，每条带 `role` / 可读标题 / 正文摘录 / `zIndex` / 盖住视口的比例 / 是否几乎铺满，以及背景被 `inert` 或 `aria-hidden` 的迹象。判定逻辑抽在纯函数里（拿样式与属性喂它），DOM 收集部分在 `interactive.ts` 旁边的 `overlays.ts`，跟交互快照一样忽略我们自己的光标与拾取层。
- **操作类命令自动带上**：SW 在 `isActionMethod` 的命令跑完后再拉一次浮层快照，把结果挂进 `data.overlays`——但只在**集合出现或变化**时挂（按 tab 记上一份签名），没变化就不往结果里塞噪音。它和 `data.nativeUi`（浏览器原生弹窗）互补，看局面时两个都要看。
- 同一份快照发给 Host 落盘 `browser/overlays.json`（没有浮层就写空表，不留下上一次的旧值），Agent 随时可读。
- 工具面：`browser/tools.json` 的 `version` 10 → 11；`agents.md` 里写清「动作后先确认预期变化有没有发生」的整套流程。

## 多会话与 fork

工作区仍是一个。ACP 会话可以有多条，侧栏用本地 `id` 和 `acpSessionId` 对应。

```
chrome.storage.local 与 ~/.opensider/ui-state.json（同形）
  savedAt?: ISO time           # 镜像比较用
  locale: "en" | "zh"          # 首次无偏好：浏览器 UI 中文→zh，否则 en
  theme: "light" | "dark" | "system"  # 首次无偏好：system；system 跟 prefers-color-scheme
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
| `session.new` + `requestId` | 在空闲（或新开的）ACP 进程上 `session/new`，回 `session` 时原样带回 `requestId`。不打断正在跑的进程 |
| `session.use` + `sessionId` + `requestId` | 该会话已在某进程上且正在跑则只回 `session`（replay，带 `requestId`），不 `session/load`；否则在空闲进程上 `session/load`，失败则 `session/new`（回执带新 id + `requestId`） |
| `session.fork` + `sessionId` + `requestId` | 在空闲进程上先试不稳定的 `session/fork`（整段历史）；失败则 `session/new`；回执带 `requestId` |
| `prompt` 可带 `sessionId` + `requestId` | 绑到已持有该会话的进程，或空闲进程 `session/load` 后再 prompt。同一会话已有一轮在跑则拒绝；不同会话并行。若 `session/load` 失败被迫换新会话，用带该 `requestId` 的 `session` 回执通知侧栏更新绑定 |
| `prompt` + `interrupt: true` | 「立即发送」专用：该会话正在跑时，Host 先对它在跑的 runtime 发 `session/cancel`，**等那一轮 return**（有上限，超时就照样往下走）再开始新的一轮；被顶掉那轮结束时 `turn.end` 带 `interrupted: true`，侧栏只结算时长与内容、**不清 running、不 flush 队列**（新一轮已经在跑）。不这么做就会变成「侧栏自己计时 + 等 `turn.end` 再发」，而 `turn.end` 只要没到（cancel 打空、ACP 会话 id 漂了）消息就静默丢掉 |
| `cancel` 可带 `sessionId` | 只取消该 ACP 会话所在进程的一轮；**找不到该会话就不动手**（早期会「随便挑一个 prompting 的进程」取消，导致 B 的停止杀掉 A 的任务） |
| `update` / `turn.end` / `permission` / `cursor` 带 `sessionId` | 侧栏按 ACP id 精确映射到本地会话，**不按当前选中项；映射不到就丢弃**（不允许落到「当前选中」，那是串戏的主要通道）。`turn.end` 在 `stopReason=error` 时带 `error` 原文（Host 已改写成可执行的登录提示），侧栏顶栏直接显示，不要换成一句笼统的「这一轮以错误结束」 |
| `fs.pick` | Host 弹出本机选文件/文件夹对话框，回 `fs.picked`（绝对路径 + kind） |
| `fs.save` | Host 把侧栏压好的 JPEG 写到 `browser/pasted/`，回 `fs.saved`（绝对路径 + kind=image） |
| `fs.upload` + `name` + `dir?` + `base64` | 拖进来的文件：Host 校验并写到 `browser/uploads/<dir?>/<name>`（逐段 sanitize，不许 `..` / 绝对路径），回 `fs.uploaded`；`dir` 是拖进来的文件夹名时同时带回顶层文件夹项（新增的目录才带，便于侧栏只挂一次） |
| `fs.uploaded`（Host → 侧栏） | 拖入的文件 / 文件夹写盘结果：`items`（绝对路径 + kind，文件夹那张只在新建了目录时带）+ 可选 `error`；侧栏按 `path` 去重合并进输入框附件栏 |
| `fs.reveal` + `path` | Host 打开系统文件管理器并选中该文件；路径不存在则回 `fs.revealed`（`missing: true` + error），其它失败也回 error 但不标 missing；成功不回 |
| `fs.revealed`（Host → 侧栏） | reveal 失败时带 `path` / `error` / 可选 `missing`；侧栏只在 `missing` 时按 path 把该条产物标失效并持久化 |
| `fs.preview` + `path` + `requestId` | Host 读本机图片（绝对路径、常规文件、图像类型、上限 32MB），按 512KiB 原文分片 base64 回多条 `fs.previewed` |
| `fs.previewed`（Host → 侧栏） | 成功：`mime` / `size` / `index` / `total` / `data`；失败：`error`。侧栏拼 `blob:`；失败文案走 i18n，不加句号 |
| `artifacts`（Host → 侧栏） | `reportArtifacts` 成功后整表覆盖该会话产物列表；带 `sessionId` 时侧栏精确匹配，找不到就丢弃 |
| `page.pick` | SW 让当前标签内容脚本拾取元素，回 `page.picked`（CSS selector，kind=element）；不转发 Host |
| `model.set` | 非 `auto` 时 `session/set_config_option`（`category: model`）；失败再试 `session/set_model`。**只作用于已持有该会话的进程**；找不到就只记 `pendingModelID`（下次打开该会话时应用）并回 `models`——不得抢别的空闲进程做 `session/load`（会静默漂移绑定、换掉别人会话） |

从某一轮之后 fork：

1. 新本地会话，复制该消息及之前的气泡，原会话不动。
2. 若 fork 的是**最后一条**且 Agent 支持 `session/fork`，用 ACP fork，Agent 历史与 UI 对齐，不必再灌上下文。
3. 否则 `session/new`。Agent 是空会话，把截断后的对话写成 `pendingForkContext`，**下一条用户消息**前缀带上（UI 不显示这段包装）。这样 Agent 不会为了灌上下文先回一嘴。

侧栏用 `runningIds`（不持久化）记哪些本地会话有一轮在飞，不再用全局一把锁。`isRunning` 只表示**当前选中**会话在跑（输入框描边、停止钮、该会话的 fork / 重生成 / 改历史）。新建和切换始终允许；流式 `update` / `turn.end` / HITL 按消息上的 ACP `sessionId` 写回对应本地会话。**会话绑定不用「到达顺序」配对**：侧栏每次 `session.new` / `session.use` / `session.fork` / `prompt` 生一个 `requestId` 存进 `Map<requestId, {localId, kind}>`，`session` 回执只认 `requestId` 精确命中（命不中不改绑定、直接忽略）；不带 `requestId` 的回执（SW 重连回放、Host 自发消息）不参与绑定。缓冲随连接错误 / 连接重置整体清空，避免残留项吞掉后续回执。`localIdForAcp` 只做精确映射，从 `sessionAcpIds` 里找不到就返回 undefined；`update` / `turn.end` / `permission` / `cursor` / `artifacts` 拿到 undefined 一律丢弃——宁可少画，不许落到当前选中会话。浏览器工具（`browser.command` / `browser.result`）没有 ACP `sessionId` 可用：Host 在转发 `browser.command` 时尽力标注会话（恰好一个进程在 `prompt` 时标它的会话；多进程同时跑或都在空闲时不标），SW 执行完把同一标注带回 `browser.result` 一起广播；侧栏有标注就精确路由（映射不到丢弃），没标注才退回「选中 / 唯一运行中」启发式。切到别的会话时，若目标自己正在跑则不要再 `session.use`。权限 / 提问 / 计划按会话存放，只在看着该会话时画出来；「允许工具调用」仍会自动回掉所有会话里待批的权限；「允许一切操作」还会立刻回掉待批的提问和计划。切走后不再自动过。页面工具仍共用一个工作区，两条 Agent 同时改页面时可能打架，这是并行的取舍。会话列表里进行中的卡片左侧用六点盲文字符（`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`）CSS `content` 循环代替圆点，不要再在标题旁挂 `LoaderCircle`。

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

`packages/extension/src/sidepanel/i18n.ts` 提供 `en` / `zh` 词条。首次无镜像、无 `chrome.storage` / Host 偏好时，`detectBrowserLocale()` 读 `chrome.i18n.getUILanguage()`（备 `navigator.language`）：`zh*` → `zh`，否则 `en`。已有偏好不再重探测。完整 state 仍写 `chrome.storage.local`；切换时同步镜像 `localStorage` 的 `opensider/locale`。`theme-boot.js` 同时读这份镜像并设 `document.documentElement.lang`；无镜像时当场按浏览器 UI 语言设 lang，避免先闪英文。React 初始 state 也从镜像或探测结果读。连接错误原文（Host / Chrome `lastError`）不翻译。composer `placeholder` 在发送提示后补一句 `@` 引用：中「输入@可引用内容」、英「Type @ to mention」。输入框上方 todo 标题走 `todoList`：英「Todo List - {done}/{total}」，中「待办项 - {done}/{total}」。

## 主题

`theme.ts`：偏好 `light | dark | system`，解析后给 `document.documentElement.dataset.theme`。`system` 时听 `prefers-color-scheme`。Chrome 不向扩展暴露外观三项（浅色 / 深色 / 设备），所以首次无偏好时 `detectBrowserTheme()` 固定为 `system`：浏览器设为跟随系统时设置项也是跟随设备；实际明暗仍跟 `prefers-color-scheme`（Chrome 锁浅色/深色时该查询也会变）。已有偏好不再重探测。完整 state 仍写 `chrome.storage.local`（`theme` 必填）；切换时同步镜像 `localStorage` 的 `opensider/theme`。`index.html` 只在 `<head>` 用 `<script src="./theme-boot.js">` 加载同目录的 `src/sidepanel/theme-boot.js`（独立 classic script、非 inline，避免 MV3 CSP），在 React 之前读这份镜像并设 `data-theme`；无镜像时按 `system` 解析，避免每次打开先闪默认深色。不要放进 `public/`，也不要从 React/TS `import`：Vite 7 + CRXJS serve 会把 HTML script 转成 `import()`，而 public 资源禁止被 import，dev 会 Internal server error、侧栏白屏。构建时 Vite 不会打包无 `type="module"` 的 script，所以 `vite.config.ts` 把同一份文件发到 `dist/src/sidepanel/theme-boot.js`，与 HTML 相对路径对齐。React 初始 state 也从镜像读，`useLayoutEffect` 再 apply。颜色全走 CSS 变量：`:root` / `[data-theme=dark]` 是现有橄榄黑；`[data-theme=light]` 是中性浅灰层次（画布 `--ink` `#f3f4f6` → 抬升 `--panel` 近白 → 凹陷 `--panel-2`），少蓝、少脏；正文冷灰黑（muted 用石板灰）+ 钢蓝强调（仍走 `--brass` token）。`--hover` / `--code` / `--user` / `--on-brass` / `--overlay` 两套分开，组件不再写死 `#161910` 这类只适合深色的底。图走 CSS 变量配色，不跑 mermaid `initialize`。顶栏 `Sun` / `Moon` / `Monitor` 循环三态。

## 附件（只传路径）

Chrome 的文件选择器不会给出本机绝对路径。加号发给 Host `fs.pick`（带 `mode`: `mixed` | `files` | `folders`）。侧栏用 UA 判断：macOS 直接 `mixed`（`NSOpenPanel` 一次混选）；其它系统在回形针上方弹出「多选文件 / 多选文件夹」再发对应 mode。Host **exec 自己**加 `pick`（Chrome 子进程里直接弹框经常出不来）。Windows `IFileOpenDialog` 与 Linux zenity/kdialog/portal 都是文件或文件夹二选一：选项为 `FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_ALLOWMULTISELECT`，文件再或 `FOS_FILEMUSTEXIST`、文件夹再或 `FOS_PICKFOLDERS`；多选连着 `FOS_ALLOWMULTISELECT`，所以结果必须走 `IFileOpenDialog::GetResults`（`IShellItemArray`）而不是 `IFileDialog::GetResult`，否则拿不到用户选的项。取消时 `Show` 返回 `HRESULT_FROM_WIN32(ERROR_CANCELLED)`，按「用户取消」回空列表，不当错误。`fs.stat` 分成 `image` / `file` / `folder`。侧栏芯片只展示 `basename`，`title` 是全路径。未连上就点加号，侧栏写明确错误。

剪贴板里的截图同样没有本机路径，不能当文件选。composer `paste` 若带 `image/*`，先按页面截图那套压成 JPEG（最长边约 1280、质量约 0.72、base64 &lt; 700KB，以免 Native Messaging 超 1MB），再 `fs.save` 落到 `~/.opensider/workspace/browser/pasted/`。回包后当普通 `kind: image` 芯片，走同一套 `wrapAttachments`。Chrome 会把同一张图同时挂在 `clipboardData.files` 和 `items` 上，且 `getAsFile()` 的 `lastModified` 往往对不上，按 name/size/mtime 去重会漏。`clipboardImages` 只读 `files` 里的图片；没有才退到 `items`。有图时 `preventDefault`，避免二进制糊进 textarea；若同时带纯文本则插到光标处。落盘完成前不让发送，以免消息先走、图还没进附件。未连上或压图/写盘失败写明确错误。

拖进来的文件同样没有本机路径，做法是把字节送到 Host 写盘再当普通附件（`TypeScript` 侧拿不到路径，`File.path` 在 Chrome 里不存在）：

- 面板根部（`ChatPane`）挂一个 `dropTarget`：`dragenter` / `dragover` 上判断 `dataTransfer.types` 是否含 `Files`，含就 `preventDefault`（这一步是基础——不做的话浏览器会直接导航/打开那个文件，就是用户看到的现象），并显示盖满整屏的提示层；`dragleave`（计数归零）/ `drop` 收掉。不带 `Files` 的拖拽（文本、面板内 `draggable`）一概不碰。
- `drop` 里先同步抓 `dataTransfer.items` 的 entry（异步之后 `items` 就失效了），用 `webkitGetAsEntry()` 区分文件 / 文件夹：文件直接用 `File`，文件夹递归读子树（上限：单文件 ≤ 480KiB 原文、整次拖拽 ≤ 200 个文件，超了报错并提示改用回形针，那条走系统选择器直接拿路径、无大小限制）。符号链接 / 读不出来的项跳过。
- 每个文件读成 base64（分块 `btoa`，别用 `String.fromCharCode(...bytes)` 爆栈），发 `{ type: "fs.upload", requestId, name, dir?, base64 }`（`dir` 为拖进来的文件夹名，文件在子目录时带上相对路径）。Host 写 `browser/uploads/`，回 `fs.uploaded`，侧栏 `mergeAttachments` 去重后落进输入框附件栏。进行中同样可拖（跟附件栏其它入口一致）。
- 限制在两侧都做：侧栏先拦（超限不上传、给文案），Host 复核（base64 长度、段级 sanitize、`..` 与绝对路径一律拒），不信任侧栏。

剪切 / 复制整个输入框时把附件栏一起带走（跨会话搬草稿不用重上传）：

- **载荷不走剪贴板**：Chromium 只把一小撮标准风味（`text/plain`、`text/html`、`image/png`…）真正写进系统剪贴板，自定义 MIME 出不了本文档，而且把标记塞进 HTML / 文本里会污染粘到别的应用的内容。所以改成**扩展自己记一小段时间**：全选 `copy` / `cut` 时把 `{text, attachments, at}` 写进 `chrome.storage.session`（key `opensiderComposerCarry`），下次 `paste` 的**纯文本与它规范化后完全相等**时把附件还原（按 `path` 去重），并立刻清掉这份载荷（一次性）。TTL 90s，防止很久之后的巧合粘贴意外带出附件；文本不一致（部分选中、粘贴的是别的内容）一律不还原。
- `src/sidepanel/composer-clipboard.ts` 是纯逻辑：`encode/decodeComposerCarry`（校验版本、条数上限、每条的 `path` / `name` / `kind`，坏数据整份丢掉）、`composerCarryMatches`（TTL + 规范化文本相等）、`mergeAttachmentItems`、`normalizeComposerText`。
- `ComposerEditor` 在 `copy` / `cut` 上用 `coversWholeEditor` 判断「选区是否覆盖输入框全部内容」：拿选区**渲染文本**与编辑器 `innerText` 规范化后对比（芯片两边都是文件名，能对上），**不用** `selectNodeContents` 的边界点——实测 `Cmd+A` 选中的是文本，边界点比它靠里一位，拿边界点会直接把真正的全选判掉；同时仍然要求选区两端都在编辑器里，避免误判整页全选。判中才回调 `ChatPane`；不是就一步不多做（`copy` / `cut` 走同一个回调，回调**只负责把载荷记下来**，附件栏一律不动：`cut` 后面板里少掉的是正文，那本来就是浏览器自己剪的）。
- `paste` 顺序不变：先 `clipboardImages`（图片照旧进附件栏，这条不能被抢），再插正文（并把正文交给 `ChatPane` 去做还原判定），最后才看有没有待还原的附件。

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

Host 推 mode 时先看这次 `session/new|load|fork` 广告出来的值（ACP `modes`，以及 `configOptions` 里 `id/category=mode` 的选项），只在广告集合与 Profile `modeMap` 的交集里试；没有广告过的 id 一律不发。先 `session/set_mode`，失败再 `session/set_config_option`（OpenCode 1.18+ 的 mode 只走后者，选项是 `build` / `plan`，没有 `bypassPermissions` / `auto`）。**Cursor ACP 没有第四种 session mode**：`ask` / `workspace` / `auto` / `unattended` 都映射到 `agent`，真正的「允许一切」只在侧栏拦卡。其它 CLI 的 `unattended` 复用该家最宽的**已广告** mode（OpenCode 是 `build`，Copilot 是 `#autopilot`，Claude 仍是 `bypassPermissions`）。没有任何交集则只在客户端拦卡，不要拿未知 mode 去砸 RPC。提问/计划自动答不经过 Host，侧栏直接 `cursor.reply`。

侧栏 `ModeSelect` 外壳与 `ModelSelect` 一样**不要** `overflow-hidden`：省略只写在触发钮的 `truncate` 上。菜单用 `absolute bottom-full`（或 portal + `fixed`）画在按钮上方；外壳一裁，点击就像没反应（模型下拉能开、权限下拉不能，就是这个差）。文案走 `i18n`，按系统设置口吻写（短标题 + 一句说明，不要营销句）：`ask`「默认权限 / Ask every time」灰字「用户确认后方可调用工具 / Confirm each tool」；`workspace`「允许文件修改 / Allow workspace edits」灰字「允许工作区内文件修改，执行命令、联网操作仍需确认 / Workspace file edits skip confirmation; commands and network still ask」；`auto`「允许工具调用 / Auto-run tools」灰字「直接执行工具调用，问题和计划仍需确认 / Tools skip confirmation; questions and plans still need a click」；`unattended`「允许一切操作 / Allow all」灰字「工具、问题、计划无需确认 / Don't ask about tools, questions, or plans」。图标：`Shield` / `FolderPen` / `Zap` / `Unlock`。`isWorkspaceWritePermission` 按 `toolCall.kind` / `title` 启发式：命中 execute/shell/bash/terminal/command/fetch/http/network/web_search/mcp 则仍弹卡，命中 edit/write/delete/move/create/patch/apply 才自动过。客户端不按路径判断是否出目录；出目录仍问靠 Agent 的 `acceptEdits`。`autoQuestionAnswers`：每题取 `options[0].id`，没有则 `selectedOptionIds: []`。

## 多 Agent CLI

Host 是通用 ACP Client + 数据驱动 `AgentProfile`（启动命令、鉴权、modeMap、contextFiles、gates）。不经 acpx。探测：内置名单（Cursor / OpenCode / Copilot / CodeBuddy / Claude 适配器 / Codex 适配器 / Gemini / Qwen / Kimi / iFlow / Trae / Qoder 等）+ Chrome 传入的 PATH + 本机常见 bin（`~/.local/bin`、`~/.opencode/bin`、`~/.npm-global/bin`、`~/.bun/bin`、nvm / fnm / volta / asdf）+ ACP Registry。Chrome Native Messaging 的 PATH 不含 nvm，只搜系统目录会漏掉 `copilot` 这类 `#!/usr/bin/env node` 安装。`AgentSearchDirs` 固定包含 `~/.opensider/runtime/claude-acp/node_modules/.bin`（`paths.ClaudeACPBinDir`），即使目录刚创建也能搜到。Claude Code 只认 `claude-agent-acp` / `claude-code-acp`（含该 prefix），不把交互式 `claude` 当成 ACP（`--acp` 不存在，硬加会把 TUI 当已安装）。`opensider install` 在 Host 注册之后跑 `EnsureClaudeACP()`：探测 `claude`（`ResolveOnPath` + 显式 `~/.local/bin/claude` / Windows `%USERPROFILE%\.local\bin\claude.exe`，PATH 漏掉 `.local\bin` 也能找到）；已有适配器则校验路径并打印；Claude 在而适配器不在则用 npm（优先）/ pnpm / bun 把 `@agentclientprotocol/claude-agent-acp` 装进 `~/.opensider/runtime/claude-acp`（约 5 分钟超时，stdout/stderr 直接给用户）。装进自有 prefix 而不是 `npm i -g`：不需要 sudo/admin、bin 路径稳定、且已在探测搜索路径上。Windows 的 `npm.cmd` / `pnpm.cmd` 必须走 `cmd /c`（`ComSpec`），不能直接 `CreateProcess`。没有 Claude 就跳过；没有 Node 18+ 只提示。失败不挡 Host 注册，也不要求 `ProbeACP` / `claude` 登录成功。安装逻辑只在 Go（skill 只做编排与引导），跨平台差异不写进提示词。探测在 Host 进 `idle` 之前于后台完成，而且**只看二进制在不在**（`ResolveOnPath`），启动阶段不再对每家跑 `initialize`——握手会把 `agent acp` / `copilot` 的 stdout 弄脏 Native Messaging 管道，hello/status 就被堵住。同一绝对路径不重复列。真正点连接再走完整握手。ProbeACP 仍给按需解析用：子进程必须自建 stdin/stdout、不能继承 Host 管道，超时后杀进程组且 `Wait` 有上限。Registry HTTP 在本地名单已经 `idle` 之后再补，失败就跳过。拉起子进程时把该 CLI 所在目录和上述 bin 预进 PATH，避免 `env node` 找不到。Copilot 的 `modeMap` 用 ACP session-modes URL（`#agent` / `#plan` / `#autopilot`），不要发 `default`/`ask`。`~/.gemini` 属 root 时 Gemini `session/new` 会 EACCES，Host 把错误改写成 chown 说明。OpenCode 常见安装是 Bun 打成的单文件（`~/.opencode/bin/opencode`），`acp.Client.Start` 只 `exec` 探测到的绝对路径加 `acp`，不复制、不重签该大文件。拉起时带上 `natives.Prepare(agentID)`：`TMPDIR` 钉在 `~/.opensider/runtime/natives/opencode`，并对解出的小型 `.node` 清 quarantine + adhoc 签名（见上表）。OpenCode 1.18+ `session/new` 的 mode 在 `configOptions`（`build` / `plan`），`initialize` 的 `authMethods` 指向 `opencode auth login`；`modeMap` 用这两档，鉴权失败由 `hostErrorText` 改写成登录命令。侧栏会话自己持有消息；`Session.acpByProvider` 记各家 ACP id。换 Agent 不删本地历史；该家没有绑定则 `session/new` 并带本地前文。模型列表按当前 provider 的 `configOptions` / `session.models` / list 命令刷新（OpenCode 为 `opencode models`），Copilot 空名单走内置公开表。引导是标题栏下方内容区垂直居中的纯文本按钮，点即连接。顶栏 Agent 下拉 portal 到 `document.body`，避免被消息盖住。会话标题相对 header 居中，左右各留 32px。引导完成前 Host 不拉起 Agent 进程。换 Agent（或首次点连接）时 Host **先**握手新进程、成功后再 `Stop` 旧 runtime，这样取消只需停新进程、旧会话还在。侧栏在 `requestConnect` 之前记下上一份 `providerId` 与是否 `ready`；点取消发 `agent.cancelConnect`，立刻还原 `selectedProviderId` / 会话绑定，清掉进度，且不再把随后的 `idle` 自动连到被取消的那一家。已 `ready` 不画取消钮。Service Worker 若约 10s 仍停在 `starting`（Host 没回 `idle` / `ready` / `error`），改报 error 并写 `~/.opensider/host.log`，不要转圈到永远。

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

历史上用 `scripts/keys/extension.pem` 签过 CRX3，打包 ID 为 `clnpnldmjaklambmaglpckjlgkicmcpb`。当初生成 `key` 时私钥没有留档，不能用同一把钥匙再签，否则会改未打包 ID、侧栏 `chrome.storage` 会丢。因此打包 ID 与未打包 ID 不同，Host 清单 `allowed_origins` 仍同时写这两个 origin（兼容曾经 sideload 过打包扩展的机器）。**不再把 CRX 当作安装路径，Release 也不再上传 `opensider.crx`，仓库里也不再放任何密钥**（`scripts/keys/` 整目录已 gitignore，本机留档）：既然不出 CRX，签名密钥就没有用途——算 ID 只要公钥，而公钥本来就不是秘密。打包脚本改去校验**真正要紧的那个 ID**：读构建产物 `dist/manifest.json` 的 `key` 算出未打包 ID，与常量比对；它才是决定用户身份、改了就丢侧栏数据的值，比过去那个空转的「打包 ID 自检」有意义。

历史遗留：那把私钥在**历史提交**里存在过（改公开仓库时未重写历史），仍可 `git log --all -- scripts/keys/extension.pem` 取回。影响评估：它只解锁「签出 ID 为 `clnpnldmjaklambmaglpckjlgkicmcpb` 的 CRX」，而 (1) 稳定版 Chrome 基本不允许商店外装 CRX，(2) 项目不分发 CRX、也没有 `update_url` 或已安装基数可搭车，(3) **同样的能力本来就不需要私钥**——`manifest.json` 的 `key` 是公开的，任何人照抄即可拿到未打包 ID 去连 Host。要出事得用户主动装一个冒名扩展，这把钥匙不构成额外风险，因此没有为它重写历史。

Host 注册名：`com.opensider.host`  
macOS 清单路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opensider.host.json`

使用者主路径：把**安装提示词**发给自己在用的本机 AI Agent，由它按 `skills/opensider/` 的 skill 执行（流程见本文件「发布与 skill 安装」）。清单 `path` 指向 `~/.opensider/runtime/opensider`。README 只写产品、演示和这一步，不含开发搭建。开发：`pnpm install-host`（dev-only）= `go build -o ~/.opensider/runtime/opensider ./cmd/opensider` + 拷 `packages/extension/dist` 到下载目录下的 `OpenSider` + 跑该二进制 `install`；**禁止**把 `go run` 写成 Native Host path，Chrome 保不住这个进程。`install` 同时 `workspace.Ensure()`，马上就有 `AGENTS.md` / `browser/tools.json` / `outputs/`。macOS TCC 仍要求二进制不在 Desktop / Documents / Downloads。Host 日志只写 `~/.opensider/host.log`，不写 stderr。从 Node 时代留下的 `~/.opensider`（`PickFiles.app`、`runtime/packages`、旧 `session.json`）可能和 Go Host 打架；skill 的 doctor 要能识别这类残留并先备份再重建，开发机重新 `pnpm install-host`。推送 `v*` tag 触发 Actions：darwin 在 macOS 开 cgo 编，linux/windows 交叉编译；Release 说明只列最近 3 个 commit。桥接未注册时 SW 轮询 `connectNative`。不迁旧目录。

## UI

- Agent 回复链接：`Markdown` 自定义 `a`，一律 `preventDefault`（侧栏是扩展页，默认点击会把面板自己导航走）。解析 `href`（相对地址相对当前页），只放行 `http(s)`。把主机名小写、去掉末尾 `.`、剥一层前导 `www.` 后和当前标签 `page.url` 比；相同且 `page.tabId` 仍在则 `chrome.tabs.update`，否则 `chrome.tabs.create`。`www.example.com` 与 `example.com` 算同域，`docs.example.com` 与 `example.com` 不算。侧栏已有 `tabs` 权限，不经 Host。计划条里的 Markdown 同一套逻辑。
- 聊天：`ChatPane` 由当前会话的 `messages` / `isRunning` 驱动；消息列表滚动容器 `flex-col-reverse` + 内层正序消息（工业界贴底：`scrollTop === 0` 就是底部，流式长高不必每帧 `scrollTo`；用户上翻后 `scrollTop` 变负，不再被新内容拽走；滚回距底 &lt; 96px 又贴住）。`column-reverse` 会把唯一子项吸在底：在消息块**之前**插一个 `flex-1 min-h-0` 占位（DOM 里先写占位、后写消息，视觉上占位在下、消息在上），内容不够高时把第一条顶到消息区顶部；撑满后占位收成 0，恢复贴底滚动。「回到底部」不读 `scrollTop` 正负（`col-reverse` 贴底是 0、上翻变负、外滚变正，经过 0 会先显后隐再显）。消息列末尾放 1px sentinel，`IntersectionObserver` 以 `.cs-thread` 为 root、`rootMargin` 底部扩 96px：相交则贴底附近，不相交才稳定显示按钮。离开底部才在输入区上方绝对定位一层 `ArrowDown` 圆钮（约 39px，原 56 的 0.7）：外包一层 `absolute inset-x-0 bottom-full` 居中，避免 `IconButton` 自带的 `relative` 把 `absolute` 顶掉、占满一行。半透明 `--panel` 底、轻投影，hover 提高不透明度，沿用 `IconButton` 涟漪。用户气泡 `w-fit max-w-[80%] ml-auto`，相对消息列表内容区收缩；工具调用和思考不再用带边框的 `details` 卡片，与过程收起同一套 `TextFold`：灰字 + 可选 lucide 图标（`text-[var(--muted)]`）+ 紧挨着的箭头。点开后 `FadeScroll` 用 `max-height` 限高、内容不够则贴内容（过程区 `max-h-[min(36vh,16rem)]`，工具 / 思考 `max-height: 5lh`，约 5 行 11px 灰字），`mix-blend-mode` 上下遮罩。`flex-col-reverse` 下展开用 `scrollTop` 把灰字钉住。markdown 仍是现有组件。`Markdown` 对 ` ```mermaid ` 围栏走自研 `flowchart-svg`：只认 `flowchart`/`graph`（含 TD/TB/BT/LR/RL），`@dagrejs/dagre` 算坐标，同步吐出带 CSS 变量的 SVG（`text` 节点、无 `foreignObject`、不往 `document` 插临时节点）。其它图种或解析失败仍走 `pre > code`。Tailwind preflight 会把 `table` 边框清掉，所以 GFM 表外包 `.cs-md-table`（`overflow-x: auto`），`th`/`td` 用 `color-mix(text 22%, line)` 画 1px 边框（浅色下纯 `--line` 几乎看不见）。`ChatPane` 把消息列抽成 `memo` 的 `MessageThread`，`draft` 只活在输入区，打字不重绘历史消息。`body` 仍 `overflow: hidden`。进行中不再在消息底插「Agent is working」转圈，只靠 `.cs-composer.is-running` 描边。权限 / 提问 / 计划走 `PermissionBar`，作为 `hitl` 插在消息列表和输入框之间（不在输入框下面）；正文 `max-height: 9.5lh` 可滚，按钮露在外面。`TodoList` 同样插在输入框上方（`hitl` 之上）：标题「Todo List - done/total」，整行切换折叠，右侧 `ChevronRight` / `ChevronDown`；完成项右侧 `CircleCheck`（`--ok`）。用 `id+content` 签名检测新规划，变化则 `open=true`，只改 status 不弹开。输入区：可选附件芯片 → `ComposerEditor` contenteditable（默认 `2lh + padding`，封顶 `10lh + padding` 后滚动；`@` 芯片 `height: 1lh`、`max-width: 200px`、与文字混排）→ 第二行 `flex min-w-0`：左簇 `flex-1 min-w-0`（Lucide `Paperclip` / `MousePointer2` / `AtSign` 三钮 `gap-0 shrink-0`，与权限下拉仍 `gap-1`）+ 权限模式（`ModeSelect`：`flex-1 min-w-[5rem] max-w-full`，`Shield` 默认权限 / `FolderPen` 允许文件修改 / `Zap` 允许工具调用 / `Unlock` 允许一切；触发钮单行 `whitespace-nowrap`，文案 `truncate`，`title` 仍是全名；菜单项含灰色解释且不省略，`agentMode` 写入 storage）+ 右簇 `min-w-0 shrink`：模型下拉（仅 `ready` 且列表非空；外壳 `min-w-0 max-w-[9.5rem]`，触发钮同样单行 `truncate`；顶部固定筛选框，打开即聚焦，不区分大小写过滤已加载列表；上下键循环高亮并滚入视口，回车切换）+ `Send` 小飞机 / 停止（14px，`shrink-0`，与顶栏 icon 同大；hover 半透明白圆）。进行中多出停止钮时先挤权限文案；权限触达 5rem 后才 `shrink` 模型钮。`AtMenu` 两 tab（当前打开的标签 / 最近 20 条附件），点选项插入芯片；用户气泡 `UserRichText` 按同一 token 渲芯片。`isRunning` 时 `.cs-composer` 用 `@property --cs-spin`：圆锥渐变经 mask 只画 1px 描边，opacity 淡入铺满 360°，再 4s linear 转一圈；结束只淡出 opacity，sweep 保持满圈以免描边收起。未进行中且 `:focus-within` 时四边 `border-color` 都改成 `--line-focus`（深色把 `--line` 往白混约 22%，浅色往正文混约 22%），`transition` 用 160ms 不要 480ms。`prefers-reduced-motion` 时只铺满不转。工具卡片标题用 `toolTitle(locale, part)`：按 `kind` 与常见英文前缀映射到 i18n，后面的路径/查询不翻译。拾取时 `App` 全栏模糊遮罩 + 居中提示，完成或 Esc 才收。`IconButton` 的 tooltip 用 `position: fixed` 挂到 `document.body`，按锚点测量后翻边/平移，与视口保持 8px。除顶栏外，按钮统一 `hover:bg-[var(--hover)]` + CSS 涟漪（`RippleButton` / `IconButton`）。芯片统一 `max-width: 200px`（文件 / 文件夹 / 图片 / 拾取元素 / `@` 提及相同），文案 `truncate`，`title` 为完整路径、selector 或标签标题。
- 顶栏一行 `flex`：宽栏时左簇为 Agent 下拉或连接状态，标题用 `absolute inset-0` 居中（`TITLE_GAP` 32px 加上左右簇实测宽度，避免叠上按钮），右簇只有抽屉钮（关 `ChevronsLeft` / 开 `ChevronsRight`）。开关灯和语言不在顶栏。`App` 对会话主体（不含抽屉）做 `ResizeObserver`，宽度 `< 348` 为 `compact`：藏 Agent 下拉，标题改居左（不再绝对居中），输入栏只藏 `ModeSelect`，回形针 / 拾取 / `@` 仍留着。拖 Chrome 侧栏或打开/拖宽抽屉都会改主体宽度，同一套阈值。顶栏标题只展示：宽栏槽用明确宽度 `calc(100% - leftPad - rightPad)`（左右簇实测宽 + `TITLE_GAP` 32px），不要 `w-max` + `min-w-0`（flex 项会收成 0，未命名的「新会话」就看不见）。槽内 `justify-center` + `truncate`。窄栏标题在状态条右侧 `flex-1` 居左。没有铅笔、没有顶栏 `input`；改名只走 `SessionDrawer` 卡片上的 `Pencil`。标题 `truncate`，过长省略。`isPlaceholderTitle`（空 / `新会话` / `New Chat`）只在展示层换成 i18n `untitled`（中「新会话」、英「New Chat」），**不写入** `session.title`。空/`新会话`/`New Chat` 视为占位：`titleManual` 也不锁，发消息后走 `titleFromMessages`（首条用户正文首行压空白，或附件名，整行保留）。顶栏不再放 `MessageSquarePlus` / `History` / 开关灯 / 语言。抽屉关闭态入口是 `ChevronsLeft`，展开后换成 `ChevronsRight`。tooltip 用 i18n `expandSessions` / `collapseSessions`（中「展开」「收起」，英 Expand / Collapse）。顶栏按钮不加涟漪。
- 会话列表是右侧抽屉 `SessionDrawer`，不是遮罩模态。`App` 根节点 `flex` 横排：左侧 `flex-1 min-w-0` 是顶栏 + 聊天 + 输入，右侧抽屉 `shrink-0`，打开时把主体往左挤。宽度默认 248px，左缘 6px 拖拽条 `cursor-col-resize`，`pointermove` 时 `newWidth = startWidth + (startX - clientX)`，夹在 196px 与 `min(420, viewport-220)` 之间；拖的时候同样挤压主体。`sessionsOpen` 与 `sessionDrawerWidth` 写入 `PersistedState`。抽屉顶部两个 tab（`会话` 左 `MessageSquare` / `设置` 左 `Settings`，样式对齐 `AtMenu` 顶栏：`flex` + `border-b`，选中 `bg-[var(--hover-strong)] text-[var(--text)]`，未选 `text-[var(--muted)]`）。会话 tab 自上而下：全宽筛选（中文 placeholder「输入关键字以筛选会话...」，英「Filter sessions...」，`py-3` 比原先 `py-1` 上下各多 8px）→ 全宽「新会话」`RippleButton`（Lucide `Plus` + 文案）→ 分组列表。设置 tab 两行 `PrefixedSelect`：左 Prefix `text-[var(--muted)]`（主题 / 语言），右触发钮展示当前值 + `ChevronDown`，菜单向下展开（不要 `overflow-hidden` 裁掉）。主题选项 `light` / `dark` / `system`，文案走 i18n：`themeLight` / `themeDark` / `themeSystem`（中「浅色模式」「深色模式」「跟随设备」，英 Light / Dark / Device），每项左侧 `Sun` / `Moon` / `Monitor`（触发钮也带当前项图标）；语言 `zh` / `en`，选项文案固定「简体中文」/ `English`，不走 i18n 翻译。`App` 把 `theme` / `onTheme` / `onLocale` 传给抽屉，不再传给 `Header`。`groupSessions`：有 `pinnedAt` 的进 Pinned（按 `pinnedAt` 倒序）；其余按本地零点分成 Today / Last 7 days（今天之前、零点往回 6 天）/ Older；空组不渲染。组头是全宽 `button`：左簇为标题 + 紧贴的 `ChevronDown` / `ChevronRight`（展开向下、收起向右），右簇仍是该组条数；`pt-2.5 pb-1.5`（比原先 `pt-1.5 pb-0.5` 上下各多 4px）。点整行切换 `collapsed`（按 `group.id` 记在抽屉 state，默认全开）。英文组名 `uppercase`。键盘上下键只走展开组里的会话。筛选按标题包含、组内 `updatedAt` 倒序。`ArrowUp`/`ArrowDown` 在摊平后的可见列表循环高亮并 `scrollIntoView({ block: "nearest" })`，`Enter` 切换且不关抽屉；Esc 在非输入框时收起。卡片 `py-3.5`（比原先 `py-1.5` 上下各多 8px）。第一行：左侧指示（空闲圆点 / 进行中 `.cs-braille-spin`）+ 标题 `flex-1 truncate` + hover 才 `flex` 出的 `Pin` / `Pencil` / `Trash2`（与标题 `items-center`）。未 hover 时按钮 `hidden`，标题吃满剩余宽度。点 `Trash2` 不立刻删：`ConfirmPopover` portal 到 `document.body`，无遮罩，锚在删除钮。优先下方、右对齐（抽屉在右侧），四边夹 16px，不够翻到上方或压 `max-width` / `max-height`；标题 `truncate`。Esc / 点外面取消；确认才 `onDelete`。确认中该行操作钮保持 `flex`，避免锚点随 hover 卸掉。置顶写 `pinnedAt`，取消则清掉，不改 `updatedAt`。`titleManual` 为真且标题不是占位时不再用首条消息改标题
- 空会话：消息区垂直居中，外层 `select-none`（`user-select: none`），logo 和引导文案都不能划词选中。`<img>` 引用 `packages/extension/assets/icon.svg`（`?url` 打包），约 120×120、`opacity-30 saturate-[.2]`（`filter: saturate(20%)`，不改 SVG 源文件），装饰图 `alt=""` / `aria-hidden`；下面一行淡灰提示。不再用 Lucide `MessageSquareMore`。提示 `w-full` + `padding-inline: min(200px, max(1rem, 50% - 12rem))`：宽时两侧约 200px、一句不折；窄侧栏再收 padding 并允许换行
- 一轮开始记 `turnStartedAt`；`turn.end` / 停止 / 连接报错结束时，若末尾 assistant 的 `createdAt` 不早于开始时间，写入 `durationMs` 并持久化。`AssistantMessage`：找最后一段 `type=text`，它之前是过程。`isRunning` 且该条是最后一条时不收成耗时行：`liveVisibleParts` 把连续的 `reasoning` / `tool-call`（中间没有 `text`）收成只渲最后一条，同一行被新步骤替换。结束后默认收起过程，只留正文；用户展开耗时行时再按原顺序把每一步各占一行。耗时行、思考、工具调用共用 `TextFold`：无底透明全宽 `button`，muted 12px 文案 + 可选 kind 图标 + 紧挨着的箭头（`inline-flex`，不要 `justify-between`）。收起时 `ChevronRight` 仅该行 hover 出现（`group/fold`，避免吃到 `MessageFrame` 的 `group`）；展开后换成 `ChevronDown`。过程区走 `.cs-process-scroll`（只设 `max-height`），思考 / 工具内容走 `max-height: 5lh` 的 `.cs-fold-scroll`。线程是 `flex-col-reverse` 贴底，展开会长高把灰字顶上去：toggle 前记下 `getBoundingClientRect().top`，`useLayoutEffect` 里给 `.cs-thread` 的 `scrollTop` 加上位移，把灰字钉回原处，看起来是向下展开。滚动盒由 `FadeScroll` 包一层 `isolation: isolate`，上下各一条 `mix-blend-mode` 渐变（深色 `multiply`、浅色 `lighten`，色用 `--ink`）；`scrollTop>2` 才显示顶遮罩，距底 `>2` 才显示底遮罩。没有过程（只有正文）不渲染这一行。
- Agent 回复底部 hover 才出现一行（`MessageFrame` 用 `group/msg`，避免和折叠箭头抢未命名 `group`）：左灰色「由 {name} 生成 / Generated by {name}」，右无边框 `Copy` + `GitFork` + `RefreshCw`（`justify-between`）。复制取 `lastTextIndex` 之后的 `type=text`（有过程折起时就是可见正文），先 `navigator.clipboard.writeText`，失败再临时 `textarea` + `execCommand("copy")`，不含 reasoning / tool-call。成功后 `copied`：该行强制 `opacity-100`（避免移开鼠标就看不见），icon 原地换 `Check` 并用 `--ok`，1.5s 后还原。`isRunning` 且该条是最后一条时不渲染这一行。用户气泡 `mt-6`，其余消息 `mt-3`。用户气泡不放操作钮。模型名在本轮第一条 assistant 落盘时写入 `modelId` / `modelName`
- 视觉：窄侧栏（约 380px）、深色橄榄黑 / 浅色中性浅灰层次、深色黄铜 / 浅色钢蓝强调；图标只用 `lucide-react`
- 按钮 hover 分两套，由 `RippleButton` 的 `variant` 决定：ghost（默认，描边 / 透明底）走 `--hover` 中性半透明覆盖；primary（强调色实心：权限条「接受计划」「继续」、删除确认的确认钮等）走 `hover:bg-[color-mix(in_oklab,var(--brass)_86%,var(--text))]` + `active:` 再深一档——深色下变亮、浅色下变深，像「可选中的活动状态」，不能被读成禁用态。**不要在 primary 按钮的 className 里再写 `hover:bg-[var(--brass)]` 这类同属性工具类**：两个 hover 工具类同属 utilities 层，谁生效由 Tailwind 的生成顺序定（实测中性灰赢），这正是旧版「hover 变灰像禁用」的根源。带 `--brass` 弱底的特殊 hover（取消 / 跳过这类文字钮）用 `styles.css` 里的 `.cs-hover-brass`——它不落 `@layer`，优先级高于所有工具类，能稳定生效。主按钮点击同样走 `useRipple`（`.cs-ripple` 用 `currentColor`，在实心底上可见）。
- 字体：IBM Plex Sans / Mono（中英都不用衬线体）。Google Fonts 只拉 400/500。`html`/`body` 默认 `font-weight: 400`；`b`/`strong`/标题/`th`、Markdown 标题与表头、以及 Tailwind `font-medium`/`semibold`/`bold` 一律 500（`@theme` 把更重的 weight token 压到 500），避免浏览器 `bolder` 或 preflight 跳出 600/700。
- 工具行左侧按 ACP `kind` 换 lucide 图标：read / edit / execute / search / fetch 等，颜色跟灰字走。`pending` / `in_progress` 时只渲 `LoaderCircle`，结束后才换回 kind 图标，二者不同时出现。标题始终用 `toolLiveHeadline`：短名（`toolLabel`）+ 全角 `：` + `primaryArg`。`tool_call` / 更新时 `withPrimaryArg` 把关键参数写进 `ToolPart.primaryArg` 并落盘；hydrate 时缺了再补算。二次进会话只读已存的 `primaryArg`，不因 args 形态变化丢掉拼接。`TextFold` 一行：外层 `w-full min-w-0`，内层簇 `max-w-full` 随文案变窄；文案 `min-w-0 truncate`（不要 `flex-1`），箭头 `shrink-0` 紧贴文案，只有标题被省略时才顶到行尾。展开后的入参 / 返回走 `ToolJsonView`：字符串以 `{`/`[` 包住才 `JSON.parse`，失败则原文；对象 / 数组直接拆。最外层单 key 只渲 value；其余层每项一段 `key：value`，复合 value 先写 `key：` 再以 `padding-left: 1em` 递进。`formatScalar` / 原文把 `\n{2,}` 压成 `\n`，只空白的段不渲。不再 `JSON.stringify` 进 `pre`。

## 品牌图标

- 源文件 `packages/extension/assets/icon.svg` 由 `scripts/generate_icon.py` 生成，勿手改：Cursor 官方 CUBE_2D 六边形路径做 clipPath 外轮廓；镂空为圆角等腰三角形（`TRI_VERTICES` + `CORNER_R`，经 `ARROW_SCALE`=√3/2 缩放、净逆时针 90° 旋转）；360 个 1° 扇形逼近 conic 渐变，红→黄→绿顺时针风车、交界 40° smoothstep 平滑过渡，整体 `GRADIENT_ROTATE_DEG`=30° 顺时针旋转。空会话占位图直接引用这份 SVG，不另做淡色线稿
- PNG 用 `rsvg-convert` 从 SVG 导出（16/32/48/128，保留透明），放 `packages/extension/public/icons/`，crxjs 构建时拷到 `dist/icons/`
- manifest 的 `icons` 与 `action.default_icon` 都指向这四张图

### README Banner

- 成片 `docs/banner.svg`，由 `scripts/generate_banner.py` 生成（勿手改）。画布 **1600×488**，README 里靠容器宽度缩放
- 图上不画分区标签（原 BROWSER / LOCAL AGENTS 已去掉）：少一行文字就能把画布从 520 收到 488，上下留白（56）与左右一致。除背景以外的内容整体包在 `<g transform="translate(0 CONTENT_DY)">` 里上移（`CONTENT_DY = -20`），改版式时只动这一个数，不用逐个改坐标
- 只有一份自包含矢量：不引外链图片、不嵌位图、不依赖字体文件。README 只给 `<img>`，外部引用在 `img` 上下文里根本不加载；位图在高 DPI 下糊。文字用 `IBM Plex Sans` → 系统无衬线兜底，不转路径（转路径要打包字体，收益只在字体缺省时的度量差异，且中文字重不可控）
- 中段图标不复制几何：`generate_banner.py` 直接 `import generate_icon`，复用同一套 `color_at` conic 算法、立方体 clipPath 与扇形半径，只把扇形步长从 1° 放到 2°（banner 里图标约 164px，1° 与 2° 肉眼无差，文件小一半）。侧栏面板顶栏那颗小图标走同一个 `icon_group()`，只把步长再放到 6°（20px 下多边形数量比像素还多没意义）
- 五家 Agent 的标记用**各品牌官方矢量**，上游文件整份存 `scripts/brand/`，`generate_banner.py` 生成时按 `fill` 认出要哪几条 `<path>` 再套自己的变换与填充色——不手工抄 path（抄 2400 字符必错），也不改上游形状。取法与来源：
  | 标记 | 上游文件 | 取哪条 path | 填色 |
  |---|---|---|---|
  | Claude Code | `claude-code.svg`（Claude Code 官方文档站 `docs.claude.com` 的 logo/light） | `fill="#D97757"` 那条（星标；同文件其余 path 是 "Claude Code" 字标，不用） | 保留官方橙 `#D97757` |
  | Codex | `codex.svg`（LobeHub icons 的 `codex-color.svg`，MIT 汇集；商标归 OpenAI） | 渐变填充那条 path（云形 + 终端提示符），丢掉白色圆角底板；渐变本身从上游 `<linearGradient>` 搬进 defs（只换 id 为 `codex-mark`） | 保留官方蓝紫渐变 |
  | GitHub Copilot | `github-copilot.svg`（GitHub 官方 Octicons `copilot-24`，MIT） | 全部（头部轮廓 + 两只眼） | 主题前景色 |
  | OpenCode | `opencode.svg`（opencode 仓库 `packages/ui/src/assets/favicon/favicon-v3.svg`） | 两条（外框 + 内方块），丢掉深色底板 `<rect>` | 外框前景色、内方块次要色 |
  | Cursor | `cursor.svg`（cursor.com 官方 favicon） | `fill="#edecec"` 那条立方体，丢掉圆角底板与描边层 | 主题前景色 |

- GitHub Copilot 保持**官方单色标**。GitHub 的 logo 包（`brand.github.com` 的 `GitHub_Logos.zip`）只给黑白两版，官方品牌站也写明 Copilot 主题色是「黑或白为主 + 少量绿 / 紫点缀」；唯一的官方彩色版只存在于它的 App 图标里（蓝色渐变瓦片 + 白护目镜，取自官方仓库 `github/CopilotForXcode` 的 AppIcon）。那种「瓦片 + 小护目镜」缩小到 banner 的 26px 后护目镜只剩几像素，辨识度反而不如单色标（试过一版，见 `2745a7e`，随后回退）——所以这里仍用单色标 + 主题前景色
- 各标记不按 viewBox 直接缩放，而是按**实测 bbox** 归一。bbox 是离线用 M/L/H/V/C/Z 解析器量的（Octicon 全是小写相对曲线，只做 min/max 会错位），数字作为常量留在脚本里，并用 OpenCode / Cursor 上游自带坐标交叉验证过——不在运行时猜
- 标记的变换必须把 **bbox 中心**对到卡片中线：`translate(cx,cy) scale(s) translate(-(bx+w/2),-(by+h/2))`。早先写成对齐 bbox 左上角，标记整体下沉半个身高、跟名字错位，右边距也被吃掉。尺寸：标记目标高 34、标记列宽 40、列距卡片左边 22、名字距列 16——四个名字靠固定列宽左对齐，不跟各自标记的实际宽度跑
- 右段是**一个**圆角容器（`PANEL_X 1192` / `PANEL_W 348` / `PANEL_H 376` / `rx 20`，与左侧浏览器窗口等高、上下边缘对齐），内部 5 行 Agent（行高 54，行间一条细线，**不画每行的圆角矩形**），末行再留 44 高给「三颗点 + `and more local agents`」提示——一行一卡片的写法既占地方，也说不清「支持的不止这些」。容器宽 348、右边缘离画布 60（与左边缘 56 呼应）：按最长名字实测宽度定，不留大片虚空。名字字号 24、`CLI` 后缀用 `<tspan dx>` + 次要色，**不另设 font-size**（继承品牌名的字号，改 `.chipname` 不会脱节）——改文案或字号后要在浏览器里量一次 `getBBox()` 复核，别让文字压到容器右边
- 标记尺寸：目标高 **26**（比早先的 34 小，一行 54 放得下）、标记列宽 34、列距容器左边 24、名字距列 14；五个名字靠固定列宽左对齐，不跟各自标记的实际宽度跑
- 商标：这四份素材的版权与商标归各品牌，仓库内保留只为说明可连接的 Agent，不表示背书；README 正文也不要写合作口径。素材整份入库（而非只存抽出的 path）是为了来源可核对——想验证可以直接 diff 上游 URL
- README 用法：`<div align="center">` 里放 `<img alt="OpenSider" src="./docs/banner.svg">`，**不写 width/height**（靠正文栏宽度缩放，SVG 自带 1600×488 保证比例），slogan 作为图下方居中的 `<p>`，再下一行是居中的徽标行（release 版本 + license，两个 `<a><img></a>` 并排在同一个 `<p>` 里，天然一行；shields.io 图片必须在仓库自己的 README 里，不要引到侧栏或文档其它位置）；原来那颗 96px 的 `docs/logo.svg` 与 `<h1>` 一并撤掉。中文版与英文版共用这一张图——图里只有产品名、五家英文名与末行那句英文提示，没有中文字，也没有分区标签，所以不需要出两张
- 双主题在 SVG 内部用 CSS 变量 + `@media (prefers-color-scheme: dark)` 切换。GitHub 不会把页面主题告诉 `<img>`，也没有 `#gh-dark-mode-only` 这种片段可用，只能跟系统；两套调色板都按可读对比度给，不依赖背景色
- 连接关系用视觉表达：左右各一条基线与一条 `.flow` 覆盖线，靠 `stroke-dasharray` + `stroke-linecap: round` 得到流动光点，动画只改 `stroke-dashoffset`；`prefers-reduced-motion: reduce` 下关掉动画，静态圆点仍在，**语义不依赖动画**

## 仓库结构

```
AGENTS.md           仓库根开发协作约定。不是 ~/.opensider/workspace/AGENTS.md（Host 写入的页面协议）
README.md           面向使用者的产品页（英文，仓库默认）：英文 slogan + 扩展介绍（CLI 顺序 Claude Code / Codex / OpenCode / Cursor）+ 7 条要点（与中文版同一组、同序）、演示、一步安装提示词（不写开发搭建，不单独开适用场景）
README_ZH.md        README 的中文版；顶部与英文版各放一行居中 `中文 | English` 切换，只非当前语言那侧带链接
docs/REQUIREMENTS.md  需求：做什么、为什么
docs/TECH_DESIGN.md   本文件：怎么做、为什么选这个方案
docs/DEVELOPMENT.md   开发构建、Host 注册、工作区、打 extension.zip、tag 发 Release
docs/logo.svg         品牌图标单图（512，源自 generate_icon；README 顶部已改用 banner，此文件保留备用）
docs/banner.svg       README banner 概念图（由 scripts/generate_banner.py 生成）
docs/opensider.mp4    README 演示视频：Agent 提炼网页信息、生成资讯榜单并在浏览器打开
cmd/opensider       唯一 Go 入口（host / install / pick）
internal/           Host / install / pick / ACP
packages/shared     扩展 ↔ Host 消息类型（TS）
packages/extension  Chrome MV3（background / content / sidepanel）
skills/opensider     skill：安装 / 更新 / 卸载 / 体检（提示词指向它，agent 用 GitHub CDN 并发拉）
scripts/brand/      五家 Agent 的官方矢量素材原文件（只给 banner 生成脚本读，见「README Banner」）
scripts/pack-extension.mjs  把 dist 打成 extension.zip（用构建产物 manifest 的 key 校验未打包 ID）
.github/workflows   tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。README 只写使用者安装/使用，不含开发搭建；开发者看 `docs/DEVELOPMENT.md`（含 `pnpm install-host`、加载 `packages/extension/dist`）。

## 演示录制

产品侧栏 = Chrome **Side Panel**（manifest `side_panel` + `sidePanel` 权限 + `openPanelOnActionClick`），不是 `default_popup`。README「演示」只写视频在演示什么：OpenSider 会话里让 Agent 提炼网页信息、生成资讯榜单并在浏览器打开。不要把分辨率、加速、IME 等录制规格写进 README。

## 发布与 skill 安装

用户侧不克隆仓库，也没有任何本地构建入口：安装 / 更新 / 卸载由「**一段提示词 + 仓库里的 skill**」完成——用户把提示词发给自己在用的本机 AI Agent（Claude Code / Copilot CLI / Cursor / Codex 等），Agent 按 skill 分步执行、每步验证、失败给可执行的修复动作。仓库仍发预编译二进制（用户侧不装 Go），但 Release 不再包含 `install.sh` / `install.ps1`。

### 提示词与 skill

提示词只有一句话 + 一个 URL，README「安装使用」与侧栏「桥接未注册」给的是同一段（中英各一，走 i18n）：

> 帮我安装 OpenSider 浏览器扩展。
> 请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，然后严格按其中的流程执行。
> 开始前先跟我确认我平时用哪个浏览器；每一步都分步引导我操作，并自己验证结果。

`skills/opensider/` 是多文件 skill：`SKILL.md`（入口：能力清单、决策树、阶段顺序、验证门）+ `install.md` / `update.md` / `uninstall.md` / `doctor.md` + `references/`（`platforms.md` 平台与浏览器路径矩阵、`download.md` 下载链路选择与并发下载、`agents.md` CLI 名单与 ACP 适配器、`verification.md` 验证判据、`support.md` 收尾引导 Star、`troubleshooting.md` 故障排查）。agent 不要求用户装 Git、克隆仓库或再装 aria2 / gh：本机 `curl`（Windows 用 `curl.exe`，不要用 PowerShell 的 `curl` 别名）就够。`SKILL.md` 先解析最新 tag，再用**该 tag** 的 raw 地址**并行**拉其余 skill 文件，release 资产走同一套并发规则，保证 skill 与二进制同版本。某个 skill 文件在该 tag 上 404（刚加的 reference 还没打进最新 release）则只把这一份改从 `main` 拉，其余仍钉在 tag 上。**解析必须走 API**（`https://api.github.com/repos/parksben/opensider/releases/latest` 的 `tag_name`）：web 的 `/releases/latest` 重定向有 CDN 缓存，刚发的版本可能几分钟内还指向旧 tag（v0.2.1 重发时就踩到过，`latest` 仍解析成 v0.2.0）；web 重定向只作兜底。

**下载链路怎么选（2026-09-16 改）**：先判定一次网络环境，再决定这一轮走 `direct` 还是 `mirror`，判定结果与用到的链路要报给用户。判据是两份证据：地区提示（`gstatic.com/generate_204` 能不能通、延迟对比 `baidu.com`：能快速通 → 墙外或已有可用代理；国内极快而 gstatic 不通 → 国内；两者都快或都慢 → 判不出来）与**决定性实测**（对 release 资产量首字节 `%{time_starttransfer}`、以及 512KB Range 分片的实测速度——用 `size_download / time_total` 自己算，别拿 `-w` 的浮点格式直接比大小），只看实测：直连拿到 200 且首字节 / 速度达标就直连，否则走镜像。判定一次整轮沿用，不许每个文件重测；某条链路连挂两个文件才换一次，换完再测一次，不来回摇摆。

直连链路用的仍是 GitHub 自己的并发：release 资产的 `https://github.com/…/releases/download/<tag>/<file>` 会 302 到 `release-assets.githubusercontent.com`（旧资产也可能是 `objects.githubusercontent.com`），这份 CDN **官方支持** `Accept-Ranges: bytes`，Range GET 回 `206 Partial Content`，所以对大约 10MB 的桥接二进制先 `-I` 解析出带签名的 CDN URL，再对**同一个** CDN URL 切 4 路 `bytes=start-end`、按序号拼接；`raw.githubusercontent.com` 上的 skill 文件很小且对 HEAD 不友好，只做多文件并行 GET、不做 Range。独立文件并行与单文件 Range 都把 PID 记下来再 `wait`，不要用脚本里经常是空的 `jobs -p`。单路失败或拼出来的字节数对不上就退回一次普通 `curl -fsSL`。

国内链路用**代理前缀**提速（2026-09-16 本机实测过可用性）：`https://gh-proxy.com/<原始 GitHub URL>` 打头，`https://ghproxy.net/<原始 GitHub URL>` 兜底，两者都能同时代理 `github.com/…/releases/download/…` 与 `raw.githubusercontent.com/…`；钉 tag 的 raw 文件另有 jsDelivr（`https://gcore.jsdelivr.net/gh/parksben/opensider@<tag>/…`，只对不可变的 tag 用，`main` 的兜底文件不要走它）。实测确认的三件事写进了 skill，免得 Agent 乱猜：gh-proxy 支持单文件 Range（`content-range: bytes 0-99/9815202`）；**ghproxy.net 不支持切片**（1MiB Range 只到 322932B 就断），所以走镜像时只做「多文件并行」、不做「单文件切片」；gh-proxy 前面是 Cloudflare 缓存（响应带 `cf-cache-status` / `age`），这既是提速来源也是**旧产物来源**。

**防旧缓存**：路径永远钉 tag（tag 路径不可变，镜像缓存无害），真正会变、会被缓存坑到的只有两处 —— `releases/latest` 与 `main` 上的文件。手法是 `?t=<unix 秒>` 加在**镜像 / 代理 URL** 末尾（实测 `t=111` → `MISS`、同参数再请求 → `HIT`、换 `t=222` → 又 `MISS`，说明查询串在 Cloudflare 的缓存键里；直连时不动签名链路，改用 `-H 'Cache-Control: no-cache'`，同样实测能从 `HIT` 打成 `MISS`）。校验闭环用「跨链路」做：`SHA256SUMS` 的链路要与二进制**不同**（直连拿不到就换另一个镜像），否则同一个镜像既缓存了旧二进制又缓存了旧 SUMS，两边自洽、看不出错；校验不过时先换链路 + 破缓存重取一次，仍不匹配才停下报错。所以这里**允许**用第三方代理（与 2026-09 之前「不引入 unofficial 代理」的取舍相反），代价由三条护栏兜住：只用 curl 前缀（不装 aria2 / gh）、镜像只当加速通道（顺序尝试 + 全失败退直连）、一律 sha256 校验后再落盘。npm 依赖（ACP 适配器）同理：国内时给 `opensider install` 加 `npm_config_registry=https://registry.npmmirror.com`，`ensureACPAdapter` 里 `cmd.Env = os.Environ()` 会把环境变量透传给子进程 npm。Windows 同一套 `curl.exe`；BITS `Start-BitsTransfer` 是可选的本机多连接后备（同样走 HTTP Range）。连接数默认 4、上限 8，避免被当成滥用。

安装阶段（每一步都要有验证判据，失败就停在那里引导修）：

1. **探测**：OS / arch（`uname -s`、`uname -m`；Windows 先看 `PROCESSOR_ARCHITEW6432`（32 位 PowerShell 跑在 64 位系统上时 `PROCESSOR_ARCHITECTURE` 会是 `x86`）再看 `PROCESSOR_ARCHITECTURE`，`ARM64` 取 `opensider-windows-arm64.exe`）、已装 Chromium 浏览器（按 `platforms.md` 的路径矩阵判断）、已装 Agent CLI（`command -v` + 常见 bin 目录）、Node 18+（只有 Claude / Codex 的适配器需要）。
2. **先问浏览器**：把检测到的浏览器列给用户挑一个（一个都没检测到就引导先装）。Native Messaging 清单仍写进**所有**检测到的浏览器与各 Profile，但加载扩展只引导用户选定的那一个。
3. **装桥接**：按 `references/download.md` 从钉住的 tag 并发下载 `opensider-<os>-<arch>[.exe]` 与 `SHA256SUMS`（SUMS 与二进制并行；二进制走 CDN Range），用本机 `sha256sum` / `shasum -a 256` / `Get-FileHash` 核验（对不上或 SUMS 里没有这一行就停），放到 `~/.opensider/runtime/` 并 `chmod 755`；macOS 再清 quarantine（`xattr -d com.apple.quarantine`）、Windows 走 `Unblock-File` 去 MOTW，避免 Gatekeeper / SmartScreen 拦住。随后跑 `~/.opensider/runtime/opensider install`：Go 侧负责 `Register()`（所有浏览器的 `NativeMessagingHosts/` 及各 Profile 目录，Windows 另写 HKCU 注册表）、`workspace.Ensure()`（`AGENTS.md` / `browser/tools.json` / `outputs/`）与 ACP 适配器。
4. **装扩展**：先把「扩展目录放哪儿」问清楚并**等用户回答**（建议 `~/OpenSider`；`~/Downloads/OpenSider` 要顺带说明清理下载的后果；其它绝对路径都接受，但拒绝放进 `~/.opensider`），用户未回答前不建目录、不下载、不落盘；随后用 `opensider extension-dir <路径>` 记到 `~/.opensider/extension-path` —— 更新 / 体检 / 卸载都从这条记录读，不另外猜。然后下载 `extension.zip` 解压到该目录（zip 放同级，用户可自行重装），确认 `manifest.json` 在位，用命令打开用户选定浏览器的 `chrome://extensions`（macOS `open -a "<浏览器>" "chrome://extensions"`；Linux / Windows 用对应浏览器可执行文件带该 URL），再**分步引导**用户：打开开发者模式 → 点「加载已解压的扩展程序」→ 选中该目录 →（可选）固定到工具栏。这一步必须由用户亲手点，skill 不得假装自动完成。
5. **验证**：让用户点工具栏图标打开侧栏，检查 `~/.opensider/host.log` 出现新的 Host 启动行；侧栏能列出本机 Agent 即成功。分不清「本机没装 CLI」「桥接没注册」「扩展没加载」时不许下结论，按 `troubleshooting.md` 分流。

`update` 走同一套：对比已装版本（扩展 `manifest.json` 的 `version`、`opensider version`）与最新 release，覆盖二进制与扩展目录，引导用户在扩展页点「重新加载」，再验证。`uninstall` 移除所有清单（含历史 `com.cursor.sidebar.host.json`）与 Windows 注册表项、删 `~/.opensider/runtime`，并在**明确询问用户**后决定是否清空 `~/.opensider`（工作区、会话、产物、日志、界面状态，后果要写清楚）；扩展本体由用户按引导在扩展页移除。卸载前后都要注意**运行中的桥接进程**：Chrome 只要侧栏还连着就会一直持有它，而它收到页面 / 标签更新会重建 `workspace/browser`，于是 purge 过的 `~/.opensider` 又冒出来。因此 `uninstall` 用 `pgrep -f`（Windows 用 `tasklist`）查一下还有没有活的桥接进程，有就打印 pid 与「先关侧栏再跑一次」（`internal/install/running.go`），skill 也要求用户先关侧栏、并在清理后复查目录是否真的消失。`doctor` 只读检查 + 修常见问题：二进制缺失 / 不可执行、quarantine / MOTW、清单没覆盖某些浏览器、Node 与 ACP 适配器缺失、workspace 不完整、host.log 长期没有启动行（Node Host 时代残留的 `PickFiles.app` / `runtime/packages` 也在识别范围内，处理方式是先备份再重建）。

skill 不提供「纯手动安装」的脚本或分步手册：产品只面向本机已经有 Agent CLI 的用户，另维护一份与 skill 平行的手动文档必然和 skill 漂移。

ACP 适配器仍只在 Go 里实现：`install` 里一个 `acpAdapterSpec`（本机 CLI 名 + 适配器包名 + 适配器可执行名 + `~/.opensider/runtime/<id>-acp` 安装目录）交给通用的 `ensureACPAdapter`；探测侧只要把该 prefix 的 `node_modules/.bin` 算进 `AgentSearchDirs`（`paths.ClaudeACPBinDir` / `paths.CodexACPBinDir`），装完就能被列名。没有 Node 18+ 只提示，失败不挡 Host 注册。再加同类 CLI 只需添一份 spec。

### 版本检查与更新提示

半自动：扩展侧只负责「知道有新版本 + 给出一段更新提示词」，不做后台静默自我更新（Chrome 对 unpacked 扩展的热替换不稳，静默改写本机文件也不可解释）。

- Host 在 `hello` 里带自身版本（构建时 `-ldflags` 注入 tag）；扩展版本取 `chrome.runtime.getManifest().version`。
- **版本号口径**：`v` 只属于 git tag / release 标识；跟人见面的地方一律是 `0.2.2` 这种纯点号形式——`opensider version`、`install` 的 `Version:` 行、`hello` 的 `version`、侧栏那三行，都走 `version.Display()`（Go）/ `displayVersion()`（扩展侧，`App.tsx` 算 `versionInfo` 时对 bridge 与 latest 各剥一次）。原因很实：扩展的 manifest version 只能是 `0.2.2`，同一屏幕里混播 `v0.2.1` 与 `0.2.2` 看着像两个东西。例外只有两个：release tag 本身（`v0.2.2`，API 里叫 `tag_name`），以及 `host.log` 里那行 `release latest=`（原样记 GitHub 给的 tag，便于对账）。
- 设置 tab 展示「扩展版本 / 桥接版本 / 最新版本」+「检查更新」+「一键卸载」，两个按钮文案居中。最新版本由 Host 查 `https://api.github.com/repos/parksben/opensider/releases/latest`（未认证 60 次/时/IP，够用），结果缓存到 `~/.opensider/release-check.json`，**TTL 1h**（再长了会出现「刚发完新版，侧栏一天内还说最新是旧的」）；失败静默降级——不提示、不打扰、不阻塞任何功能。「检查更新」发 `release.check`，Host 强制重查并推 `release`。扩展侧把这轮手点的检查建模成 `ReleaseCheckState`（`idle` / `checking` / `current` / `failed`，见 `version.ts`）：点击后进入 `checking` 并起一个 8s 看门（离线时不会永远卡住）；收到 `release` 时若 `release.check` 是用户手点的（`checkPendingRef`），比一下版本——有新版本直接把 `UpdateDialog` 弹出来（不用用户再去找顶栏图标），没有则 `current`，看门狗超时则 `failed`，两者都亮 1.5s 后回 `idle`。开机时 Host 自己推的那次检查不弹窗、不闪提示（`checkPendingRef` 为假）。
- 模态窗只有一套壳：`PromptDialog`（`createPortal` 到 body，`fixed inset-0` + 遮罩模糊，Esc / 点遮罩 / × 关闭；标题栏带一条 `border-b` 分隔线，与抽屉 tab 栏同源），`UpdateDialog`（顶部三个版本行，行样式与设置 tab 的版本行逐字一致）与 `UninstallDialog`（无附加行）都只是往里填词。观感全部复用存量件：提示词块沿用 `BridgeSetup` 的「面板里再放一块等宽文本」，复制按钮沿用设置 tab 那套描边按钮（`rounded-md border border-[var(--line)]` + `RippleButton` 的涟漪），复制中/完成后换成 `Check` +「已复制」，与消息气泡、`BridgeSetup` 的反馈一致。按钮文案就叫「复制提示词」（中英一致，两个弹窗共用）。**别给 `RippleButton` 加 `bg-[var(--brass)]` 之类的填充背景**：它内置的 `hover:bg-[var(--hover)]` 是带伪类的选择器，优先级高于无变体的背景类，hover 时会把填充色抽掉，只剩 `--on-brass` 的字色（浅色主题下就是白底白字）——要实心按钮得像 `ConfirmPopover` 那样自己把 hover 背景写回。两个入口都不在本机做动作：提示词与安装同源（措辞分别为「更新 OpenSider」/「卸载 OpenSider」），由用户的 Agent 按 `update.md` / `uninstall.md` 执行。顶栏那个 `CircleArrowUp` 更新图标只在真有新版本时渲染（不占位、不置灰）。顶栏图标按钮统一用 `IconButton`：它的 tooltip、涟漪与 `hover:bg-[var(--hover)]` 是同一个开关，`ripple={false}` 会把点击反馈和 hover 底色一起关掉——除非有意为之，否则不要传。
- 三段提示词（安装 / 更新 / 卸载）都定义在 `packages/extension/src/sidepanel/platform.ts`（`hostInstallPrompt` / `hostUpdatePrompt` / `hostUninstallPrompt`），侧栏按钮与 README 中英正文用同一份文本；改措辞时两处一起改，不要在 markdown 里另写一份。三段一律**两行**：意图 + skill 入口 URL + 「按其安装 / 更新 / 卸载流程执行」；所有约束都在 skill 里，提示词不复述（两处都写会互相干扰，也容易漏改）。

### 开发脚本

根 `package.json`：`install-host`（**只给开发**）→ `go build -o ~/.opensider/runtime/opensider ./cmd/opensider`，再把 `packages/extension/dist` 拷到 `paths.ExtensionDir()`（默认家目录下的 `OpenSider`，与用户侧同一个位置），最后跑该二进制 `install`；`pack-extension` → `node scripts/pack-extension.mjs`（把 `packages/extension/dist` 打成 `dist-release/extension.zip`，用构建产物 manifest 的 key 校验未打包 ID，**不写出** `opensider.crx`）；`build` = 编扩展 + 打包，不再碰本机 Host。**用户侧没有任何本地构建入口**：`install --local` 与 `scripts/install/*` 已删除，安装 / 更新 / 卸载统一由「提示词 + skill」驱动。`dev` 仍只起 Vite。打包脚本只用 Node 内置 `crypto` / `zlib`。`dist-release/` 不入库。

### tag 发 Release

`.github/workflows/release.yml` 在推送 `v*` tag 时跑，`contents: write` 以便 `gh release create`。

| Job | Runner | 做什么 |
|---|---|---|
| `build-darwin` | `macos-latest` | Go 1.22+，`CGO_ENABLED=1`，产出 `opensider-darwin-arm64`；在同一台机器上再试 `GOARCH=amd64`（`CC=clang`），编得出来才上传 |
| `build-cross` | `ubuntu-latest` | `CGO_ENABLED=0`，`GOOS=linux/windows` × `GOARCH=amd64/arm64`（Windows 带 `.exe`） |
| `release` | `ubuntu-latest`（等前两个） | `pnpm install` + `pnpm --filter @opensider/extension build` **一次**，再跑 `pnpm pack-extension` 产出 `extension.zip`（不发 CRX）；下载二进制工件；写 `SHA256SUMS`；`scripts/release-notes.sh` 打最近 3 个 commit；`gh release create` |

扩展只在 `release` job 编一次，darwin / cross 不再装 Node。darwin 开 cgo 是为了本机 `pick`（AppKit）；linux / windows 交叉编译关 cgo，避免依赖目标系统的 C 工具链。macos-latest 现在是 Apple Silicon，darwin/amd64 属于尽力：SDK 够就编，不够就跳过，不挡发版。

Release 资产名（skill 与文档都按这些名字取）：

- `opensider-darwin-arm64` / `opensider-darwin-amd64`（后者可选）
- `opensider-linux-amd64` / `opensider-linux-arm64`
- `opensider-windows-amd64.exe` / `opensider-windows-arm64.exe`（后者可选，流水线仍编）
- `extension.zip`
- `SHA256SUMS`

`scripts/release-notes.sh` 对当前 tag/HEAD 打印 `git log --pretty=format:'- %h %s' -n 3`。Release body 只有最近 3 个 commit，不加产品介绍、不回溯整个 tag 区间。`.github/workflows/release.yml` 的 notes 步骤只跑这个脚本。

## 风险

| 风险 | 处理 |
|---|---|
| Native Messaging 环境 PATH 很瘦 | Host 自己扫 nvm / npm-global / bun / `~/.opencode/bin` 等 bin；子进程 PATH 带上 CLI 所在目录。Cursor 仍默认同 `~/.local/bin/agent` |
| macOS 切 Agent 弹 Gatekeeper（`.xxxx.node`） | Chrome Native Host 拉起的子进程每次把 Bun/npm addon 解到新的 `$TMPDIR` 路径，Gatekeeper 就当成新文件连弹。Host 把 `TMPDIR`/`TMP`/`BUN_TMPDIR` 钉到 `~/.opensider/runtime/natives/<agent>/`，启动后轮询该目录和 CLI 旁的 `node_modules`，对 ≤8MB 的 `.node`/`.dylib` 清 quarantine 并 `codesign --sign -`。不改 CLI 本体。**OpenCode** 官方二进制仍是 adhoc/linker-signed，官方重装不能公证，但稳定路径 + 预签名后不应再连弹。**Gemini** / **Claude ACP** npm addon、**Copilot** npm 版同样走这套；官方 cask `copilot-cli` 已公证。若仍弹一次：点「完成」，不要「移到废纸篓」 |
| 探测卡住 starting | 探测后台化 + 总时限；ProbeACP 不继承 Host stdio、杀进程组；SW 10s 看门狗 |
| 换 Agent 卡在鉴权 / 握手 | 进度条右侧取消；Host 先握手新进程再停旧进程，取消回上一份 ready 或 idle |
| 旧 `~/.opensider` 混着 Node Host 残留 | skill 的 doctor 识别后先备份、再重建 runtime / workspace；开发机 `pnpm install-host` |
| macOS 拦 Chrome 执行 Desktop 上的 Host | 二进制固定放 `~/.opensider/runtime/opensider`（skill 下载后即放这里，并在 macOS 清掉 quarantine） |
| 下载的二进制被 macOS quarantine / Windows MOTW 拦住 | skill 用 curl / 系统下载器拿文件，随后在 macOS `xattr -d com.apple.quarantine`、Windows `Unblock-File`；doctor 也检查这两项 |
| GitHub 单连接下载慢或 Range 失败 | skill 走官方 CDN 并发（多文件并行 GET + 大文件 4 路 Range）；`raw.githubusercontent.com` 不做 HEAD；失败退回一次单路 `curl -fsSL`；不依赖镜像 / aria2 |
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
