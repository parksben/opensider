<div align="center">
  <br />
  <img alt="OpenSider" src="./docs/banner.svg" />
  <p>
    为你的浏览器插上AI的翅膀
  </p>
  <p>
    <a href="https://github.com/parksben/opensider/releases/latest"><img alt="最新版本" src="https://img.shields.io/github/v/release/parksben/opensider?label=RELEASE" /></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/parksben/opensider?label=LICENSE" /></a>
  </p>
</div>

<div align="center">
  中文 | <a href="./README.md">English</a>
</div>

<br />

OpenSider 是一个浏览器扩展程序，支持在浏览器中驱动本地 Agent（Claude Code、Codex、OpenCode、Cursor 等支持 ACP 通信的本地 Agent CLI）进行网页信息采集、网页自动化操作等工作。

- **在浏览器中与 Agent 协作**  
  在浏览器侧边栏中直接与本地 Agent 对话，不用开启命令行或终端工具。

- **复用真实浏览器状态**
  站点的用户身份（登录态）、填写的表单状态都会保留复用，不需要重新还原现场。

- **自动载入网页上下文**
  无需告诉 Agent 当前你在看什么网页，Agent 能自动拿到浏览器加载的网页信息并自动化操作。

- **网页自动化**
  页面跳转、读取、点击、填表、截图等操作作为工具注入给 Agent，自动化操作在网页中实时呈现（模拟鼠标点击、键盘输入等）。

- **就地开始协同**
  当前在哪个页面，Agent 就结合这个页面的信息工作。也可以拾取网页元素进行提问。

- **可自由切换 Agent 与模型**
  支持一键切换 Agent/模型，同一会话中也可使用不同的 Agent，不受终端工具束缚。

- **数据持久化**
  所有会话数据保存在本地，应用更新或重装后数据不会丢。

## 视频演示

示例内容：通过聊天让 Agent 提炼网页信息并生成一份资讯榜单（HTML文件）并在浏览器中打开。

https://github.com/user-attachments/assets/f0a9c654-b66e-43ef-a233-6942a30e83c6

## 安装使用

### 1. 安装

> 本扩展程序适用于 Chrome / Edge / Brave 等 Chromium 内核的浏览器。安装前请确保本机已有正在运行的 Agent CLI 程序。

一键安装：把下面这段提示词复制给你正在使用的本地 AI Agent（Claude Code、Codex、OpenCode、Cursor 等），它会完成本地环境准备并引导你完成扩展程序的安装。

```
帮我安装 OpenSider 浏览器扩展。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其安装流程执行。
```

### 2. 更新

一键更新：当扩展程序界面中出现新版本提示时，可复制以下提示词给你的本地 Agent，在其引导下完成新版本的安装。

```
帮我更新 OpenSider 浏览器扩展。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其更新流程执行。
```

### 3. 卸载

一键卸载：同样只需一段提示词，卸载时可选择保留或移除本地已有数据。

```
帮我卸载 OpenSider 浏览器扩展。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其卸载流程执行。
```

## 工作区与本地数据

OpenSider 不会将应用配置和聊天内容上传到任何云端服务器，所有会话和 Agent 产物全部均保存在本机 `~/.opensider` 目录下，卸载或重装扩展后仍能继续使用。

| 文件\/目录 | 具体内容 |
|---|---|
| `~/.opensider/workspace/` | Agent 工作目录：所有标签页和会话均在同一目录下工作 |
| `~/.opensider/workspace/browser/` | 会话过程产生的各类临时文件，如：当前页快照、交互控件列表、页面命令与结果、截图等 |
| `~/.opensider/workspace/outputs/` | Agent 在会话中生成的各类产物（表格、文档、代码等） |
| `~/.opensider/ui-state.json` | 会话列表、聊天记录与偏好设置 |
| `~/.opensider/runtime/` | 本机桥接二进制，以及 Claude Code / Codex 用的 ACP 适配器 |
| `~/.opensider/host.log` | 桥接日志，可以让 Agent 根据此日志调试各类异常。按大小和日期自动轮转，历史片为同目录的 `host.log.<时间戳>` |
| 安装时你选定的扩展目录（建议 `~/OpenSider/`） | 浏览器实际加载的扩展目录，**不要移动或删除**，否则扩展会失效 |

Windows 上对应 `%USERPROFILE%\.opensider` 与 `%USERPROFILE%\OpenSider`。

## 常见问题

### 为什么 OpenSider 只支持 Agent CLI，不支持带界面的桌面 Agent 应用？

OpenSider 本身就是一个 Agent 客户端：本地桥接程序负责启动 Agent 进程，并通过 ACP 传递会话、流式回复、工具调用和权限请求。因此，可接入的 Agent 必须提供直接支持 ACP 的 CLI，或具有可用的 ACP 适配器。

Claude、Codex 等桌面应用将运行时封装在自己的界面中，没有向 OpenSider 暴露可供启动和控制的稳定 ACP 进程接口。模拟操作它们的窗口既不可靠，也无法完整承载协议行为，因此不支持桌面应用本身；如果对应的 CLI 支持 ACP 或具有兼容适配器，仍可单独接入。

如需接入这两款产品，请改用对应的 CLI：

- **Claude Code：**先安装并登录 [Claude Code CLI](https://docs.claude.com/en/docs/claude-code/setup)，再重新执行上方的 OpenSider 安装提示词。OpenSider 会检测 `claude` 并配置所需的 ACP 适配器。
- **Codex：**先安装并登录 [Codex CLI](https://developers.openai.com/codex/cli)，再重新执行上方的 OpenSider 安装提示词。OpenSider 会检测 `codex` 并配置所需的 ACP 适配器。

### 已经安装了 Agent CLI，为什么侧边栏里仍然无法选择？

仅安装 CLI 并不代表已经具备 ACP 接入：它可能缺少 ACP 入口或适配器、安装路径不在本地桥接程序可见的 PATH 中，或安装状态不完整。请把下面的提示词发给你正在使用的本地 Agent：

```
帮我排查并修复：本机已经安装的 Agent CLI 没有出现在 OpenSider 侧边栏中。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其中的体检与修复流程检查该 CLI 的 ACP 接入方式、启动命令、PATH 和所需适配器，完成可修复项后验证它已出现在侧边栏；如果它没有 ACP 接口或可用适配器，请明确说明。
```
