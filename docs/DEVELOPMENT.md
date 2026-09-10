# OpenSider — 开发文档

> 给改代码的人看。使用者安装请看仓库根目录 [README.md](../README.md)。需求与方案分别在 [REQUIREMENTS.md](./REQUIREMENTS.md)、[TECH_DESIGN.md](./TECH_DESIGN.md)。开发协作约定见仓库根 [AGENTS.md](../AGENTS.md)（不是 `~/.opensider/workspace/AGENTS.md`）。README 只写产品、演示和使用者安装/使用，不含开发搭建。

本机需要 Go、Node 22+、pnpm。用户侧不需要这些。

## 本地构建

```bash
pnpm install
pnpm build
```

`pnpm build` 会打扩展、写出 `dist-release/extension.zip`，并执行 `go run ./cmd/opensider install --local`。只重新注册 Host：

```bash
pnpm install-host
```

`install --local` 会 `go build` 出 `~/.opensider/runtime/opensider`（不要用 `go run` 当 Native Host），重写各浏览器的 `com.opensider.host.json`，并确保工作区有 `AGENTS.md` / `browser/tools.json` / `outputs/`。若本机已装 Claude Code，还会把 ACP 适配器装到 `~/.opensider/runtime/claude-acp`（没有 Node 只提示，不挡 Host 注册）。若本机 `~/.opensider` 还留着 Node Host 时代的 `PickFiles.app` / `runtime/packages` / 旧 `session.json`，先备份该目录再跑一次安装。

1. 浏览器打开扩展页，加载 `packages/extension/dist`
2. 点工具栏图标打开侧栏

```bash
pnpm dev
```

改扩展后在扩展页点刷新。改 Host 后重新 `pnpm install-host`，再重连侧栏。

README 演示视频见 `docs/opensider.mp4`：Agent 提炼网页信息、生成资讯榜单并在浏览器打开。不要把侧栏拖成独立窗口。

## 工作区

会话 cwd 固定为 `~/.opensider/workspace`。页面快照、命令和截图都在 `workspace/browser/`。用户可见的任务产物约定写在 `workspace/outputs/`（引导，不拦截 Agent 本地工具）。侧栏会话与偏好的权威副本是 `~/.opensider/ui-state.json`（扩展卸载后仍在）。Host 启动时写入 `AGENTS.md` 与 `browser/tools.json`，并确保 `outputs/` 存在。

布局与协议细节见 [TECH_DESIGN.md](./TECH_DESIGN.md) 的「工作区布局」。

## 打 extension.zip

```bash
pnpm pack-extension
```

把 `packages/extension/dist` 打成 `dist-release/extension.zip`（不写出 CRX）。打包**不需要任何密钥文件**：脚本用构建产物 `manifest.json` 里的 `key` 算出未打包 ID，和常量比对，拦住「误改 key 让用户丢侧栏数据」这种情况。`dist-release/` 不入库。完整 `pnpm build` 会先编扩展再打包，再跑 `install --local`。

## tag 发 Release

推送 `v*` tag 会跑 `.github/workflows/release.yml`：macOS 开 cgo 编 darwin 二进制，Ubuntu 交叉编译 linux / windows，再打 `extension.zip`、安装壳和 `SHA256SUMS`，用最近 3 个 commit 发 GitHub Release。不上传 `opensider.crx`。

Release 资产名必须和用户安装壳一致，见 TECH_DESIGN「发布与安装壳」。

## 仓库结构

```
LICENSE               MIT 许可
AGENTS.md             仓库根开发协作约定（不是 ~/.opensider/workspace/AGENTS.md）
cmd/opensider         唯一 Go 入口（无参=Host，install，pick）
internal/             Host / install / pick / ACP
docs/                 需求、技术设计、本文件；README banner / 成片也在这一层
packages/shared       扩展 ↔ Host 消息类型
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
scripts/install       用户壳脚本（由侧栏提示执行，不写进 README 主流程）
scripts/pack-extension.mjs  扩展 zip 打包
.github/workflows     推 v* tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。
