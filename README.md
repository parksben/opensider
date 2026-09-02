# OpenSider

Chromium 侧栏插件：用侧栏自己的聊天面板连接本机 Agent CLI（Cursor `agent acp` 等）。同一个工作区，多条聊天会话。不另起本地 HTTP 服务，不上 MCP。浏览器通过 Native Messaging 按需拉起一份 Go 二进制 Host，Host 再拉起 Agent。用户侧不需要 Node、pnpm 或克隆本仓库。

## 用户安装

前提：Chromium 内核浏览器（Chrome / Edge / Brave 等）+ 已登录的 Agent CLI。

macOS / Linux：

```bash
curl -fsSL https://github.com/parksben/opensider/releases/latest/download/install.sh | bash
```

Windows PowerShell：

```powershell
irm https://github.com/parksben/opensider/releases/latest/download/install.ps1 | iex
```

然后打开 `chrome://extensions`（或 `edge://extensions` / `brave://extensions`），打开开发者模式，加载已解压的扩展，选 `~/.opensider/extension`。也可以从同一个 Release 只下载 `opensider.crx`，打开开发者模式后把该文件拖进扩展页。点工具栏图标打开侧栏。Chrome 若拒绝拖入 `.crx`，仍用上面的已解压目录。桥接还是要跑安装壳。

若还没跑过脚本，侧栏会展示同一行命令；跑完后会自动连上，不必刷新扩展。

`agent login`（或对应 CLI 的登录）仍要先做。

## 开发

本地构建、Host 注册、工作区、仓库结构和发 Release 见 [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)。
