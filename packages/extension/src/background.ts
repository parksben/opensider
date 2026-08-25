import type { BrowserCommand, BrowserResult, ClipRect, CurrentPage, ExtToHost, HostToExt } from "@shared";
import { HOST_NAME, isActionMethod, isCaptureMethod, isTabMethod } from "@shared";
import { captureViewport } from "./screenshot";

let nativePort: chrome.runtime.Port | null = null;
const sidebars = new Set<chrome.runtime.Port>();
let lastStatus: HostToExt = { type: "status", state: "starting" };
let lastPage: HostToExt | undefined;
let lastSession: HostToExt | undefined;
let lastModels: HostToExt | undefined;
let ignoreNextDisconnect = false;

function remember(msg: HostToExt): void {
  if (msg.type === "status") lastStatus = msg;
  if (msg.type === "page") lastPage = msg;
  if (msg.type === "session") lastSession = msg;
  if (msg.type === "models") lastModels = msg;
}

function replay(port: chrome.runtime.Port): void {
  try {
    port.postMessage(lastStatus);
    if (lastSession) port.postMessage(lastSession);
    if (lastPage) port.postMessage(lastPage);
    if (lastModels) port.postMessage(lastModels);
  } catch {
    sidebars.delete(port);
  }
}

function broadcast(msg: HostToExt): void {
  remember(msg);
  for (const port of sidebars) {
    try {
      port.postMessage(msg);
    } catch {
      sidebars.delete(port);
    }
  }
}

function nativeError(detail: string): string {
  return `${detail} Extension id: ${chrome.runtime.id}. Host: ${HOST_NAME}.`;
}

function connectNative(force = false): void {
  if (nativePort && force) {
    ignoreNextDisconnect = true;
    try {
      nativePort.disconnect();
    } catch {
      ignoreNextDisconnect = false;
    }
    nativePort = null;
  }
  if (nativePort) return;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    nativePort = null;
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`Native host is not installed. ${String(error)}`),
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
    nativePort = null;
    if (ignoreNextDisconnect) {
      ignoreNextDisconnect = false;
      return;
    }
    const error =
      chrome.runtime.lastError?.message ??
      "Native host disconnected. Run `pnpm install-host`, then reload this extension.";
    broadcast({ type: "status", state: "error", error: nativeError(error) });
  });

  try {
    nativePort.postMessage({ type: "hello" } satisfies ExtToHost);
  } catch (error) {
    nativePort = null;
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`Could not talk to the native host. ${String(error)}`),
    });
  }
}

function sendNative(msg: ExtToHost): void {
  connectNative();
  if (!nativePort) {
    broadcast({
      type: "status",
      state: "error",
      error: "Native host is not connected. Retry the connection or run `pnpm install-host`.",
    });
    if (msg.type === "prompt") broadcast({ type: "turn.end", stopReason: "error" });
    return;
  }
  try {
    nativePort.postMessage(msg);
  } catch (error) {
    broadcast({ type: "status", state: "error", error: String(error) });
    if (msg.type === "prompt") broadcast({ type: "turn.end", stopReason: "error" });
  }
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

async function runCapture(tab: { id?: number; windowId?: number }, command: BrowserCommand): Promise<BrowserResult> {
  if (tab.id == null || tab.windowId == null) return fail(command, "tab is not capturable");
  let clip: ClipRect | undefined;
  if (command.method === "screenshotElement") {
    const measured = (await chrome.tabs.sendMessage(tab.id, {
      type: "page.measure",
      args: command.args ?? {},
    })) as { ok: boolean; rect?: ClipRect; error?: string };
    if (!measured?.ok || !measured.rect) return fail(command, measured?.error ?? "measure failed");
    clip = measured.rect;
    await new Promise((resolve) => setTimeout(resolve, 120));
  } else if (
    command.args &&
    [command.args.x, command.args.y, command.args.width, command.args.height].some((value) => value != null)
  ) {
    const view = (await chrome.tabs.sendMessage(tab.id, { type: "page.viewport" })) as {
      ok: boolean;
      rect?: ClipRect;
      error?: string;
    };
    if (!view?.ok || !view.rect) return fail(command, view?.error ?? "viewport measure failed");
    clip = {
      x: command.args.x ?? 0,
      y: command.args.y ?? 0,
      width: command.args.width ?? view.rect.viewportWidth,
      height: command.args.height ?? view.rect.viewportHeight,
      dpr: view.rect.dpr,
      viewportWidth: view.rect.viewportWidth,
      viewportHeight: view.rect.viewportHeight,
    };
  }
  const payload = await captureViewport(tab.windowId, clip);
  return { id: command.id, ok: true, method: command.method, data: payload };
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
    result = isCaptureMethod(command.method)
      ? await runCapture(tab, command)
      : isTabMethod(command.method)
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
  replay(port);
  connectNative();
  port.onMessage.addListener((msg: ExtToHost) => sendNative(msg));
  port.onDisconnect.addListener(() => sidebars.delete(port));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "ping") {
    connectNative();
    sendResponse({ ok: true, status: lastStatus });
    return true;
  }
  if (msg?.type === "reconnect") {
    lastStatus = { type: "status", state: "starting" };
    lastSession = undefined;
    broadcast(lastStatus);
    connectNative(true);
    sendResponse({ ok: true, status: lastStatus });
    return true;
  }
  return false;
});

void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
connectNative();

chrome.tabs.onActivated.addListener((info) => {
  void requestPage(info.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.active) {
    void requestPage(tabId);
  }
});
