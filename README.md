<div align="center">
  <br />
  <img src="docs/images/logo.svg" width="96" height="96" alt="OpenSider" />
  <h1>OpenSider</h1>
  <p>
    Chat with your local coding Agent from a Chromium side panel — no extra HTTP server, no cloud relay.
  </p>
</div>

<br />

OpenSider 是一个 Chromium 侧栏：用自己的聊天面板连接本机 Agent CLI（Cursor `agent acp` 等）。同一个工作区，多条会话。浏览器通过 Native Messaging 按需拉起一份本机 Host，Host 再拉起 Agent。你不需要 Node、pnpm，也不需要克隆这个仓库。

- 侧栏里直接聊，过程、工具调用、权限卡都在面板里
- 读当前页、点控件、填表、截图，让 Agent 对着网页动手
- 多会话、分叉、队列发送；产物可以在侧栏里打开所在文件夹
- 四档权限：每次确认 / 工作区改文件免确认 / 工具免确认 / 允许一切操作
- 不另起本地 HTTP 服务，不上 MCP

## 演示

在 [Ada Lovelace 英文维基](https://en.wikipedia.org/wiki/Ada_Lovelace) 上让 Agent 读出事实，再 **新开标签** 到 [Open Library](https://openlibrary.org/) 填入 `Ada Lovelace Analytical Engine` 并出结果——证明侧栏 Agent 会跨页操作真实网页，而不是只写本地 HTML。成片是 Chrome **窗口内右侧 Side Panel**（约四分之一宽），标签栏和地址栏入画。分镜见 [docs/demo/NEXT-TAKE.md](docs/demo/NEXT-TAKE.md)。Agent 思考/等待段加速，打字、发送和新标签保持 1x。

<div align="center">
  <video src="docs/demo/opensider.mp4" width="720" controls poster="docs/images/demo-poster.png">
    <a href="docs/demo/opensider.mp4">Watch the demo</a>
  </video>
</div>

## 适用场景

- 一边看文档 / 产品页 / 后台，一边让本机 Agent 读页、改代码、写产物
- 要 Agent 替你点页面、填表、切标签，而不是只在终端里猜 DOM
- 已经在用 Cursor、OpenCode、Copilot 等带 ACP 的 CLI，希望浏览器成为同一套工作区的入口

## 安装

前提：Chromium 内核浏览器（Chrome / Edge / Brave）+ 已登录的 Agent CLI（例如先跑 `agent login`）。

### 1. 下载 Release 资产

打开最新版本：<https://github.com/parksben/opensider/releases/latest>

常用文件：

- [`opensider.crx`](https://github.com/parksben/opensider/releases/latest/download/opensider.crx) — 可拖进扩展页的安装包
- [`extension.zip`](https://github.com/parksben/opensider/releases/latest/download/extension.zip) — 已解压扩展的压缩包
- [`install.sh`](https://github.com/parksben/opensider/releases/latest/download/install.sh) / [`install.ps1`](https://github.com/parksben/opensider/releases/latest/download/install.ps1) — 本机桥接安装壳

只装扩展连不上本机 Agent，桥接必须跑。

### 2. 运行本机桥接

macOS / Linux：

```bash
curl -fsSL https://github.com/parksben/opensider/releases/latest/download/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://github.com/parksben/opensider/releases/latest/download/install.ps1 | iex
```

脚本会从同一个 Release 拉取对应系统的 Host 二进制，校验后再执行 `opensider install`。

### 3. 打开开发者模式并加载扩展

1. 打开 `chrome://extensions`（Edge：`edge://extensions`，Brave：`brave://extensions`）
2. 打开**开发者模式**
3. 点「加载已解压的扩展程序」，选 `~/.opensider/extension`（安装壳解压到这里）

也可以把 `opensider.crx` 拖进扩展页。Chrome 常常会拒绝拖入未上架的 `.crx`；被拒就改用上面的已解压目录，或先解压 `extension.zip`。桥接仍然要跑安装壳。

若还没跑过脚本，侧栏会给出同一行命令。跑完后会自动连上，不必刷新扩展。

## 装好之后

点工具栏上的 OpenSider 图标打开侧栏。选一个本机已登录的 Agent，在空会话里发第一条消息即可。顶栏「Connection」可以真正重连桥接。

界面默认英文；右上角语言按钮在英文界面显示「中」。

## 开发

本地构建、Host 注册、工作区、仓库结构和发 Release 见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
