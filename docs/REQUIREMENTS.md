# Cursor Sidebar — 需求文档

> Chrome 侧栏插件：用 assistant-ui 与本机 Cursor Agent 进行同一会话的对话，并让 Agent 感知当前浏览器页面。

## 产品目标

用户在 Chrome 里打开侧栏，就能和本机 Cursor CLI Agent 聊天。Agent 继续使用本机全部工具（读文件、改文件、跑命令等）。侧栏实时展示工具调用过程，效果对齐在终端 / IDE 里和 Agent 聊天。

所有网页上的对话落在**同一个工作区、同一个会话**里，因此可以做跨页面的连续工作。切换标签时，Agent 能知道用户现在在哪个页面。

## 非目标（v1）

- 不另起用户需要手动启动的本地 HTTP / WebSocket 服务
- 不通过 MCP 暴露页面能力
- 不支持 Firefox / Safari
- 不做网页自动化（点击、填表、导航）
- 不把聊天同步到云端
- 不上架 Chrome Web Store（先以未打包扩展加载）

## 用户可见行为

### 安装与连接

1. 用户完成本机 Cursor CLI 登录（`agent login`）。
2. 用户安装 Native Messaging Host（由浏览器按需拉起，不是常驻服务），并以未打包方式加载本扩展。
3. 点击工具栏图标打开 Side Panel。未连接时，侧栏说明如何安装 Host 和登录 CLI。
4. 连接成功后，Host 拉起 `agent acp`，复用已有登录，进入 Agent 模式（完整本地工具）。

### 聊天

1. 侧栏是唯一的对话入口，UI 基于 assistant-ui。
2. 用户发送消息后，本机 Agent 流式回复。
3. Agent 调用本地工具时，侧栏实时展示：工具名、状态（pending / 进行中 / 成功 / 失败）、输入摘要、输出 / diff。
4. Agent 请求权限时，侧栏弹出允许一次 / 始终允许 / 拒绝，不自动静默放行写文件和执行命令。
5. Agent 下发的提问、计划审批、todo 更新，在侧栏可见并可回应。
6. 用户可中断当前一轮。

### 工作区与会话

1. 所有页面共用一个工作区：`~/.cursor-sidebar/workspace`。
2. 所有页面共用一个 ACP 会话。关闭侧栏或切换标签不新建会话。
3. 扩展或 Host 重启后，尽量恢复同一会话；无法恢复则新建并保留工作区文件。

### 页面感知

1. 用户切换 Chrome 标签或当前页 URL 变化时，扩展更新「当前页」状态。
2. 侧栏顶部显示当前页标题与 URL。
3. 每条用户消息在发给 Agent 时附带一行当前页上下文（标题 + URL），界面里只显示用户自己输入的文字。
4. 内容脚本向页面注入一套只读方法（元信息、正文、选区、链接、标题大纲、按选择器取文本）。Agent 通过工作区里的命令文件调用这些方法，不走 MCP。
5. 以下页面不注入、不抓取：`chrome://`、`chrome-extension://`、Chrome Web Store、以及用户标记为敏感的站点（v1 至少排除上述系统页）。

### 跨页工作

因为会话和工作区固定，用户可以在 A 页讨论、切到 B 页继续，让 Agent 结合两页信息和本机文件做更复杂的事。

## 决策记录

| 决策 | 选择 | 原因 |
|---|---|---|
| UI | assistant-ui | 纯聊天组件库，可接自定义 runtime，适合渲染 tool call |
| 浏览器 | 仅 Chrome | Side Panel + Native Messaging 最成熟 |
| 与 CLI 的连接 | Native Messaging Host 拉起 `agent acp` | 扩展无法 spawn 进程；Host 由 Chrome 按需启动，不是常驻服务 |
| 页面工具 | 内容脚本 + 工作区文件 RPC | 复用 Agent 已有 Read/Write，不必上 MCP、不必再开端口 |
| 工作区 | 全局单一目录 | 跨页连续工作 |
| 会话 | 全局单一会话 | 保留跨页上下文 |
| Agent 模式 | `agent`（完整本地工具） | 用户要求本地工具可用，且过程要在 UI 里看见 |
