<div align="center">
  <br />
  <img width="96" height="96" alt="OpenSider" src="./docs/logo.svg" />
  <h1>OpenSider</h1>
  <p>
    你期待已久的浏览器自动化工具
  </p>
</div>

<br />

OpenSider 是一个浏览器扩展程序，支持在浏览器侧边栏中连接本地 Agent（Claude Code CLI、Copilot CLI、OpenCode CLI、Cursor CLI 等本地 Agent 工具）。打开侧边栏即可指挥 Agent 干活，对浏览器中的多个网页进行自动化操作。

- **在浏览器中与 Agent 协作**  
  在浏览器侧边栏中直接与本地 Agent 对话，不用开启命令行或终端工具。

- **自动载入浏览器上下文**  
  无需告诉 Agent 当前你在看什么网页，Agent 能够自动拿到浏览器中所加载的网页的信息，并进行自动化操作。

- **数据持久化**  
  所有会话数据持久保存在本地，扩展更新或重装后数据不会丢。

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
