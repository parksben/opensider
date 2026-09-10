<div align="center">
  <br />
  <img alt="OpenSider" src="./docs/banner.svg" />
  <p>
    The browser automation tool you've been waiting for
  </p>
</div>

<br />

<div align="center">
  <a href="./README.md">中文</a> | English
</div>

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

> This extension is for Chromium-based browsers such as Chrome / Edge / Brave. Before installing, make sure you already have a running Agent CLI program on your machine.

Installation takes only four steps:

1. Download `extension.zip` from the [download page](https://github.com/parksben/opensider/releases/latest) and unzip it to any directory on your machine.
2. Open the browser's extensions page (Chrome: `chrome://extensions`, Edge: `edge://extensions`), turn on **Developer mode** in the top-right corner, click "Load unpacked" on the left, and select the folder you just unzipped in the file dialog.
3. Click the OpenSider icon in the browser's top-right toolbar, and the OpenSider UI opens in the browser side panel.
4. On first use, follow the prompts in the UI and run the command shown there in a terminal or command line (Terminal/PowerShell) to connect your local Agent CLI to the browser. Once connected, you can start chatting with your local Agent in the UI.
