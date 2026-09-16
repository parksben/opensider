<div align="center">
  <br />
  <img alt="OpenSider" src="./docs/banner.svg" />
  <p>
    Give your browser AI wings
  </p>
  <p>
    <a href="https://github.com/parksben/opensider/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/parksben/opensider?label=RELEASE" /></a>
    <a href="./LICENSE"><img alt="License" src="https://img.shields.io/github/license/parksben/opensider?label=LICENSE" /></a>
  </p>
</div>

<div align="center">
  <a href="./README_ZH.md">中文</a> | English
</div>

<br />

OpenSider is a browser extension that drives local Agents (Claude Code, Codex, OpenCode, Cursor and other local Agent CLIs that speak ACP) from within your browser for web information gathering, web automation, and more.

- **Collaborate with Agents in the browser**  
  Chat with your local Agent directly in the browser side panel, without opening command line or terminal tools.

- **Reuse your real browser state**  
  Your identity on a site (login state) and any form input you have already filled in are reused, so you never have to reconstruct the scene.

- **Automatic web page context**  
  No need to tell the Agent which page you are viewing — the Agent automatically gets the page information loaded in your browser and can operate on it.

- **Web automation**  
  Navigation, reading, clicking, form filling, screenshots and more are injected into the Agent as tools, and the automation plays out live on the page (simulated mouse clicks, keyboard input, …).

- **Collaborate in place**  
  Wherever you are, the Agent works with the information on that page. You can also pick a page element to ask about it.

- **Switch Agents and models freely**  
  Switch Agent/model with one click, and even within the same session you can use different Agents — no terminal tooling to hold you back.

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
Install the OpenSider browser extension for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its install flow.
```

### 2. Update

One-step update: when the side panel tells you a new version is available, copy the prompt below to your local Agent and let it guide you through the update.

```
Update the OpenSider browser extension for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its update flow.
```

### 3. Uninstall

One-step uninstall: one prompt is all it takes, and you choose whether to keep or remove your local data.

```
Uninstall the OpenSider browser extension for me.
Read https://raw.githubusercontent.com/parksben/opensider/main/skills/opensider/SKILL.md and follow its removal flow.
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
| `~/.opensider/host.log` | Bridge log — the Agent can use it to debug problems. Rotated by size and by date, keeping the last few files as `host.log.<timestamp>` |
| The extension folder you picked at install (suggested `~/OpenSider/`) | The folder the browser actually loads — **do not move or delete it**, or the extension breaks |

On Windows these live under `%USERPROFILE%\.opensider` and `%USERPROFILE%\OpenSider`.
