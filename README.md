<div align="center">
  <br />
  <img width="96" height="96" alt="OpenSider" src="./docs/logo.svg" />
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
- 会话和偏好存在本机 `~/.opensider`，卸载重装扩展不会丢掉聊天
- 四档权限：默认权限 / 允许文件修改 / 允许工具调用 / 允许一切操作
- 不另起本地 HTTP 服务，不上 MCP

## 演示

这段视频演示如何在 OpenSider 会话里让 Agent 提炼网页信息，并生成一份资讯榜单。生成后由 Agent 在浏览器中打开，方便直接预览。

https://github.com/user-attachments/assets/f0a9c654-b66e-43ef-a233-6942a30e83c6

## 适用场景

- 一边看文档 / 产品页 / 后台，一边让本机 Agent 读页、改代码、写产物
- 要 Agent 替你点页面、填表、切标签，而不是只在终端里猜 DOM
- 已经在用 Cursor、OpenCode、Copilot 等带 ACP 的 CLI，希望浏览器成为同一套工作区的入口

## 安装

适用于 Chrome / Edge / Brave。本机先登录要用的 Agent CLI（例如 `agent login`）。

1. 打开最新 [GitHub Release](https://github.com/parksben/opensider/releases/latest)，下载 `extension.zip`，解压到本机任意目录。
2. 打开扩展页（Chrome：`chrome://extensions`，Edge：`edge://extensions`，Brave：`brave://extensions`），打开**开发者模式**，点「加载已解压的扩展程序」，选中刚才解压出的文件夹。
3. 点工具栏上的 OpenSider 图标，打开侧栏。
4. 按侧栏里的提示，把扩展连到本机 Agent。若还没装本机桥接，侧栏会给出安装命令，按提示在终端或 PowerShell 里执行即可。
5. 连上之后，在 OpenSider 里直接和本机 Agent 聊天。
