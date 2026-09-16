# OpenSider — 开发文档

> 给改代码的人看。使用者安装请看仓库根目录 [README.md](../README.md)。需求与方案分别在 [REQUIREMENTS.md](./REQUIREMENTS.md)、[TECH_DESIGN.md](./TECH_DESIGN.md)。开发协作约定见仓库根 [AGENTS.md](../AGENTS.md)（不是 `~/.opensider/workspace/AGENTS.md`）。README 只写产品、演示和使用者安装/使用，不含开发搭建。

本机需要 Go、Node 22+、pnpm。用户侧不需要这些。

## 本地构建

```bash
pnpm install
pnpm build          # 编扩展 + 打 dist-release/extension.zip
pnpm install-host   # go build 出 ~/.opensider/runtime/opensider，拷 dist，再跑 install
```

`pnpm install-host`（`scripts/dev-host.mjs`）是**开发专用**：它编出真实二进制（不要用 `go run` 当 Native Host，Chrome 保不住这个进程）、把 `packages/extension/dist` 拷到 `paths.ExtensionDir()`（默认家目录下的 `OpenSider`，和用户侧同一个位置），再让该二进制 `install` —— 重写各浏览器的 `com.opensider.host.json`、确保工作区有 `AGENTS.md` / `browser/tools.json` / `outputs/`；若本机已装 Claude Code 或 Codex，还会把对应的 ACP 适配器装到 `~/.opensider/runtime/<agent>-acp`（没有 Node 只提示，不挡注册）。若本机 `~/.opensider` 还留着 Node Host 时代的 `PickFiles.app` / `runtime/packages` / 旧 `session.json`，先备份该目录再跑一次。

用户侧没有这条路径，也没有 `install.sh` / `install.ps1`：他们复制 README 里的一段提示词，由自己在用的 AI Agent 按 [`skills/opensider/`](../skills/opensider/SKILL.md) 执行，安装 / 更新 / 卸载 / 体检都走同一份 skill。改这些 markdown 等于改用户侧的安装行为，改完要在真机上按 skill 走一遍。

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

把 `packages/extension/dist` 打成 `dist-release/extension.zip`（不写出 CRX）。打包**不需要任何密钥文件**：脚本用构建产物 `manifest.json` 里的 `key` 算出未打包 ID，和常量比对，拦住「误改 key 让用户丢侧栏数据」这种情况。`dist-release/` 不入库。`pnpm build` = 编扩展 + 打包，不再碰本机 Host。

## tag 发 Release

推送 `v*` tag 会跑 `.github/workflows/release.yml`：macOS 开 cgo 编 darwin 二进制，Ubuntu 交叉编译 linux / windows，再打 `extension.zip` 和 `SHA256SUMS`，用最近 3 个 commit 发 GitHub Release（不上传 `opensider.crx`；**不再发 `install.sh` / `install.ps1`**）。二进制用 `-ldflags "-X …/internal/version.Version=${tag}"` 注入版本号，`opensider version` 与侧栏的版本行都读它（显示时统一剥掉 tag 的 `v`，见 `internal/version.Display()`）；走 `go build ./cmd/opensider` 手编时版本是 `dev`，侧栏不会据此报「有新版本」。

发版前记得把 `packages/extension/manifest.config.ts` 的 `version` 改成同一个 tag（去掉 `v`）——侧栏把扩展版本和最新 tag 比较，对不上就会一直提示更新；流水线里有一条 `test` 专门挡这种情况。本地开发想要同样的版本号时，`pnpm install-host` 会自动取最近一个 `v*` tag 注进二进制（没有 tag 就是 `dev`）。

Release 资产名必须和 skill 一致，见 TECH_DESIGN「发布与 skill 安装」。

## 仓库结构

```
LICENSE               MIT 许可
AGENTS.md             仓库根开发协作约定（不是 ~/.opensider/workspace/AGENTS.md）
cmd/opensider         唯一 Go 入口（无参=Host，install，uninstall，version，pick）
internal/             Host / install / pick / ACP
docs/                 需求、技术设计、本文件；README banner / 成片也在这一层
packages/shared       扩展 ↔ Host 消息类型
packages/extension    Chrome MV3 侧栏 / 内容脚本 / Service Worker
skills/opensider      安装 / 更新 / 卸载 / 体检测 skill（README 的提示词指向它）
scripts/dev-host.mjs  开发用：编二进制 + 拷扩展 + 注册桥接（= pnpm install-host）
scripts/pack-extension.mjs  扩展 zip 打包
scripts/verify-native-ui.mjs  原生 UI shim 的端到端验证（真 Chromium + 已构建扩展）
scripts/verify-page-activity.mjs  页面活动态（面板开着强制可见 / 关掉还原）的端到端验证
scripts/verify-queue-send-now.mjs  消息队列「立即发送」的端到端验证
scripts/verify-file-drop.mjs  拖文件到侧栏 → 变附件的端到端验证
scripts/lib/sandbox.mjs  上面几个脚本共用的沙箱（临时 HOME / 现编 Host / 假 Agent / profile 内桥接清单）
scripts/fake-acp-agent.mjs  假 ACP Agent（e2e 用，按行 JSON，可控分片/是否响应 cancel）
scripts/install       已删除（用户侧不再有壳脚本）
.github/workflows     推 v* tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。

扩展的单元测试用 Node 自带的 runner（仓库没有 vitest）：`node --test 'packages/extension/src/**/*.test.ts'`。
**必须带 `**`**：`sidepanel/` 下面还有一批用例，写成 `src/*.test.ts` 会静默跳过它们（之前就这么漏了一批）。
原生 UI（`alert` / `confirm` / `prompt` / `print` / `window.open` / 文件选择器）这条链路单测盖不到，
改完跑 `node scripts/verify-native-ui.mjs`：它用本机缓存的 Chromium 拉起一个真浏览器、装上
`packages/extension/dist`，用两个固定页面（含一个 `script-src 'self'` 的 strict CSP 页面）验证
「默认只观察、真弹窗照旧且能拿到用户答案」「`answer` 策略下同步代答且不弹窗」「文件选择器不弹」
「策略过期后回到观察」，共 15 项检查。它依赖全局装的 playwright（`npm i -g playwright`）。

消息队列的「立即发送」（打断当前一轮 + 立刻把这条发出去）也靠真浏览器验证：
`node scripts/verify-queue-send-now.mjs`。它在一个临时沙箱里跑：临时 HOME、现编的 Host
二进制、把假 Agent（`scripts/fake-acp-agent.mjs`）放到检测顺序最靠前的 OpenSider 自有
bin 目录冒充 `copilot`，并把本机桥接清单写进临时 profile 的 `NativeMessagingHosts/`
（Chromium 自己的构建只认 profile 内这份，临时 HOME 会被忽略）。跑完 12 项检查，
覆盖「消息进队列 → 点立即发送 → 新消息上屏且真的被 Agent 收到 → 新一轮起来 → 旧一轮
被砍短 → Host 日志里确实走了 interrupt 路径」。注意：清单里 `copilot` 的解析顺序依赖
`paths.AgentSearchDirs()`，改了那段要同步改这个脚本。

页面活动态（面板开着时把 Agent 在动的标签强制成「可见 + 有焦点」，关掉侧栏还原）分两层验：
核心机制（`packages/extension/src/activity-shim.ts` 的可见性 / 焦点改写、事件静音、rAF 回退、
TTL 过期、解除还原）跑 `node --test 'packages/extension/src/**/*.test.ts'` 里的单测，用最小的假 DOM；
接线与生命周期跑 `node scripts/verify-page-activity.mjs`（7 项检查），它用扩展自己的 `switchTab`
把页面变成当前标签、再用主世界的 `chrome.scripting.executeScript` 看页面自己读到什么，
最后关掉侧栏验证还原。**注意它测不了「真的被隐藏」**：Playwright 的 Chromium 自己开着焦点模拟，
页面永远是 visible，所以那部分只能在单测里用假环境覆盖，脚本注释里写明了这个边界。

拖文件进侧栏（整个面板都能接）跑 `node scripts/verify-file-drop.mjs`：它在同一个沙箱里连上假 Agent，
合成一次 `DataTransfer` 拖放（真机拖拽的 `webkitGetAsEntry` 合成不出来，脚本里会走 `dataTransfer.files`
回退分支），断言「拖入时出现投放提示」「文件变成附件芯片」「Host 真的把副本写进
`workspace/browser/uploads/` 且字节一致」「面板没有被浏览器导航走」。「拖文件夹」那条链路的递归读取
用 `packages/extension/src/sidepanel/file-drop.test.ts` 里的假 entry 覆盖（含超大跳过、数量上限、
读不出的项跳过），Host 侧的路径安全与去重写在 `internal/workspace/upload_test.go`。
