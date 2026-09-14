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

> 本扩展程序适用于 Chrome / Edge / Brave 等 Chromium 内核的浏览器。安装前请确保本机已有正在运行的 Agent CLI 程序。

安装只需一步：把下面这段提示词复制给你正在使用的本地 AI Agent（Claude Code、Codex、OpenCode、Cursor 等），它会完成与本地环境准备并引导你完成浏览器扩展程序的安装。

```
帮我安装 OpenSider 浏览器扩展。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，然后严格按其中的流程执行。
开始前先跟我确认我平时用哪个浏览器；每一步都分步引导我操作，并自己验证结果。
```

## 版本更新

侧栏右侧抽屉的「设置」里会显示当前的 **扩展版本 / 桥接版本 / 最新版本**；落后时那里会多出一个「复制更新提示词」按钮，复制到的就是下面这段（也可以直接复制）：

```
帮我更新 OpenSider（浏览器扩展 + 本机桥接）。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其更新流程执行：对比本机已装版本与最新 release，更新落后的那一半，再引导我在浏览器里重新加载扩展并验证。
```

Agent 会先对比版本 → 替换本机桥接与扩展目录 → 请你在扩展页点一次「重新加载」→ 用日志确认已连上。更新不会动你的会话历史、工作区和产物。

## 卸载

同样只需一段提示词。Agent 会先问你要不要连本地数据一起清掉，再动手：

```
帮我卸载 OpenSider（浏览器扩展 + 本机桥接）。
请先读取 https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md，按其卸载流程执行：先问我要不要连本地数据（会话历史、工作区、产物）一起清掉，再移除本机桥接，并引导我在浏览器里移除扩展。
```

选「保留数据」的话 `~/.opensider` 会留在原处，下次重装还能接着用之前的会话和产物。
