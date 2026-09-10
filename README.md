<div align="center">
  <br />
  <img width="96" height="96" alt="OpenSider" src="./docs/logo.svg" />
  <h1>OpenSider</h1>
  <p>
    Chat with your local coding Agent from a Chromium side panel — no extra HTTP server, no cloud relay.
  </p>
</div>

<br />

OpenSider 把本机 Agent 接到 Chromium 侧栏里。已经在用 Claude Code CLI、Copilot CLI、OpenCode CLI、Cursor 或其它 ACP CLI 的话，打开侧栏就能对着当前页聊。

- 一边看文档、产品页或后台，一边在侧栏里和本机 Agent 说话
- Agent 能读当前页、点按钮、填表、截图，不用只在终端里猜页面长什么样
- 多条会话，记录留在本机；卸了扩展再装回来还在
- 工具调用要不要先问你，可以自己调

## 演示

这段视频演示如何在 OpenSider 会话里让 Agent 提炼网页信息，并生成一份资讯榜单。生成后由 Agent 在浏览器中打开，方便直接预览。

https://github.com/user-attachments/assets/f0a9c654-b66e-43ef-a233-6942a30e83c6

## 安装

适用于 Chrome / Edge / Brave。本机先登录要用的 Agent CLI（例如 `agent login`）。

1. 打开最新 [GitHub Release](https://github.com/parksben/opensider/releases/latest)，下载 `extension.zip`，解压到本机任意目录。
2. 打开扩展页（Chrome：`chrome://extensions`，Edge：`edge://extensions`，Brave：`brave://extensions`），打开**开发者模式**，点「加载已解压的扩展程序」，选中刚才解压出的文件夹。
3. 点工具栏上的 OpenSider 图标，打开侧栏。
4. 按侧栏里的提示，把扩展连到本机 Agent。若还没装本机桥接，侧栏会给出安装命令，按提示在终端或 PowerShell 里执行即可。
5. 连上之后，在 OpenSider 里直接和本机 Agent 聊天。
