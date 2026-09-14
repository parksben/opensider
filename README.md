<div align="center">
  <br />
  <img alt="OpenSider" src="./docs/banner.svg" />
  <p>
    Give your browser AI wings
  </p>
</div>

<div align="center">
  <a href="./README_ZH.md">中文</a> | English
</div>

<br />

OpenSider is a browser extension that drives local Agents (Claude Code CLI, Copilot CLI, OpenCode CLI, Cursor CLI, and other local Agent tools) from within your browser for web information gathering, web automation, and more.

- **Collaborate with Agents in the browser**  
  Chat with your local Agent directly in the browser side panel, without opening command line or terminal tools.

- **Automatic web page context**  
  No need to tell the Agent which page you are viewing — the Agent automatically gets the page information loaded in your browser and can operate on it.

- **Data persistence**  
  All session data is stored locally, so it won't be lost when the app is updated or reinstalled.

## Video Demo

What it shows: chat with the Agent to distill web page information into a news digest (an HTML file), which is then opened in the browser.

https://github.com/user-attachments/assets/f0a9c654-b66e-43ef-a233-6942a30e83c6

## Install & Use

### 1. Install

> This extension is for Chromium-based browsers such as Chrome / Edge / Brave. Before installing, make sure you already have a running Agent CLI program on your machine.

One-step install: paste the prompt below into the local AI Agent you already use (Claude Code, Codex, OpenCode, Cursor, …). It will prepare your local environment and walk you through installing the browser extension.

```
Install OpenSider for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow it exactly.
Ask me which browser I use before you start, walk me through every step that needs me, and verify each stage yourself.
```

### 2. Update

One-step update: when the side panel tells you a new version is available, copy the prompt below to your local Agent and let it guide you through the update.

```
Update OpenSider (the browser extension and the local bridge) for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its update flow: compare what is installed here with the latest release, refresh whichever half is behind, then walk me through reloading the extension and verify it.
```

### 3. Uninstall

One-step uninstall: one prompt is all it takes, and you choose whether to keep or remove your local data.

```
Uninstall OpenSider (the browser extension and the local bridge) for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its removal flow: ask me whether to delete my local data (session history, workspace, outputs) as well, then remove the bridge and walk me through removing the extension from the browser.
```

## Workspace & Local Data

OpenSider never uploads your configuration or chats to any server: all sessions and Agent artifacts live on this machine under `~/.opensider`, and they stay usable after uninstalling or reinstalling the extension.

| File / folder | What it holds |
|---|---|
| `~/.opensider/workspace/` | The Agent's working directory: every tab and every session works in this same folder |
| `~/.opensider/workspace/browser/` | Scratch files produced during a session, such as the current page snapshot, interactive controls, page commands and results, screenshots |
| `~/.opensider/workspace/outputs/` | Artifacts the Agent produces during a session (tables, documents, code, …) |
| `~/.opensider/ui-state.json` | Session list, chat history and preferences |
| `~/.opensider/runtime/` | The local bridge binary, plus the Claude Code / Codex ACP adapters |
| `~/.opensider/host.log` | Bridge log — the Agent can use it to debug problems |
| `~/Downloads/OpenSider/` | The extension folder the browser actually loads (you can pick a different path during install) — **do not move or delete it**, or the extension breaks |

On Windows these live under `%USERPROFILE%\.opensider` and `%USERPROFILE%\Downloads\OpenSider`.
