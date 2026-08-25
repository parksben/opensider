import type { BrowserCommand, BrowserResult, CurrentPage, ExtToHost, HostToExt } from "@shared";
import { HOST_NAME } from "@shared";

let nativePort: chrome.runtime.Port | null = null;
const sidebars = new Set<chrome.runtime.Port>();

function broadcast(msg: HostToExt): void {
  for (const port of sidebars) {
    try {
      port.postMessage(msg);
    } catch {
      sidebars.delete(port);
    }
  }
}

function connectNative(): void {
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    broadcast({
      type: "status",
      state: "error",
      error: `Native host is not installed. ${String(error)}`,
    });
    return;
  }

  nativePort.onMessage.addListener((msg: HostToExt) => {
    if (msg.type === "browser.command") {
      void dispatchCommand(msg.command);
    }
    broadcast(msg);
  });

  nativePort.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message ?? "Native host disconnected.";
    nativePort = null;
    broadcast({ type: "status", state: "error", error });
  });

  nativePort.postMessage({ type: "hello" } satisfies ExtToHost);
}

function sendNative(msg: ExtToHost): void {
  connectNative();
  nativePort?.postMessage(msg);
}

async function dispatchCommand(command: BrowserCommand): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    sendNative({
      type: "browser.result",
      result: { id: command.id, ok: false, method: command.method, error: "No active tab" },
    });
    return;
  }
  try {
    const result = (await chrome.tabs.sendMessage(tab.id, {
      type: "browser.command",
      command,
    })) as BrowserResult;
    sendNative({ type: "browser.result", result });
  } catch (error) {
    sendNative({
      type: "browser.result",
      result: {
        id: command.id,
        ok: false,
        method: command.method,
        error: String(error),
      },
    });
  }
}

async function requestPage(tabId: number): Promise<void> {
  try {
    const page = (await chrome.tabs.sendMessage(tabId, {
      type: "page.snapshot",
      tabId,
    })) as CurrentPage;
    sendNative({ type: "page.update", page });
    broadcast({ type: "page", page });
  } catch {
    const tab = await chrome.tabs.get(tabId);
    const page: CurrentPage = {
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
      updatedAt: new Date().toISOString(),
    };
    sendNative({ type: "page.update", page });
    broadcast({ type: "page", page });
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidebar") return;
  sidebars.add(port);
  connectNative();
  port.onMessage.addListener((msg: ExtToHost) => sendNative(msg));
  port.onDisconnect.addListener(() => sidebars.delete(port));
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.tabs.onActivated.addListener((info) => {
  void requestPage(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.active) {
    void requestPage(tabId);
  }
});
