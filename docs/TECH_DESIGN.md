# Cursor Sidebar — 技术设计

> Chrome 扩展通过 Native Messaging 托管 `agent acp`；页面感知用内容脚本 + 工作区文件，不使用 MCP，不运行常驻本地服务。

## 总览

```
Chrome Side Panel (assistant-ui)
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

Content Script  ←── 当前标签的页面方法
```

浏览器扩展不能 spawn 本机进程。Cursor CLI 的自定义客户端协议是 ACP（`agent acp`，stdio JSON-RPC）。二者之间只加一层 **Chrome Native Messaging Host**：Chrome 在扩展连接时启动它，断开后退出。用户不必先开一个 Node 服务。

## 为什么不用 MCP

ACP 的 `session/new` 可以带 `mcpServers`，这是给 Agent 加工具的官方方式。但本项目的页面能力很窄，而且用户明确希望少加一层协议。

Cursor Agent 在 ACP 模式下仍然自己执行本地工具（读文件、写文件、Shell 等）。Client 的 `fs` / `terminal` capability 只是让 IDE 代管文件，不是 Agent 用工具的前提。因此：

- 本地工具：什么都不加，`mcpServers: []`，模式用 `agent`。
- 页面工具：内容脚本提供方法；Host 把「当前页」写成工作区文件；Agent 用已有 Read/Write 读写这些文件。工作区里的 `AGENTS.md` 告诉 Agent 协议。

这不是通用工具总线，但够用，也避免再跑一个 MCP 进程。

备选（未采用）：在 Host 进程内嵌 stdio MCP。能力更「正式」，但多一套握手，和「尽量不增加东西」冲突。

## 进程职责

### Side Panel

- assistant-ui + `useExternalStoreRuntime`
- 自己持有消息列表，把 ACP `session/update` 映射成 assistant-ui 的 text / reasoning / tool-call
- 发出用户输入、取消、权限决定、提问/计划回答
- 展示当前页、连接状态、todo、权限条

### Service Worker

- `chrome.runtime.connectNative` 连接 Host
- 在 Side Panel、Content Script、Host 之间转发消息
- 监听 `tabs.onActivated` / `tabs.onUpdated`，通知内容脚本刷新当前页
- 点击工具栏图标打开 Side Panel

### Content Script

运行在隔离世界，不往 `window` 挂 API。方法：

| 方法 | 作用 |
|---|---|
| `getMeta` | url、title、description、canonical |
| `getReadable` | 正文纯文本（简单可读性抽取，截断） |
| `getSelection` | 当前选区 |
| `getLinks` | 同源链接（text + href，截断条数） |
| `getOutline` | h1–h3 文本 |
| `queryText` | `document.querySelector` 的 textContent |

### Native Host

- 解析 Chrome Native Messaging 长度前缀帧（**禁止往 stdout 打日志**）
- spawn `~/.local/bin/agent acp`（PATH 不足时用绝对路径）
- 作为 ACP Client：`initialize` → `authenticate(cursor_login)` → `session/load` 或 `session/new`
- 把 Side Panel 的 prompt/cancel/permission 转成 ACP
- 把 Agent 的 `session/update`、权限请求、Cursor 扩展方法推给扩展
- 把页面快照写入工作区；监视 `browser/commands/`，转给当前标签的内容脚本，再把结果写回 `browser/results/`

Host 用 Node 24 直接跑 TypeScript（类型擦除）。stdout 只给 Chrome，ACP 走子进程管道，日志走 stderr 或 `~/.cursor-sidebar/host.log`。

## 工作区布局

```
~/.cursor-sidebar/
  workspace/                 # ACP session cwd
    AGENTS.md                # 页面协议说明，Agent 会读
    browser/
      current.json           # 当前标签：tabId, url, title, updatedAt
      snapshot.md            # 最近一次可读正文
      commands/<id>.json     # Agent 写入的页面命令
      results/<id>.json      # 扩展写回的结果
  session.json               # { sessionId }
  host.log
```

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
  "method": "getReadable",
  "args": {}
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

命令超时 8s，结果带 `ok: false` 和错误信息。单文件和 Native Messaging 都遵守约 200KB 截断，避免 1MB 帧上限。

## 标签切换

1. SW 收到 `onActivated` / 完整 URL `onUpdated`
2. 向该 tab 的内容脚本要 `getMeta` + `getReadable`
3. 发给 Host：`page.update`
4. Host 写 `browser/current.json` 和 `browser/snapshot.md`
5. Side Panel 更新顶栏
6. 下一条 `session/prompt` 在用户文本前加一行 `[Current tab] {title} — {url}`（UI 不显示这行）

不在切换时往会话里塞一条用户消息，以免污染对话。Agent 需要更多页面内容时，按 `AGENTS.md` 读 snapshot 或写命令文件。

## ACP 映射

Host 是 ACP Client，`clientCapabilities` 关闭 `fs` / `terminal`，让 Agent 自己在工作区里用本地工具。

| ACP | 侧栏 |
|---|---|
| `agent_message_chunk` | assistant 文本 part，流式追加 |
| `agent_thought_chunk` | reasoning part |
| `tool_call` / `tool_call_update` | tool-call part（title、kind、status、input、output、diff） |
| `session/request_permission` | 权限条 |
| `cursor/ask_question` | 选择题 |
| `cursor/create_plan` | 计划审批 |
| `cursor/update_todos` | 顶栏 todo |
| `cursor/task` | 子任务卡片 |
| `session/prompt` 结束 | 本轮 `isRunning=false` |

消息状态由 Side Panel 持有。Host 重启后若 `session/load` 可用，会重放历史；Panel 以重放结果为准。

## 扩展身份

未打包扩展的 ID 必须稳定，Native Messaging 的 `allowed_origins` 才能写死。`manifest.json` 带固定 `key`，ID 为 `gcblddgaifebccglndkaccmibhechimj`。

Host 注册名：`com.cursor.sidebar.host`  
macOS 清单路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cursor.sidebar.host.json`

## UI

- 运行时：`@assistant-ui/react` 的 `useExternalStoreRuntime`
- 视觉：窄侧栏（约 380px）、橄榄黑底、黄铜强调色；图标只用 `lucide-react`
- 字体：Fraunces（词标）+ IBM Plex Sans / Mono（正文和工具输出）
- 工具卡片按 ACP `kind` 换图标：read / edit / execute / search / fetch 等

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
| 未登录 | 侧栏提示先跑 `agent login` |
| `session/load` 不支持或失败 | 新建会话，工作区文件仍在 |
| 内容脚本无法注入 | `current.json` 只写 url/title，命令返回明确错误 |
| Chrome 杀 Service Worker | 重连 Native Host；ACP 子进程随 Host 退出，重连后 load/new |
| 命令文件误触发 | 只认 `browser/commands/*.json` 且含 `id`+`method` |
