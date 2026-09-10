<div align="center">
  <br />
  <img width="96" height="96" alt="OpenSider" src="./docs/logo.svg" />
  <h1>OpenSider</h1>
  <p>
    你期待已久的浏览器自动化工具
  </p>
</div>

<br />

> [English README](./README-en.md)

OpenSider 是一个浏览器扩展程序，支持在浏览器中驱动本地 Agent（Claude Code CLI、Copilot CLI、OpenCode CLI、Cursor CLI 等本地 Agent 工具）进行网页信息采集、网页自动化操作等工作。

- **在浏览器中与 Agent 协作**  
  在浏览器侧边栏中直接与本地 Agent 对话，不用开启命令行或终端工具。

- **自动载入网页上下文**  
  无需告诉 Agent 当前你在看什么网页，Agent 能自动拿到浏览器加载的网页信息并自动化操作。

- **数据持久化**  
  所有会话数据保存在本地，应用更新或重装后数据不会丢。

## 视频演示

示例内容：通过聊天让 Agent 提炼网页信息并生成一份资讯榜单（HTML文件）并在浏览器中打开。

https://github.com/user-attachments/assets/f0a9c654-b66e-43ef-a233-6942a30e83c6

## 安装使用

> 本扩展程序适用于 Chrome / Edge / Brave 等 Chromium 内核的浏览器。安装前请确保本机已有正在运行的 Agent CLI 程序。

安装过程仅需四步：

1. 在 [下载页面](https://github.com/parksben/opensider/releases/latest) 下载 `extension.zip` 文件，解压到本机任意目录。
2. 打开浏览器扩展页（Chrome：`chrome://extensions`，Edge：`edge://extensions`），右上角打开**开发者模式**，左侧点击「加载已解压的扩展程序」，在弹出的文件窗口中选中刚才解压出的文件夹。
3. 点浏览器右上角工具栏上的 OpenSider 图标，浏览器侧边栏会弹出 OpenSider 的用户界面。
4. 首次使用时需按界面中提示，在终端或命令行（Terminal/PowerShell）中执行界面中显示的命令，将本地的 Agent CLI 连上浏览器。连接成功后即可在用户界面中与本地 Agent 开聊。
