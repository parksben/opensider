import type {
  AttachmentItem,
  BrowserCommand,
  BrowserResult,
  ClipRect,
  CurrentPage,
  ExtToHost,
  HostToExt,
  TabRecord,
  TabsSnapshot,
} from "@shared";
import { HOST_NAME, isActionMethod, isCaptureMethod, isTabMethod, isWindowMethod } from "@shared";
import { captureViewport } from "./screenshot";

let nativePort: chrome.runtime.Port | null = null;
const sidebars = new Set<chrome.runtime.Port>();
let lastStatus: HostToExt = { type: "status", state: "starting" };
let lastPage: HostToExt | undefined;
let lastSession: HostToExt | undefined;
let lastModels: HostToExt | undefined;
let lastAgents: HostToExt | undefined;
let lastProgress: HostToExt | undefined;
let ignoreNextDisconnect = false;

function remember(msg: HostToExt): void {
  if (msg.type === "status") {
    lastStatus = msg;
    if (msg.state === "idle" || msg.state === "connecting") {
      lastSession = undefined;
      lastModels = undefined;
    }
  }
  if (msg.type === "page") lastPage = msg;
  if (msg.type === "session") lastSession = msg;
  if (msg.type === "models") lastModels = msg;
  if (msg.type === "agents") lastAgents = msg;
  if (msg.type === "agent.progress") lastProgress = msg;
}

function replay(port: chrome.runtime.Port): void {
  try {
    port.postMessage(lastStatus);
    if (lastAgents) port.postMessage(lastAgents);
    if (lastProgress && lastStatus.type === "status" && lastStatus.state === "connecting") {
      port.postMessage(lastProgress);
    }
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
    void publishTabs();
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

function toTabRecord(tab: chrome.tabs.Tab): TabRecord | undefined {
  if (tab.id == null || tab.windowId == null) return undefined;
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title ?? "",
    url: tab.url ?? "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    restricted: isRestrictedUrl(tab.url),
  };
}

async function collectTabsSnapshot(): Promise<TabsSnapshot> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  return {
    updatedAt: new Date().toISOString(),
    windows: windows
      .filter((win) => win.id != null)
      .map((win) => ({
        windowId: win.id as number,
        focused: Boolean(win.focused),
        state: win.state,
        tabs: (win.tabs ?? []).map(toTabRecord).filter((tab): tab is TabRecord => tab != null),
      })),
  };
}

let tabsTimer = 0;
function scheduleTabsPublish(): void {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(() => void publishTabs(), 250) as unknown as number;
}

async function publishTabs(): Promise<void> {
  try {
    sendNative({ type: "tabs.update", snapshot: await collectTabsSnapshot() });
  } catch {
    // host may be down
  }
}

function commandTabIds(args?: BrowserCommand["args"]): number[] {
  if (Array.isArray(args?.tabIds) && args.tabIds.length > 0) {
    return args.tabIds.filter((id) => Number.isInteger(id) && id > 0);
  }
  if (args?.tabId != null && Number.isInteger(args.tabId) && args.tabId > 0) return [args.tabId];
  return [];
}

function httpUrl(raw: string | undefined, base?: string): URL | undefined {
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw, base);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

async function runWindowMethod(command: BrowserCommand): Promise<BrowserResult> {
  if (command.method === "listTabs") {
    return { id: command.id, ok: true, method: command.method, data: await collectTabsSnapshot() };
  }

  if (command.method === "switchTab") {
    const tabId = command.args?.tabId;
    if (tabId == null || !Number.isInteger(tabId)) return fail(command, "switchTab requires args.tabId");
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true });
    return {
      id: command.id,
      ok: true,
      method: command.method,
      data: { tabId, windowId: tab.windowId, ...(await collectTabsSnapshot()) },
    };
  }

  if (command.method === "openTab") {
    const parsed = httpUrl(command.args?.url);
    if (!parsed) return fail(command, "openTab requires args.url as http(s)");
    const created = await chrome.tabs.create({
      url: parsed.toString(),
      windowId: command.args?.windowId,
      active: true,
    });
    if (created.id == null) return fail(command, "could not open tab");
    if (created.windowId != null) await chrome.windows.update(created.windowId, { focused: true });
    await waitTabComplete(created.id, Math.min(command.args?.timeoutMs ?? 15_000, 20_000)).catch(() => undefined);
    return {
      id: command.id,
      ok: true,
      method: command.method,
      data: { tabId: created.id, windowId: created.windowId, url: parsed.toString(), ...(await collectTabsSnapshot()) },
    };
  }

  const ids = commandTabIds(command.args);
  if (ids.length === 0) return fail(command, "moveTabsToWindow requires args.tabIds or args.tabId");
  const [first, ...rest] = ids;
  let windowId = command.args?.windowId;
  if (windowId == null) {
    const created = await chrome.windows.create({ tabId: first, focused: true, type: "normal" });
    windowId = created.id;
    if (windowId == null) return fail(command, "could not create window");
  } else {
    await chrome.tabs.move(first, { windowId, index: -1 });
    await chrome.windows.update(windowId, { focused: true });
    await chrome.tabs.update(first, { active: true });
  }
  if (rest.length > 0) await chrome.tabs.move(rest, { windowId, index: -1 });
  return {
    id: command.id,
    ok: true,
    method: command.method,
    data: { tabId: first, windowId, tabIds: ids, ...(await collectTabsSnapshot()) },
  };
}

async function dispatchCommand(command: BrowserCommand): Promise<void> {
  if (isWindowMethod(command.method)) {
    let result: BrowserResult;
    try {
      result = await runWindowMethod(command);
    } catch (error) {
      result = fail(command, String(error));
    }
    sendNative({ type: "browser.result", result });
    broadcast({ type: "browser.result", result });
    if (result.ok) {
      void publishTabs();
      const tabId = (result.data as { tabId?: number } | undefined)?.tabId;
      if (command.method !== "listTabs" && tabId != null) void requestPage(tabId);
    }
    return;
  }

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
    void publishTabs();
  }
}

async function requestPage(tabId: number): Promise<void> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return;
  }
  const favIconUrl = tab.favIconUrl;
  try {
    const page = {
      ...(await chrome.tabs.sendMessage(tabId, {
        type: "page.snapshot",
        tabId,
      })) as CurrentPage,
      favIconUrl,
    };
    sendNative({ type: "page.update", page });
    broadcast({ type: "page", page });
  } catch {
    const page: CurrentPage = {
      tabId,
      url: tab.url ?? "",
      title: tab.title ?? "",
      updatedAt: new Date().toISOString(),
      favIconUrl,
    };
    sendNative({ type: "page.update", page });
    broadcast({ type: "page", page });
  }
}

function isRestrictedUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com/")
  );
}

function isHttpTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.id) && !isRestrictedUrl(tab.url) && (!tab.url || tab.url.startsWith("http://") || tab.url.startsWith("https://"));
}

async function activeHttpTab(): Promise<chrome.tabs.Tab | undefined> {
  const queries: chrome.tabs.QueryInfo[] = [
    { active: true, lastFocusedWindow: true },
    { active: true, currentWindow: true },
    { lastFocusedWindow: true },
  ];
  for (const query of queries) {
    const tab = (await chrome.tabs.query(query)).find(isHttpTab);
    if (tab) return tab;
  }
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const focused = windows.find((window) => window.focused) ?? windows[0];
  return focused?.tabs?.find((tab) => tab.active && isHttpTab(tab));
}

async function injectContent(tabId: number): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (files.length === 0) throw new Error("content script missing from manifest");
  await chrome.scripting.executeScript({ target: { tabId }, files });
}

async function ensureContent(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "page.ping" });
  } catch {
    await injectContent(tabId);
  }
}

let pickTabId: number | undefined;

async function startPagePick(requestId: string, hint?: string): Promise<void> {
  const tab = await activeHttpTab();
  if (!tab?.id) {
    broadcast({
      type: "page.picked",
      requestId,
      items: [],
      error: "restricted",
    });
    return;
  }
  pickTabId = tab.id;
  try {
    await ensureContent(tab.id);
    await chrome.tabs.sendMessage(tab.id, { type: "page.pick", requestId, hint });
  } catch (error) {
    pickTabId = undefined;
    broadcast({
      type: "page.picked",
      requestId,
      items: [],
      error: String(error),
    });
  }
}

async function cancelPagePick(): Promise<void> {
  const tabId = pickTabId ?? (await activeHttpTab())?.id;
  pickTabId = undefined;
  if (!tabId) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: "page.pick.cancel" });
  } catch {
    // tab may not have the content script
  }
}

function pickedItems(selector?: string): AttachmentItem[] {
  if (!selector) return [];
  return [{ path: selector, name: selector, kind: "element" }];
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidebar") return;
  sidebars.add(port);
  replay(port);
  connectNative();
  port.onMessage.addListener((msg: ExtToHost) => {
    if (msg.type === "page.pick") {
      void startPagePick(msg.requestId, msg.hint);
      return;
    }
    if (msg.type === "page.pick.cancel") {
      void cancelPagePick();
      return;
    }
    sendNative(msg);
  });
  port.onDisconnect.addListener(() => sidebars.delete(port));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "page.picked") {
    pickTabId = undefined;
    broadcast({
      type: "page.picked",
      requestId: String(msg.requestId ?? ""),
      items: pickedItems(typeof msg.selector === "string" ? msg.selector : undefined),
      cancelled: Boolean(msg.cancelled),
      error: typeof msg.error === "string" ? msg.error : undefined,
    });
    sendResponse({ ok: true });
    return true;
  }
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
  scheduleTabsPublish();
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.status === "complete" || change.favIconUrl)) {
    void requestPage(tabId);
  }
  if (change.status || change.title || change.url || change.favIconUrl || change.pinned) {
    scheduleTabsPublish();
  }
});

chrome.tabs.onCreated.addListener(scheduleTabsPublish);
chrome.tabs.onRemoved.addListener(scheduleTabsPublish);
chrome.tabs.onMoved.addListener(scheduleTabsPublish);
chrome.tabs.onAttached.addListener(scheduleTabsPublish);
chrome.tabs.onDetached.addListener(scheduleTabsPublish);
chrome.windows.onCreated.addListener(scheduleTabsPublish);
chrome.windows.onRemoved.addListener(scheduleTabsPublish);
chrome.windows.onFocusChanged.addListener(scheduleTabsPublish);
