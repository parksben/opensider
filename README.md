# OpenSider

Chrome 侧栏插件：用侧栏自己的聊天面板连接本机 Cursor CLI Agent（`agent acp`）。同一个工作区，多条聊天会话；可新建 / 切换 / 重命名 / 置顶 / 删除，历史在右侧抽屉里按今天 / 最近 7 天 / 更早分组。进行中再发送的消息会进入输入框上方的队列，上一轮结束后自动按序发出，队列项可编辑或删除。也可从某一轮 Agent 回复 fork 或重新生成，也可点已发送的用户气泡改完再重跑。Agent 回复里的 mermaid `flowchart` / `graph` 会画成流程图（其它图种仍显示代码块）；回复里的链接若与当前标签同域则在该页跳转，否则新开标签。进行中连续的思考和工具调用只留当前最后一步，开始出正文后这条标题也收掉；一轮结束后折成一行耗时说明，点开再平铺每一步。历史会话回看与当轮刚结束时同一套折叠，不回到直播中间态。思考与工具调用本身也是灰字折叠，点开后在限高滚动区查看。输入栏可挂本机文件/文件夹路径（不上传内容），也可粘贴截图进附件，也可在当前页拾取元素（带上全局 CSS selector），也可用 `@` 把历史标签页或曾经加过的附件以芯片插进正文（和文字混排；发出去时 Agent 能读懂对应的 URL / tabId / 路径）。并可选择当前账号在 Cursor 里能用的模型。界面中英切换，默认英文；顶栏可切浅色 / 深色 / 跟随设备。语言、主题、模型和会话历史会记在本机。Agent 能读取当前页、点击填表导航，也能截视口或单个元素做视觉分析。离线时顶栏会说明原因并可以重连。

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

`pnpm build` 会同时跑 `pnpm install-host`。安装脚本把 Host 源码拷到 `~/.opensider/runtime/`（离开 Desktop，否则 macOS 会拦 Chrome 启动它），并用 `swiftc` 编一个 `PickFiles.app` 供加号唤起访达。Native Messaging 清单写到 Chrome / Chrome Beta / Chrome Canary / Chromium 的 `NativeMessagingHosts`，主路径是：

`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.opensider.host.json`

启动脚本里的 `node` 是绝对路径（Chrome 拉起 Host 时没有 nvm 的 PATH）。改完 Host 源码后要再 `pnpm install-host` 或 `pnpm build`，Chrome 才会用到新副本。

扩展 ID 固定为 `gcblddgaifebccglndkaccmibhechimj`。

## 开发

```bash
pnpm dev
```

改扩展后在 `chrome://extensions` 里点刷新。Host 是 Node 直接跑 TypeScript，改完重连侧栏即可。

## 工作区

会话 cwd 固定为 `~/.opensider/workspace`。页面快照、命令和截图都在 `workspace/browser/`。Host 启动时写入 `AGENTS.md` 与 `browser/tools.json`，Agent 一进会话就能看见全部页面方法。当前页的可点/可填控件写在 `browser/interactive.md`，填表应先读这份编号列表（或一次 `fillForm`），不要猜 CSS。

## 仓库结构

```
docs/                 需求与技术设计
packages/shared       扩展 ↔ Host 消息类型
packages/host         Native Messaging Host + ACP Client
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
scripts/              安装 Host
```
