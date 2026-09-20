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

## 发 Release（本地构建，不走 Actions）

发布**全在本机完成**，然后用 `gh release` 把产物推上去。原因写死在 `AGENTS.md`：GitHub 账号被账单锁着，跑 Actions 只会失败，所以 `.github/workflows/release.yml` 现在是参考/备用，不是发版路径（它的触发条件是 `push: tags: v*`，**推 tag 会真的拉起它**，下面的步骤因此要先禁用）。

```bash
# 1. 版本号：扩展 manifest 必须等于 tag（去掉 v），侧栏拿它和最新 tag 比。
#    改 packages/extension/manifest.config.ts 的 version，commit + push。

# 2. 扩展 + 打包
pnpm --filter @opensider/extension build   # vite build + page-hooks
pnpm pack-extension                        # dist-release/extension.zip

# 3. 六个平台二进制（版本号用 ldflags 注进去，手编不带就是 dev）
tag=v0.4.0
ldflags="-X github.com/parksben/opensider/internal/version.Version=$tag"
CGO_ENABLED=1 go build -ldflags "$ldflags" -o dist-release/opensider-darwin-arm64 ./cmd/opensider
CGO_ENABLED=1 GOARCH=amd64 CC="clang -arch x86_64" \
  go build -ldflags "$ldflags" -o dist-release/opensider-darwin-amd64 ./cmd/opensider
for target in linux/amd64 linux/arm64; do
  GOOS=${target%/*} GOARCH=${target#*/} CGO_ENABLED=0 \
    go build -ldflags "$ldflags" -o "dist-release/opensider-${target%/*}-${target#*/}" ./cmd/opensider
done
for arch in amd64 arm64; do
  GOOS=windows GOARCH=$arch CGO_ENABLED=0 \
    go build -ldflags "$ldflags" -o "dist-release/opensider-windows-$arch.exe" ./cmd/opensider
done
chmod +x dist-release/opensider-darwin-* dist-release/opensider-linux-*

# 4. 校验和（顺序照抄上一次，skill 按名字取）
cd dist-release && shasum -a 256 opensider-darwin-* opensider-linux-* opensider-windows-* extension.zip > SHA256SUMS
cd ..

# 5. Release 正文：**手写**一段 2–3 行的英文摘要，说清这一版最大的变更是什么。
#    先回顾素材（脚本只列上个 v* tag 以来的 commit 标题、不带 hash，是给人看的，不要贴进正文）：
bash scripts/changes-since-tag.sh
#    写完存 dist-release/NOTES.md。文案先跟用户确认可行，再发。

# 6. 发上去（先禁掉 workflow，免得推 tag 触发它）
gh workflow disable release.yml
git tag -a $tag -m $tag && git push origin $tag
gh run list --limit 3                 # 应当看不到新 run
gh release create $tag --title $tag --notes-file dist-release/NOTES.md \
  dist-release/opensider-darwin-* dist-release/opensider-linux-* \
  dist-release/opensider-windows-* dist-release/extension.zip dist-release/SHA256SUMS
gh workflow enable release.yml         # 恢复仓库状态
```

发完自查：`dist-release/opensider-darwin-arm64 version` 应是 `0.4.0`（`internal/version.Display()` 剥掉 `v`）；`node -p "require('./packages/extension/dist/manifest.json').version"` 要和 tag 一致；`gh release view $tag --json assets` 应当正好 8 个（六个二进制 + `extension.zip` + `SHA256SUMS`）；`gh release view $tag --json body` 应当是人写的 2–3 行摘要，不是一串 commit；`https://api.github.com/repos/parksben/opensider/releases/latest` 刷新到新 tag（侧栏的更新提示就看它，缓存 TTL 一小时）。

踩过的坑：资产已经存在时上传会被拒，补传用 `gh release upload $tag <file> --clobber`；正文写废了用 `gh release edit $tag --notes-file dist-release/NOTES.md` 覆盖，不用重建 Release；`dist-release/` 不入库（只提交 manifest 版本号和文档）；darwin 开 cgo 是为了 `internal/pick` 的 AppKit，x86_64 那条靠 `CC="clang -arch x86_64"`，SDK 不支持时宁可少了 amd64 也不能发个不能跑的；本地开发想要同样的版本号，`pnpm install-host` 会自动取最近一个 `v*` tag 注进二进制（没有 tag 就是 `dev`）。

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
packages/extension/scripts/build-page-hooks.mjs  把两个主世界钩子编成经典脚本（page-hooks/*.js）
skills/opensider      安装 / 更新 / 卸载 / 体检测 skill（README 的提示词指向它）
scripts/dev-host.mjs  开发用：编二进制 + 拷扩展 + 注册桥接（= pnpm install-host）
scripts/pack-extension.mjs  扩展 zip 打包
scripts/verify-native-ui.mjs  原生 UI shim 的端到端验证（真 Chromium + 已构建扩展）
scripts/verify-page-activity.mjs  页面活动态（面板开着强制可见 / 关掉还原）的端到端验证
scripts/verify-tab-control.mjs  标签接管（借用 / 收回 / 后台操作 / quiet openTab）的端到端验证
scripts/verify-page-tamper.mjs  主世界钩子「不留痕」的端到端验证（未触碰页面必须与干净 Chromium 一致）
scripts/verify-queue-send-now.mjs  消息队列「立即发送」的端到端验证
scripts/verify-file-drop.mjs  拖文件到侧栏 → 变附件的端到端验证
scripts/verify-composer-clipboard.mjs  输入框全选复制/剪切带上附件栏的端到端验证
scripts/verify-page-overlays.mjs  动作后自动上报页面浮层（模态框/抽屉）的端到端验证
scripts/verify-host-skew.mjs  本机 Host 比扩展旧时的提示（可见 / 可关 / 不影响可用功能）
scripts/verify-state-mirror.mjs  状态镜像（>1MB 分片推送 / 上传、超限帧不脱帧、空态不覆盖）的帧级验证
scripts/verify-first-connect.mjs  首次打开侧栏要自己连上（`SCENARIO=local` 扩展重载 / `SCENARIO=mirror` 卸载重装）的端到端验证
scripts/verify-held-send.mjs  连接未就绪时发消息（草稿按住、就绪后补发，不吞消息）的端到端验证
scripts/verify-selection.mjs  划词隐藏通道（不进侧栏 / 独立会话 / 取消恢复）的帧级验证
scripts/verify-selection-ui.mjs  划词工具条（门控 / 结构 / 定位 / 层级 / 结果层 / 引文芯片）的端到端验证
scripts/verify-skill-menu.mjs  `/` skill 探测菜单（列表 / 搜索 / 详情面板 / 芯片落位 / 发出的提示词）的端到端验证
scripts/verify-agent-switch-guard.mjs  有任务在跑时切 Agent（确认弹窗 / 取消不切 / 确认才切）的端到端验证
scripts/lib/sandbox.mjs  上面几个脚本共用的沙箱（临时 HOME / 现编 Host / 假 Agent / profile 内桥接清单）
scripts/fixtures/player-check.html  模拟「站点自己做环境自检就拒绝播」的假播放器（人工验收用）
scripts/fake-acp-agent.mjs  假 ACP Agent（e2e 用，按行 JSON，可控分片/是否响应 cancel；另答 `<cli> models`）
scripts/install       已删除（用户侧不再有壳脚本）
.github/workflows     推 v* tag 发 Release
```

pnpm workspace 只编扩展。Host 用 Go。扩展用 Vite + `@crxjs/vite-plugin` 打包。

扩展的构建是**两步**：`pnpm --filter @opensider/extension build` 先跑 `vite build`（侧栏 / 内容脚本 /
SW），再由 `packages/extension/scripts/build-page-hooks.mjs` 把两个主世界钩子编成经典脚本放进
`dist/page-hooks/`。顺序不能反：`vite build` 会清空 `dist`。只改钩子时可以单跑
`pnpm --filter @opensider/extension build:page-hooks`。

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

「Agent 还没连上就按发送」跑 `node scripts/verify-held-send.mjs`（9 项）：它把 Host 的
启动故意晚 4 秒（改沙箱里的 `launch-host.sh`），面板先打开、先打字，稳定落在「连接还没
就绪」那个窗口里；断言草稿还在、没报离线错、也没先把气泡上屏，然后就绪后那条 prompt 真的
到达假 Agent（trace 里有且只有一条），正文照常流回来。

页面活动态（面板开着时把 Agent 在动的标签强制成「可见 + 有焦点」，关掉侧栏还原）分两层验：
核心机制（`packages/extension/src/activity-shim.ts` 的可见性 / 焦点改写、事件静音、rAF 回退、
TTL 过期、解除还原）跑 `node --test 'packages/extension/src/**/*.test.ts'` 里的单测，用最小的假 DOM；
接线与生命周期跑 `node scripts/verify-page-activity.mjs`（7 项检查），它用扩展自己的 `switchTab`
把页面变成当前标签、再用主世界的 `chrome.scripting.executeScript` 看页面自己读到什么，
最后关掉侧栏验证还原。**注意它测不了「真的被隐藏」**：Playwright 的 Chromium 自己开着焦点模拟，
页面永远是 visible，所以那部分只能在单测里用假环境覆盖，脚本注释里写明了这个边界。

主世界钩子只在「面板开着 + Agent 触及该标签页」时注入（原因与做法见 TECH_DESIGN 的
「主世界钩子的注入时机」），所以「没在用的页面一点都不该被改动」这件事单独验：
`node scripts/verify-page-tamper.mjs`（13 项）。它先跑一次干净 Chromium 记下基准指纹，
再装上扩展比一遍：未触碰的标签页必须**逐项一致**（11 个原生入口都是 `[native code]`、
`window` 上没有 `__opensider*` 全局、`Object.getOwnPropertyNames(HTMLDocument.prototype)`
仍是 `["constructor"]`）；同时确认 `listTabs` 依旧看得到所有标签、当前活动标签也认得出（这两件事
本来就不依赖主世界注入）；然后让 Agent 真的碰一下该标签页，断言钩子装上了；关掉面板断言回到基准；
再触及一次断言**能第二次装上**（钩子是经典脚本就是为了这一条：ESM loader 一个文档只求值一次，
重新注入会空转）；最后模拟页面抢走钩子（页面自己 `delete` 再抢先 `handshake`），断言扩展自愈、
Agent 不会失明。改了 `manifest.config.ts` / `build-page-hooks.mjs` / `background.ts` 的注入路径，
或改了 `activity-shim.ts` 的还原逻辑，都要跑这个脚本——它已经扣出过 `hasFocus` 还原不干净、
`document.onvisibilitychange` 代管从来没装上、以及「释放后再注入装不回来」三个问题。

上面几个脚本默认**带界面跑**（真窗口，方便看它到底在干什么）；要无头就加 `HEADLESS=1`。

想在浏览器里肉眼确认「我们不碰的页面没被动过」，用 `scripts/fixtures/player-check.html`：它是
一个自己查环境、查不过就停下不放的假播放器（原生入口是不是 `[native code]`、`document` 原型上
有没有多出自有属性、有没有可疑全局）。直接在 VS Code 内置浏览器里打开（工作区文件可行 `file://`），
或者用真 Chrome 加载 `packages/extension/dist`：

- 没装扩展 / 没在用的标签页：横幅 `state=running`（录播器照常跑）。
- 点页面上的「simulate the old always-on hooks」（那正是 v0.2.11 对**每个**页面做的事）：横幅立刻变红，
  `failed:` 列出多出来的 `hidden` / `visibilityState` / `hasFocus` 和可疑全局。
- 装了扩展、且让 Agent 真的碰一下这个标签页：也会变红（这是已知代价，写在 `REQUIREMENTS.md` 第 18 条）。
- 关掉侧栏（面板释放该标签页）：全局消失、原型回到只有 `constructor`，再点「restart the player」
  就又能跑起来。

拖文件进侧栏（整个面板都能接）跑 `node scripts/verify-file-drop.mjs`（12 项）：它在同一个沙箱里连上假 Agent，
先用合成的 `DataTransfer` 拖一次，**再用 CDP 真拖一次**（`Input.setInterceptDrags` 打开后
`Input.dispatchDragEvent` 带 `files: [路径]`，页面拿到的是 Chrome 自己造的那份 DataTransfer，
有真 entry）——合成拖拽永远走 `dataTransfer.files` 回退分支，`webkitGetAsEntry()` + `entry.file()`
这条真机路径靠它才有人看着。断言「拖入时出现投放提示」「文件变成附件芯片」「Host 真的把副本写进
`workspace/browser/uploads/` 且字节一致」「面板没有被浏览器导航走」，最后拖一个超过上限的文件，
断言**面板会把原因说出来**（提示条可见）而不是默不作声。「拖文件夹」那条链路的递归读取用
`packages/extension/src/sidepanel/file-drop.test.ts` 里的假 entry 覆盖（含超大跳过、数量上限、
entry 读不出 / 永远不回调时回退到同一个 item 的文件、几条路都空算 unreadable），
Host 侧的路径安全与去重写在 `internal/workspace/upload_test.go`。

本机 Host 比扩展旧时的提示跑 `node scripts/verify-host-skew.mjs`（6 项）：沙箱把 Host 编成
`v0.2.0`（`createSandbox({ hostVersion })` 注入 ldflags，代码还是当前这份），断言侧栏里能看见
「Host 比扩展旧」、能关掉、并且关之前拖文件照样进附件栏——旧 Host 静默丢掉不认识的命令
正是用户报的「拖进去没反应」，所以这条链路必须有测试盯着。

提醒自己：`setError` 在 `status === "ready"` 时只当 tooltip（`Header` 的 title），**用户看不见**。
凡是「刚才那一下没成功」的提示（拖入 / 粘贴失败、桥接太旧或没响应）都走 `notice`，
在输入框上方渲染成一条可关闭的提示条（`App.tsx` 的 `notice` / `ChatPane` 的 `notice` prop）。

**沙箱里的假 Agent 必须答 `<cli> models`**（`scripts/fake-acp-agent.mjs` 开头的分支）：
Host 打开会话前会跑一次 `<cli> models`（`internal/models` 的 20s 超时），假 Agent 不答的话
每次握手都要白等 20s 才回落，整个面板连上要约 28s —— 正好卡在脚本 30s 等待的边缘，
表现为「随机失败」。补上这一条后 `verify-file-drop` 从 ~30s 降到 ~18s（剩下的基本是 `go build`
和浏览器启动）。别把这段当冗余删掉。

输入框「全选复制 / 剪切带上附件栏」跑 `node scripts/verify-composer-clipboard.mjs`（12 项）：载荷不进剪贴板
（Chromium 只保留白名单风味），而是扩展自己记 90 秒，粘贴文本一模一样时还原一次；脚本用「开第二个面板页」
当「另一个会话的输入框」，并覆盖「部分选中不带附件」「cut 只剪走正文、附件栏不动」「粘图仍然进附件栏」。
注意 `Cmd+A` 在 contenteditable 里选的是**文本**，和 `selectNodeContents` 的边界点差一位 —— 判定得比渲染文本，
别再用边界点（第一版就是这么把真全选判掉的）。

页面浮层（页面自己的模态框 / 抽屉 / 遮罩）跑 `node scripts/verify-page-overlays.mjs`（10 项）：点开按钮后
`click` 的结果里直接带 `data.overlays`，集合没变化时不带，关掉时带一份空表，同时 Host 把
`browser/overlays.json` 整表覆盖。判定规则（role / aria-modal / `<dialog open>` / 高 z-index 且够大的浮层）
是纯函数，单测在 `packages/extension/src/overlays.test.ts`。
