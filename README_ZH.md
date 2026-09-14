<div align="center">
  <br />
  <img alt="OpenSider" src="./docs/banner.svg" />
  <p>
    为你的浏览器插上AI的翅膀
  </p>
</div>

<div align="center">
  中文 | <a href="./README.md">English</a>
</div>

<br />

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

### 1. 安装

> 本扩展程序适用于 Chrome / Edge / Brave 等 Chromium 内核的浏览器。安装前请确保本机已有正在运行的 Agent CLI 程序。

一键安装：把下面这段提示词复制给你正在使用的本地 AI Agent（Claude Code、Codex、OpenCode、Cursor 等），它会完成与本地环境准备并引导你完成浏览器扩展程序的安装。

```
帮我安装 OpenSider 浏览器扩展。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，然后严格按其中的流程执行。
开始前先跟我确认我平时用哪个浏览器；每一步都分步引导我操作，并自己验证结果。
```

### 2. 更新

一键更新：当扩展程序界面中出现新版本提示时，可复制以下提示词给你的本地 Agent，在其引导下完成新版本的安装。

```
帮我更新 OpenSider（浏览器扩展 + 本机桥接）。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其更新流程执行：对比本机已装版本与最新 release，更新落后的那一半，再引导我在浏览器里重新加载扩展并验证。
```

### 3. 卸载

一键卸载：同样只需一段提示词，卸载时可选择保留或移除本地已有数据。

```
帮我卸载 OpenSider（浏览器扩展 + 本机桥接）。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其卸载流程执行：先问我要不要连本地数据（会话历史、工作区、产物）一起清掉，再移除本机桥接，并引导我在浏览器里移除扩展。
```

## 工作区与本地数据

OpenSider 不把聊天内容传到云端：会话、页面快照和产物全部留在本机 `~/.opensider`，卸载或重装扩展后仍能接着用（侧栏状态的权威副本就是其中的 `ui-state.json`）。

| 路径 | 里面是什么 |
|---|---|
| `~/.opensider/workspace/` | Agent 的工作目录：所有标签页、所有会话共用同一个，可以跨页面连续做事 |
| `~/.opensider/workspace/browser/` | 当前页快照、交互控件列表、页面命令与结果、截图。中间文件，可随时清理 |
| `~/.opensider/workspace/outputs/` | Agent 给你写出来的产物（榜单、报告、图片等）；侧栏「产物」里可以一键打开所在位置 |
| `~/.opensider/ui-state.json` | 会话列表、聊天记录与偏好设置 |
| `~/.opensider/runtime/` | 本机桥接二进制，以及 Claude Code / Codex 用的 ACP 适配器 |
| `~/.opensider/host.log` | 桥接日志，连不上时先看它 |
| `~/Downloads/OpenSider/` | 浏览器实际加载的扩展目录，**不要移动或删除**，否则扩展会失效 |

Windows 上对应 `%USERPROFILE%\.opensider` 与 `%USERPROFILE%\Downloads\OpenSider`。

想彻底清空：用上面「卸载」的提示词并选择清空数据；只想清中间文件：删 `workspace/browser/`，聊天记录与产物不受影响。