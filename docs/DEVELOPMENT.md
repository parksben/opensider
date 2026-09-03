# OpenSider — 开发文档

> 给改代码的人看。使用者安装请看仓库根目录 [README.md](../README.md)。需求与方案分别在 [REQUIREMENTS.md](./REQUIREMENTS.md)、[TECH_DESIGN.md](./TECH_DESIGN.md)。

本机需要 Go、Node 22+、pnpm。用户侧不需要这些。

## 本地构建

```bash
pnpm install
pnpm build
```

`pnpm build` 会打扩展、写出 `dist-release/opensider.crx` 与 `dist-release/extension.zip`，并执行 `go run ./cmd/opensider install --local`。只重新注册 Host：

```bash
pnpm install-host
```

`install --local` 会 `go build` 出 `~/.opensider/runtime/opensider`（不要用 `go run` 当 Native Host），重写各浏览器的 `com.opensider.host.json`，并确保工作区有 `AGENTS.md` / `browser/tools.json` / `outputs/`。若本机 `~/.opensider` 还留着 Node Host 时代的 `PickFiles.app` / `runtime/packages` / 旧 `session.json`，先备份该目录再跑一次安装。

1. 浏览器打开扩展页，加载 `packages/extension/dist`
2. 点工具栏图标打开侧栏

```bash
pnpm dev
```

改扩展后在扩展页点刷新。改 Host 后重新 `pnpm install-host`，再重连侧栏。

当前 README 成片是 The Verge → 今日最热 AI 新闻 HTML → 人手滚动预览（`docs/demo/opensider.mp4`，2880×1800，35.3s）。分镜见 [docs/demo/NEXT-TAKE.md](./demo/NEXT-TAKE.md)。不要把侧栏拖成独立窗口。

## 工作区

会话 cwd 固定为 `~/.opensider/workspace`。页面快照、命令和截图都在 `workspace/browser/`。用户可见的任务产物约定写在 `workspace/outputs/`（引导，不拦截 Agent 本地工具）。侧栏会话与偏好的权威副本是 `~/.opensider/ui-state.json`（扩展卸载后仍在）。Host 启动时写入 `AGENTS.md` 与 `browser/tools.json`，并确保 `outputs/` 存在。

布局与协议细节见 [TECH_DESIGN.md](./TECH_DESIGN.md) 的「工作区布局」。

## 打 CRX

```bash
pnpm pack-extension
```

把 `packages/extension/dist` 打成 `dist-release/extension.zip` 和 CRX3 `dist-release/opensider.crx`。`dist-release/` 不入库。完整 `pnpm build` 会先编扩展再打包，再跑 `install --local`。

## tag 发 Release

推送 `v*` tag 会跑 `.github/workflows/release.yml`：macOS 开 cgo 编 darwin 二进制，Ubuntu 交叉编译 linux / windows，再打 `opensider.crx`、`extension.zip`、安装壳和 `SHA256SUMS`，用该区间的 commit 列表发 GitHub Release。

Release 资产名必须和用户安装壳一致，见 TECH_DESIGN「发布与安装壳」。

## 仓库结构

```
cmd/opensider         唯一 Go 入口（无参=Host，install，pick）
internal/             Host / install / pick / ACP
docs/                 需求、技术设计、本文件
docs/images/          README logo / 海报
docs/demo/            README 演示视频与分镜 `NEXT-TAKE.md`（当前片 The Verge → 今日最热 AI 新闻 HTML）
packages/shared       扩展 ↔ Host 消息类型
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
scripts/install       用户壳脚本
scripts/pack-extension.mjs  扩展 zip / CRX 打包
.github/workflows     推 v* tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。
