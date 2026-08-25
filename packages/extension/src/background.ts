import type { BrowserCommand, BrowserResult, CurrentPage, ExtToHost, HostToExt } from "@shared";
import { HOST_NAME, isActionMethod, isTabMethod } from "@shared";

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

function fail(command: BrowserCommand, error: string): BrowserResult {
  return { id: command.id, ok: false, method: command.method, error };
}

async function waitTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("navigation timed out"));
    }, timeoutMs);
    const onUpdated = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function runTabMethod(tabId: number, command: BrowserCommand): Promise<BrowserResult> {
  const timeout = Math.min(command.args?.timeoutMs ?? 15_000, 20_000);
  if (command.method === "navigate") {
    const url = command.args?.url;
    if (!url) return fail(command, "navigate requires args.url");
    let parsed: URL;
    try {
      parsed = new URL(url, (await chrome.tabs.get(tabId)).url);
    } catch {
      return fail(command, "invalid url");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return fail(command, "only http(s) navigation is allowed");
    }
    await chrome.tabs.update(tabId, { url: parsed.toString() });
    await waitTabComplete(tabId, timeout);
    return { id: command.id, ok: true, method: command.method, data: { url: parsed.toString() } };
  }
  if (command.method === "goBack") {
    await chrome.tabs.goBack(tabId);
    await waitTabComplete(tabId, timeout).catch(() => undefined);
    return { id: command.id, ok: true, method: command.method, data: { action: "back" } };
  }
  if (command.method === "goForward") {
    await chrome.tabs.goForward(tabId);
    await waitTabComplete(tabId, timeout).catch(() => undefined);
    return { id: command.id, ok: true, method: command.method, data: { action: "forward" } };
  }
  await chrome.tabs.reload(tabId);
  await waitTabComplete(tabId, timeout).catch(() => undefined);
  return { id: command.id, ok: true, method: command.method, data: { action: "reload" } };
}

async function dispatchCommand(command: BrowserCommand): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    const result = fail(command, "No active tab");
    sendNative({ type: "browser.result", result });
    broadcast({ type: "browser.result", result });
    return;
  }

  let result: BrowserResult;
  try {
    result = isTabMethod(command.method)
      ? await runTabMethod(tab.id, command)
      : await Promise.race([
          chrome.tabs.sendMessage(tab.id, { type: "browser.command", command }) as Promise<BrowserResult>,
          new Promise<BrowserResult>((resolve) => {
            setTimeout(
              () => resolve(fail(command, "page command timed out")),
              Math.min(command.args?.timeoutMs ?? 20_000, 20_000),
            );
          }),
        ]);
  } catch (error) {
    result = fail(command, String(error));
  }

  sendNative({ type: "browser.result", result });
  broadcast({ type: "browser.result", result });
  if (result.ok && isActionMethod(command.method)) {
    void requestPage(tab.id);
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
