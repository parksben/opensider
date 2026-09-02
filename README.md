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

本机需要 Go、Node 22+、pnpm。

```bash
pnpm install
pnpm build
```

`pnpm build` 会打扩展、写出 `dist-release/opensider.crx` 与 `dist-release/extension.zip`，并执行 `go run ./cmd/opensider install --local`。只重新注册 Host：

```bash
pnpm install-host
```

推送 `v*` tag 会跑 `.github/workflows/release.yml`：macOS 开 cgo 编 darwin 二进制，Ubuntu 交叉编译 linux / windows，再打 `opensider.crx`、`extension.zip`、安装壳和 `SHA256SUMS`，用该区间的 commit 列表发 GitHub Release。

1. 浏览器打开扩展页，加载 `packages/extension/dist`
2. 点工具栏图标打开侧栏

```bash
pnpm dev
```

改扩展后在扩展页点刷新。改 Host 后重新 `pnpm install-host`，再重连侧栏。

## 工作区

会话 cwd 固定为 `~/.opensider/workspace`。页面快照、命令和截图都在 `workspace/browser/`。Host 启动时写入 `AGENTS.md` 与 `browser/tools.json`。

## 仓库结构

```
cmd/opensider         唯一 Go 入口（无参=Host，install，pick）
internal/             Host / install / pick / ACP
docs/                 需求与技术设计
packages/shared       扩展 ↔ Host 消息类型
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
scripts/install       用户壳脚本
scripts/pack-extension.mjs  扩展 zip / CRX 打包
.github/workflows     推 v* tag 发 Release
```
