# Cursor Sidebar

Chrome 侧栏插件：用侧栏自己的聊天面板连接本机 Cursor CLI Agent（`agent acp`）。同一个工作区，多条聊天会话；可新建 / 切换 / 重命名 / 删除，也可从某一轮 Agent 回复 fork 或重新生成。输入栏可挂本机文件/文件夹路径（不上传内容），也可在当前页拾取元素（带上全局 CSS selector），并可选择当前账号在 Cursor 里能用的模型。界面中英切换，默认英文，语言、模型和会话历史会记在本机。Agent 能读取当前页、点击填表导航，也能截视口或单个元素做视觉分析。离线时顶栏会说明原因并可以重连。

不另起本地 HTTP 服务，不上 MCP。Chrome 通过 Native Messaging 按需拉起 Host，Host 再拉起 Agent。

## 前提

- macOS + Chrome
- Node 22+
- 已安装并登录 Cursor CLI（`agent` 在 `~/.local/bin/agent` 或 PATH 里）

```bash
agent login
```

## 安装

```bash
pnpm install
pnpm build
pnpm install-host
```

1. Chrome 打开 `chrome://extensions`
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」，选 `packages/extension/dist`
4. 点工具栏图标打开侧栏

`pnpm build` 会同时跑 `pnpm install-host`。安装脚本把 Host 源码拷到 `~/.cursor-sidebar/runtime/`（离开 Desktop，否则 macOS 会拦 Chrome 启动它），并用 `swiftc` 编一个 `PickFiles.app` 供加号唤起访达。Native Messaging 清单写到 Chrome / Chrome Beta / Chrome Canary / Chromium 的 `NativeMessagingHosts`，主路径是：

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.cursor.sidebar.host.json`

启动脚本里的 `node` 是绝对路径（Chrome 拉起 Host 时没有 nvm 的 PATH）。改完 Host 源码后要再 `pnpm install-host` 或 `pnpm build`，Chrome 才会用到新副本。

扩展 ID 固定为 `gcblddgaifebccglndkaccmibhechimj`。

## 开发

```bash
pnpm dev
```

改扩展后在 `chrome://extensions` 里点刷新。Host 是 Node 直接跑 TypeScript，改完重连侧栏即可。

## 工作区

会话 cwd 固定为 `~/.cursor-sidebar/workspace`。页面快照、命令和截图都在 `workspace/browser/`。Host 启动时写入 `AGENTS.md` 与 `browser/tools.json`，Agent 一进会话就能看见全部页面方法。

## 仓库结构

```
docs/                 需求与技术设计
packages/shared       扩展 ↔ Host 消息类型
packages/host         Native Messaging Host + ACP Client
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
scripts/              安装 Host
```
