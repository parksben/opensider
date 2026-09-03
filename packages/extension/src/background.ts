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
import { HOST_NAME, isActionMethod, isCaptureMethod, isScriptMethod, isTabMethod, isWindowMethod } from "@shared";
import {
  isPickablePageUrl,
  isRestrictedUrl,
  PAGE_PICK_API,
  pageCommandError,
  pageToolsAllowed,
  pickFailureCode,
  type PageApiMethod,
} from "./page-pick";
import { captureViewport } from "./screenshot";
import {
  isClosedCurrentTab,
  resolveActiveTab,
  shouldClearCurrentPage,
} from "./tab-sync";

let nativePort: chrome.runtime.Port | null = null;
const sidebars = new Set<chrome.runtime.Port>();
let lastStatus: HostToExt = { type: "status", state: "starting" };
let lastPage: HostToExt | undefined;
let lastSession: HostToExt | undefined;
let lastModels: HostToExt | undefined;
let lastAgents: HostToExt | undefined;
let lastProgress: HostToExt | undefined;
let lastUiState: HostToExt | undefined;
let ignoreNextDisconnect = false;
let missingRetryTimer = 0;
let startingWatchdog = 0;
const STARTING_TIMEOUT_MS = 10_000;

const INSTALL_HINT = "Run the install script shown in the side panel.";

function isHostMissingError(message: string): boolean {
  const text = message.toLowerCase();
  return (
    text.includes("specified native messaging host not found") ||
    text.includes("native messaging host not found") ||
    text.includes("host not found") ||
    text.includes("not installed") ||
    text.includes("no such native application") ||
    text.includes("failed to find native")
  );
}

function clearMissingRetry(): void {
  if (!missingRetryTimer) return;
  clearTimeout(missingRetryTimer);
  missingRetryTimer = 0;
}

function clearStartingWatchdog(): void {
  if (!startingWatchdog) return;
  clearTimeout(startingWatchdog);
  startingWatchdog = 0;
}

function armStartingWatchdog(): void {
  clearStartingWatchdog();
  startingWatchdog = setTimeout(() => {
    startingWatchdog = 0;
    if (lastStatus.type !== "status" || lastStatus.state !== "starting") return;
    if (lastAgents && lastAgents.type === "agents" && lastAgents.agents.length > 0) {
      broadcast(lastAgents);
      broadcast({ type: "status", state: "idle" });
      return;
    }
    broadcast({
      type: "status",
      state: "error",
      error: nativeError("Native host is still starting. Check ~/.opensider/host.log."),
    });
  }, STARTING_TIMEOUT_MS) as unknown as number;
}

function scheduleMissingRetry(): void {
  if (missingRetryTimer || nativePort) return;
  missingRetryTimer = setTimeout(() => {
    missingRetryTimer = 0;
    if (!nativePort) connectNative();
  }, 1500) as unknown as number;
}

function reportMissing(detail: string): void {
  broadcast({
    type: "status",
    state: "missing",
    error: nativeError(`${detail} ${INSTALL_HINT}`),
  });
  scheduleMissingRetry();
}

function remember(msg: HostToExt): void {
  if (msg.type === "agents") {
    lastAgents = msg;
    if (Array.isArray(msg.agents) && msg.agents.length > 0 && lastStatus.type === "status" && lastStatus.state === "starting") {
      clearStartingWatchdog();
    }
  }
  if (msg.type === "status") {
    lastStatus = msg;
    if (msg.state === "starting") {
      armStartingWatchdog();
    } else {
      clearStartingWatchdog();
    }
    if (msg.state === "idle" || msg.state === "connecting" || msg.state === "missing") {
      lastSession = undefined;
      lastModels = undefined;
    }
    if (msg.state !== "connecting") {
      lastProgress = undefined;
    }
    if (msg.state === "missing") {
      lastAgents = undefined;
      lastProgress = undefined;
    }
  }
  if (msg.type === "page") lastPage = msg;
  if (msg.type === "session") lastSession = msg;
  if (msg.type === "models") {
    const empty = !Array.isArray(msg.models) || msg.models.length === 0;
    if (empty && lastStatus.type === "status" && lastStatus.state !== "ready") {
      return;
    }
    lastModels = msg;
  }
  if (msg.type === "agent.progress") lastProgress = msg;
  if (msg.type === "ui.state") lastUiState = msg;
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
    if (lastUiState) port.postMessage(lastUiState);
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
    const detail = String(error);
    if (isHostMissingError(detail)) {
      reportMissing(`Native host is not installed. ${detail}`);
      return;
    }
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`Native host is not installed. ${detail}`),
    });
    return;
  }

  nativePort.onMessage.addListener((msg: HostToExt) => {
    clearMissingRetry();
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
    clearStartingWatchdog();
    const error = chrome.runtime.lastError?.message ?? "Native host disconnected.";
    if (isHostMissingError(error)) {
      reportMissing(error);
      return;
    }
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`${error} ${INSTALL_HINT}`),
    });
  });

  try {
    nativePort.postMessage({ type: "hello" } satisfies ExtToHost);
    clearMissingRetry();
    if (lastStatus.type === "status" && lastStatus.state === "starting") {
      armStartingWatchdog();
    }
    void publishTabs();
    void syncCurrentPage();
  } catch (error) {
    nativePort = null;
    const detail = String(error);
    const last = chrome.runtime.lastError?.message ?? detail;
    if (isHostMissingError(last) || isHostMissingError(detail)) {
      reportMissing(last);
      return;
    }
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`Could not talk to the native host. ${detail}`),
    });
  }
}

function sendNative(msg: ExtToHost): void {
  connectNative();
  if (!nativePort) {
    const missing = lastStatus.type === "status" && lastStatus.state === "missing";
    if (missing) {
      reportMissing("Native host is not connected.");
    } else {
      broadcast({
        type: "status",
        state: "error",
        error: nativeError(`Native host is not connected. ${INSTALL_HINT}`),
      });
    }
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

function fail(command: BrowserCommand, error: string, data?: unknown): BrowserResult {
  return { id: command.id, ok: false, method: command.method, error, data };
}

type UnsavedProbe = {
  dirty: boolean;
  reasons: string[];
  fields?: Array<{ label?: string; name?: string; reason: string }>;
  beforeunload?: boolean;
};

async function probeUnsaved(tabId: number): Promise<UnsavedProbe | null> {
  try {
    const result = await runContentMethod(tabId, {
      id: `unsaved_${tabId}`,
      method: "getUnsavedChanges",
      args: {},
    });
    if (!result?.ok || !result.data || typeof result.data !== "object") return null;
    return result.data as UnsavedProbe;
  } catch {
    return null;
  }
}

function unsavedBlockMessage(probe: UnsavedProbe): string {
  const sample = (probe.fields ?? [])
    .slice(0, 5)
    .map((field) => field.label || field.name || field.reason)
    .filter(Boolean)
    .join("; ");
  const reason = probe.reasons.join(", ") || "unsaved edits";
  const detail = sample ? ` Examples: ${sample}.` : "";
  return (
    `Page has unsaved edits (${reason}).${detail} ` +
    `If you only need another page for information, call openTab instead. ` +
    `If the user explicitly asked to leave or close this page, confirm with cursor/ask_question first, then retry with args.force=true.`
  );
}

async function guardUnsaved(
  command: BrowserCommand,
  tabId: number,
): Promise<BrowserResult | undefined> {
  if (command.args?.force === true) return undefined;
  const probe = await probeUnsaved(tabId);
  if (!probe?.dirty) return undefined;
  return fail(command, unsavedBlockMessage(probe), probe);
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
  const blocked = await guardUnsaved(command, tabId);
  if (blocked) return blocked;
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

const RUN_SCRIPT_MAX_CODE = 80_000;

async function runScriptMethod(tabId: number, command: BrowserCommand): Promise<BrowserResult> {
  const code = command.args?.code;
  if (typeof code !== "string" || !code.trim()) return fail(command, "runScript requires args.code (async function body)");
  if (code.length > RUN_SCRIPT_MAX_CODE) return fail(command, `runScript code exceeds ${RUN_SCRIPT_MAX_CODE} characters`);
  const tab = await chrome.tabs.get(tabId);
  if (isRestrictedUrl(tab.url)) return fail(command, "runScript is not allowed on restricted pages");
  if (!tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    return fail(command, "runScript only works on http(s) pages");
  }
  const world = command.args?.world === "MAIN" ? "MAIN" : "ISOLATED";
  const timeout = Math.min(Math.max(command.args?.timeoutMs ?? 10_000, 200), 20_000);

  try {
    const injection = chrome.scripting.executeScript({
      target: { tabId },
      world,
      args: [code],
      func: async (source: string) => {
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
          ...args: string[]
        ) => (...fnArgs: unknown[]) => Promise<unknown>;
        try {
          const value = await new AsyncFunction(source)();
          let serialized: unknown;
          try {
            serialized = JSON.parse(JSON.stringify(value === undefined ? null : value));
          } catch {
            serialized = String(value);
          }
          return { ok: true as const, value: serialized };
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    const results = await Promise.race([
      injection,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`runScript timed out after ${timeout}ms`)), timeout);
      }),
    ]);
    const entry = results[0]?.result as { ok: boolean; value?: unknown; error?: string } | undefined;
    if (!entry) return fail(command, "runScript produced no result");
    if (!entry.ok) return fail(command, entry.error ?? "runScript failed", { world, error: entry.error });
    return { id: command.id, ok: true, method: command.method, data: { world, value: entry.value } };
  } catch (error) {
    return fail(command, String(error));
  }
}

async function runCapture(tab: { id?: number; windowId?: number }, command: BrowserCommand): Promise<BrowserResult> {
  if (tab.id == null || tab.windowId == null) return fail(command, "tab is not capturable");
  try {
    await ensureContent(tab.id);
  } catch (error) {
    return fail(command, pageCommandError(error));
  }
  let clip: ClipRect | undefined;
  if (command.method === "screenshotElement") {
    const measured = await callPageApi<ClipRect>(tab.id, "measure", [command.args ?? {}]);
    if (!measured.ok || !measured.value) return fail(command, measured.error ?? "measure failed");
    clip = measured.value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  } else if (
    command.args &&
    [command.args.x, command.args.y, command.args.width, command.args.height].some((value) => value != null)
  ) {
    const view = await callPageApi<ClipRect>(tab.id, "viewport");
    if (!view.ok || !view.value) return fail(command, view.error ?? "viewport measure failed");
    clip = {
      x: command.args.x ?? 0,
      y: command.args.y ?? 0,
      width: command.args.width ?? view.value.viewportWidth,
      height: command.args.height ?? view.value.viewportHeight,
      dpr: view.value.dpr,
      viewportWidth: view.value.viewportWidth,
      viewportHeight: view.value.viewportHeight,
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
let pageSyncTimer = 0;
let pageSyncGen = 0;
let currentTabId: number | undefined;

function scheduleTabsPublish(): void {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(() => void publishTabs(), 250) as unknown as number;
}

function rememberCurrentTab(tabId: number | undefined): void {
  currentTabId = tabId;
}

function lastKnownTabId(): number | undefined {
  if (lastPage?.type === "page" && lastPage.page.tabId > 0) return lastPage.page.tabId;
  return currentTabId;
}

function publishClearedPage(): void {
  rememberCurrentTab(undefined);
  const page: CurrentPage = {
    tabId: 0,
    url: "",
    title: "",
    updatedAt: new Date().toISOString(),
  };
  sendNative({ type: "page.update", page });
  broadcast({ type: "page", page });
}

async function resolveFocusedActiveChromeTab(
  preferredWindowId?: number,
): Promise<chrome.tabs.Tab | undefined> {
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  const picked = resolveActiveTab(windows, preferredWindowId);
  if (!picked?.id) return undefined;
  try {
    return await chrome.tabs.get(picked.id);
  } catch {
    return undefined;
  }
}

async function syncCurrentPage(preferredWindowId?: number): Promise<void> {
  const gen = ++pageSyncGen;
  const tab = await resolveFocusedActiveChromeTab(preferredWindowId);
  if (gen !== pageSyncGen) return;
  if (!tab?.id) {
    if (shouldClearCurrentPage(lastKnownTabId(), [])) publishClearedPage();
    return;
  }
  await requestPage(tab.id, gen);
}

function scheduleCurrentPageSync(preferredWindowId?: number): void {
  clearTimeout(pageSyncTimer);
  pageSyncTimer = setTimeout(() => void syncCurrentPage(preferredWindowId), 250) as unknown as number;
}

function onActiveTabMaybeChanged(preferredWindowId?: number): void {
  void syncCurrentPage(preferredWindowId);
  scheduleCurrentPageSync(preferredWindowId);
  scheduleTabsPublish();
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

  if (command.method === "closeTab") {
    let tabId = command.args?.tabId;
    if (tabId == null) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = active?.id;
    }
    if (tabId == null || !Number.isInteger(tabId)) return fail(command, "closeTab requires args.tabId or an active tab");
    const blocked = await guardUnsaved(command, tabId);
    if (blocked) return blocked;
    await chrome.tabs.remove(tabId);
    return {
      id: command.id,
      ok: true,
      method: command.method,
      data: { tabId, ...(await collectTabsSnapshot()) },
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

  const tab = await resolveFocusedActiveChromeTab();
  if (!tab?.id) {
    const result = fail(command, "No active tab");
    sendNative({ type: "browser.result", result });
    broadcast({ type: "browser.result", result });
    return;
  }

  const allowed = pageToolsAllowed(tab.url);
  if (!allowed.ok && !isTabMethod(command.method)) {
    const result = fail(command, allowed.error);
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
        : isScriptMethod(command.method)
          ? await runScriptMethod(tab.id, command)
          : await runContentMethod(tab.id, command);
  } catch (error) {
    result = fail(command, pageCommandError(error));
  }

  sendNative({ type: "browser.result", result });
  broadcast({ type: "browser.result", result });
  if (result.ok && (isActionMethod(command.method) || command.method === "getInteractive" || command.method === "waitFor")) {
    void requestPage(tab.id);
    void publishTabs();
  }
}

async function requestPage(tabId: number, writeGen?: number): Promise<void> {
  const gen = writeGen ?? ++pageSyncGen;
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    if (gen !== pageSyncGen) return;
    const replacement = await resolveFocusedActiveChromeTab();
    if (gen !== pageSyncGen) return;
    if (replacement?.id && replacement.id !== tabId) {
      await requestPage(replacement.id, gen);
      return;
    }
    if (shouldClearCurrentPage(lastKnownTabId() ?? tabId, replacement?.id ? [replacement.id] : [])) {
      publishClearedPage();
    }
    return;
  }
  const favIconUrl = tab.favIconUrl;
  const fallback = (): CurrentPage => ({
    tabId,
    url: tab.url ?? "",
    title: tab.title ?? "",
    updatedAt: new Date().toISOString(),
    favIconUrl,
  });
  try {
    if (pageToolsAllowed(tab.url).ok) {
      await ensureContent(tabId);
      const snap = await callPageApi<CurrentPage>(tabId, "snapshot", [tabId]);
      if (!snap.ok || !snap.value) throw new Error(snap.error ?? "snapshot failed");
      const page = { ...snap.value, favIconUrl };
      if (gen !== pageSyncGen) return;
      rememberCurrentTab(tabId);
      sendNative({ type: "page.update", page });
      broadcast({ type: "page", page });
      return;
    }
  } catch {
    // restricted, still loading, or inject failed — still publish identity
  }
  if (gen !== pageSyncGen) return;
  rememberCurrentTab(tabId);
  const page = fallback();
  sendNative({ type: "page.update", page });
  broadcast({ type: "page", page });
}

function isHttpTab(tab: chrome.tabs.Tab): boolean {
  return Boolean(tab.id) && (tab.url ? isPickablePageUrl(tab.url) : !isRestrictedUrl(tab.url));
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
  const fromWindow = focused?.tabs?.find((tab) => tab.active && isHttpTab(tab));
  if (fromWindow) return fromWindow;
  const remembered = lastKnownTabId();
  if (!remembered) return undefined;
  try {
    const tab = await chrome.tabs.get(remembered);
    if (tab.active && isHttpTab(tab)) return tab;
  } catch {
    // tab is gone
  }
  return undefined;
}

async function injectContent(tabId: number, allFrames: boolean): Promise<void> {
  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (files.length === 0) throw new Error("content script missing from manifest");
  await chrome.scripting.executeScript({
    target: { tabId, allFrames },
    files,
    injectImmediately: true,
    world: "ISOLATED",
  });
}

type PageApiCall<T = unknown> = { ok: boolean; error?: string; value?: T };

async function callPageApi<T = unknown>(
  tabId: number,
  method: PageApiMethod,
  methodArgs: unknown[] = [],
): Promise<PageApiCall<T>> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "ISOLATED",
      injectImmediately: true,
      func: async (apiName: string, apiMethod: string, args: unknown[]) => {
        const api = (globalThis as unknown as Record<string, Record<string, (...fnArgs: unknown[]) => unknown>>)[apiName];
        if (!api || typeof api[apiMethod] !== "function") return { ok: false, error: "not injected" };
        try {
          return { ok: true, value: await api[apiMethod](...args) };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },
      args: [PAGE_PICK_API, method, methodArgs],
    });
    const result = results[0]?.result as PageApiCall<T> | undefined;
    return result ?? { ok: false, error: "not injected" };
  } catch (error) {
    return { ok: false, error: pageCommandError(error) };
  }
}

async function pingPageApi(tabId: number): Promise<boolean> {
  const result = await callPageApi(tabId, "ping");
  return result.ok === true;
}

async function waitForPageApi(tabId: number, timeoutMs = 2_500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await pingPageApi(tabId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

async function ensureContent(tabId: number): Promise<void> {
  if (await pingPageApi(tabId)) return;
  try {
    await injectContent(tabId, true);
  } catch {
    await injectContent(tabId, false);
  }
  // CRXJS injects a loader that import()s the real module; executeScript
  // resolves before __opensiderPage exists.
  if (await waitForPageApi(tabId)) return;
  await injectContent(tabId, false);
  if (!(await waitForPageApi(tabId))) {
    throw new Error("Could not inject the page API into this tab.");
  }
}

async function runContentMethod(tabId: number, command: BrowserCommand): Promise<BrowserResult> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const allowed = pageToolsAllowed(tab.url);
    if (!allowed.ok) return fail(command, allowed.error);
    await ensureContent(tabId);
    const timeout = Math.min(command.args?.timeoutMs ?? 20_000, 20_000);
    const called = await Promise.race([
      callPageApi<BrowserResult>(tabId, "runCommand", [command]),
      new Promise<PageApiCall<BrowserResult>>((resolve) => {
        setTimeout(() => resolve({ ok: false, error: "page command timed out" }), timeout);
      }),
    ]);
    if (!called.ok) return fail(command, pageCommandError(called.error));
    const value = called.value;
    if (value && typeof value === "object" && "id" in value) return value;
    return { id: command.id, ok: true, method: command.method, data: value };
  } catch (error) {
    return fail(command, pageCommandError(error));
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
    const started = await callPageApi(tab.id, "startPick", [requestId, hint ?? ""]);
    if (!started.ok || started.value === false) throw new Error(started.error ?? "not injected");
  } catch (error) {
    pickTabId = undefined;
    broadcast({
      type: "page.picked",
      requestId,
      items: [],
      error: pickFailureCode(error),
    });
  }
}

async function cancelPagePick(): Promise<void> {
  const tabId = pickTabId ?? (await activeHttpTab())?.id;
  pickTabId = undefined;
  if (!tabId) return;
  try {
    await callPageApi(tabId, "stopPick");
  } catch {
    try {
      await chrome.tabs.sendMessage(tabId, { type: "page.pick.cancel" }, { frameId: 0 });
    } catch {
      // tab may not have the content script
    }
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
    const tabId = pickTabId;
    pickTabId = undefined;
    if (tabId) void callPageApi(tabId, "stopPick");
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
  onActiveTabMaybeChanged(info.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (tab.active && (change.status === "complete" || change.favIconUrl || change.url || change.title)) {
    void requestPage(tabId);
  }
  if (change.status || change.title || change.url || change.favIconUrl || change.pinned) {
    scheduleTabsPublish();
  }
});

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.active) onActiveTabMaybeChanged(tab.windowId);
  else scheduleTabsPublish();
});

chrome.tabs.onRemoved.addListener((tabId, info) => {
  if (isClosedCurrentTab(currentTabId, tabId) || isClosedCurrentTab(lastKnownTabId(), tabId)) {
    rememberCurrentTab(undefined);
  }
  onActiveTabMaybeChanged(info.isWindowClosing ? undefined : info.windowId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (isClosedCurrentTab(currentTabId, removedTabId) || isClosedCurrentTab(lastKnownTabId(), removedTabId)) {
    rememberCurrentTab(addedTabId);
  }
  onActiveTabMaybeChanged();
});

chrome.tabs.onMoved.addListener((_tabId, info) => {
  onActiveTabMaybeChanged(info.windowId);
});

chrome.tabs.onAttached.addListener((_tabId, info) => {
  onActiveTabMaybeChanged(info.newWindowId);
});

chrome.tabs.onDetached.addListener((_tabId, info) => {
  onActiveTabMaybeChanged(info.oldWindowId);
});

chrome.windows.onCreated.addListener(scheduleTabsPublish);
chrome.windows.onRemoved.addListener(() => {
  onActiveTabMaybeChanged();
});
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    scheduleTabsPublish();
    return;
  }
  onActiveTabMaybeChanged(windowId);
});
