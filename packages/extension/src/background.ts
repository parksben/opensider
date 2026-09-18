import type {
  AttachmentItem,
  BrowserCommand,
  BrowserResult,
  ClipRect,
  CurrentPage,
  DialogPolicy,
  ExtToHost,
  HostStatusState,
  HostToExt,
  NativeUiEvent,
  NativeUiSnapshot,
  OverlaySnapshot,
  PageActivityState,
  PageMethod,
  TabControlState,
  TabRecord,
  TabsSnapshot,
} from "@shared";
import {
  HOST_NAME,
  NATIVE_UI_HOOK_KEY,
  PAGE_ACTIVITY_HOOK_KEY,
  isActionMethod,
  isCaptureMethod,
  isNativeUiMethod,
  isScriptMethod,
  isTabMethod,
  isWindowMethod,
  normalizeDialogPolicy,
  overlaySignature,
} from "@shared";
import { stripControlMark } from "./control-badge";
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
import { splitStateText, StateChunkSink } from "./state-transfer";
import {
  type ControlSnapshot,
  anchorFor,
  blockKey,
  blockPair,
  clearBlock,
  clearPending,
  clearTarget,
  emptyControl,
  entryForTab,
  isBlocked,
  isRemembered,
  parkSession,
  parseControl,
  primaryTabFor,
  pruneControl,
  releaseSession,
  releaseTab,
  rememberOrigin,
  rememberTrusted,
  setAnchor,
  setPending,
  setTarget,
  takeover,
  targetFor,
  touch,
} from "./tab-control";
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
let lastRelease: HostToExt | undefined;
// 宿主镜像超过 Native Messaging 单帧上限时会分片发来（见 state-transfer.ts）；
// 拼成完整一条才 broadcast / 进回放缓存，侧栏那边完全无感。
const uiStateSink = new StateChunkSink();
let ignoreNextDisconnect = false;
let missingRetryTimer = 0;
let startingWatchdog = 0;
const STARTING_TIMEOUT_MS = 10_000;

const INSTALL_HINT = "Send the prompt shown in the side panel to your local AI Agent.";

// Test seam: `scripts/verify-native-ui.mjs` drives real commands through this instead of
// going through the native host and the side panel, so it can run without a registered host.
// Reachable only from extension contexts (a page cannot call into the service worker), and it
// exposes nothing the host could not already ask for. Declared up here so it exists as soon
// as the module starts evaluating.
(globalThis as unknown as Record<string, unknown>)["__opensiderDispatch"] = (
  command: BrowserCommand,
  sessionId?: string,
) =>
  new Promise<BrowserResult | undefined>((resolve) => {
    void dispatchCommand(command, sessionId, resolve);
  });

// Test seams for `scripts/verify-tab-control.mjs`: the same handlers the side-panel port
// uses for control messages, plus a read-only view of the control store.
(globalThis as unknown as Record<string, unknown>)["__opensiderControl"] = (msg: ExtToHost) =>
  handleControlMessage(msg);
(globalThis as unknown as Record<string, unknown>)["__opensiderControlState"] = async () => {
  await loadControlState();
  return { entries: controlState.entries, pending: controlState.pending, blocked: controlState.blocked };
};
// What the workspace files will say: the tab snapshot with `control` flags and the route
// `current.json` carries (read-only; used by the same verify script).
(globalThis as unknown as Record<string, unknown>)["__opensiderSnapshot"] = async () => {
  await loadControlState();
  return { snapshot: await collectTabsSnapshot(), target: await currentControlTarget() };
};
// Simulates the host's turn.end for `scripts/verify-tab-control.mjs`.
(globalThis as unknown as Record<string, unknown>)["__opensiderTurnEnd"] = (sessionId?: string) =>
  parkControlFor(sessionId);
// The last outbound host messages. `scripts/verify-tab-control.mjs` reads them to check that
// answering a borrow request really nudged the Agent, without a real host in the loop.
const outboundLog: ExtToHost[] = [];
(globalThis as unknown as Record<string, unknown>)["__opensiderOutbound"] = () => outboundLog.slice();
// Prompt texts the side panel sent, in their own list: the snapshot traffic above can be
// very chatty and would push them out of `outboundLog` before the verify script reads it.
const promptLog: string[] = [];
(globalThis as unknown as Record<string, unknown>)["__opensiderPrompts"] = () => promptLog.slice();
// Forces a host status (the verify script has no real host, and the composer refuses to
// send while offline). While forced, missing-host reports stay suppressed so the sidebar
// keeps rendering its chat pane instead of falling back to the bridge setup screen.
let statusForced = false;
(globalThis as unknown as Record<string, unknown>)["__opensiderStatus"] = (state: HostStatusState) => {
  statusForced = true;
  clearMissingRetry();
  broadcast({ type: "status", state });
};

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
  if (statusForced) return;
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
  if (msg.type === "release") lastRelease = msg;
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
    if (lastRelease) port.postMessage(lastRelease);
    if (lastUiState) port.postMessage(lastUiState);
    if (lastControl) port.postMessage(lastControl);
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
    if (statusForced) return;
    broadcast({
      type: "status",
      state: "error",
      error: nativeError(`Native host is not installed. ${detail}`),
    });
    return;
  }

  nativePort.onMessage.addListener((msg: HostToExt) => {
    clearMissingRetry();
    if (msg.type === "ui.state" && "total" in msg) {
      const joined = uiStateSink.push(msg.index, msg.total, msg.data);
      if (joined !== undefined) {
        try {
          broadcast({ type: "ui.state", state: JSON.parse(joined) as Record<string, unknown> });
        } catch (error) {
          console.warn("opensider: chunked ui.state is not json", error);
        }
      }
      return;
    }
    if (msg.type === "browser.command") {
      void dispatchCommand(msg.command, msg.sessionId);
    }
    if (msg.type === "turn.end" && msg.sessionId) {
      // The turn is over: hand the tabs back, keep the memories (see parkControlFor).
      void parkControlFor(msg.sessionId);
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
  outboundLog.push(msg);
  if (outboundLog.length > 12) outboundLog.shift();
  if (msg.type === "prompt" && typeof msg.text === "string") {
    promptLog.push(msg.text);
    if (promptLog.length > 10) promptLog.shift();
  }
  connectNative();
  if (!nativePort) {
    if (statusForced) return;
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
    // 镜像状态超过单帧上限时按片发（Host 侧重组后再落盘，见 internal/host/uistate_wire.go）。
    if (msg.type === "ui.state.set" && "state" in msg) {
      const parts = splitStateText(JSON.stringify(msg.state));
      if (parts.length > 1) {
        const port = nativePort;
        parts.forEach((data, index) => {
          port.postMessage({ type: "ui.state.set", index, total: parts.length, data } satisfies ExtToHost);
        });
        return;
      }
    }
    nativePort.postMessage(msg);
  } catch (error) {
    broadcast({ type: "status", state: "error", error: String(error) });
    if (msg.type === "prompt") broadcast({ type: "turn.end", stopReason: "error" });
  }
}

function fail(command: BrowserCommand, error: string, data?: unknown): BrowserResult {
  return { id: command.id, ok: false, method: command.method, error, data };
}

/** A failed result with the machine-readable control gate fields attached. */
function failWith(
  command: BrowserCommand,
  failure: { error: string; reason?: string; hint?: string },
): BrowserResult {
  return {
    id: command.id,
    ok: false,
    method: command.method,
    error: failure.error,
    reason: failure.reason,
    hint: failure.hint,
  };
}

type UnsavedProbe = {
  dirty: boolean;
  reasons: string[];
  fields?: Array<{ label?: string; name?: string; reason: string }>;
  beforeunload?: boolean;
};

// --- Agent tab control (borrow / take-back) --------------------------------------------
//
// Routing is decoupled from the user's focus (see docs/TECH_DESIGN.md «Agent 标签接管»):
// a session works in the tabs it holds — its anchor, taken over on the first write, or the
// tabs it opened itself. Any other user tab needs an explicit grant from the side panel.

const CONTROL_KEY = "opensiderTabControl";
const ANCHOR_FRESH_MS = 5 * 60_000;

type ControlGate = {
  tab?: chrome.tabs.Tab;
  fail?: { error: string; reason: string; hint?: string };
};

let controlState: ControlSnapshot = emptyControl();
let controlLoaded = false;
let lastControl: HostToExt | undefined;
let lastControlSessionId: string | undefined;
/** Anchor reported for a session the SW does not know yet (brand-new chat, first prompt). */
let pendingAnchor: { tabId: number; at: number } | null = null;
/** tabId -> commands in flight; drives the banner's "working" state. */
const actingTabs = new Map<number, number>();

async function loadControlState(): Promise<void> {
  if (controlLoaded) return;
  controlLoaded = true;
  try {
    const raw = (await chrome.storage.session.get(CONTROL_KEY))?.[CONTROL_KEY];
    controlState = parseControl(raw);
  } catch {
    controlState = emptyControl();
  }
}

function persistControl(): void {
  try {
    void chrome.storage.session.set({ [CONTROL_KEY]: controlState });
  } catch {
    // best effort; the TTL prunes anything that lingers
  }
}

async function buildControlStates(): Promise<TabControlState[]> {
  const sessions = new Map<string, TabControlState>();
  for (const entry of controlState.entries) {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(entry.tabId);
    } catch {
      continue;
    }
    if (tab.id == null) continue;
    let state = sessions.get(entry.sessionId);
    if (!state) {
      state = { sessionId: entry.sessionId, tabs: [] };
      sessions.set(entry.sessionId, state);
    }
    state.tabs.push({
      tabId: tab.id,
      title: stripControlMark(tab.title ?? ""),
      url: tab.url ?? "",
      acting: actingTabs.has(tab.id),
    });
  }
  return [...sessions.values()];
}

async function publishControl(): Promise<void> {
  await loadControlState();
  lastControl = { type: "control", sessions: await buildControlStates() };
  broadcast(lastControl);
}

/** Paint (or clear) the control prefix the page shows in its own tab title. Best effort. */
async function pushControlBadge(tabId: number, on: boolean): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!pageToolsAllowed(tab.url).ok) return;
    await ensureContent(tabId);
    await callPageApi(tabId, "setControlBadge", [on]);
  } catch {
    // not injected yet, or the tab is gone — a later command / navigation re-pushes it
  }
}

/** Navigation drops the content script; a controlled tab gets its badge back. */
async function reassertControlBadge(tabId: number): Promise<void> {
  await loadControlState();
  if (!entryForTab(controlState, tabId)) return;
  void pushControlBadge(tabId, true);
}

async function setActing(tabId: number, delta: 1 | -1): Promise<void> {
  const count = (actingTabs.get(tabId) ?? 0) + delta;
  if (count <= 0) actingTabs.delete(tabId);
  else actingTabs.set(tabId, count);
  void publishControl();
}

function rememberControlSession(sessionId: string): void {
  lastControlSessionId = sessionId;
}

/** Methods that count as "working in" a tab: a write there takes the anchor over. */
function isControlWrite(method: PageMethod): boolean {
  return isActionMethod(method) && method !== "getNativeUi";
}

function freshPendingAnchor(now = Date.now()): number | undefined {
  if (pendingAnchor && now - pendingAnchor.at < ANCHOR_FRESH_MS) return pendingAnchor.tabId;
  return undefined;
}

function effectiveAnchor(sessionId: string, now: number): number | undefined {
  const existing = anchorFor(controlState, sessionId);
  if (existing != null) return existing;
  const fallback = freshPendingAnchor(now);
  if (fallback != null) {
    setAnchor(controlState, sessionId, fallback);
    persistControl();
  }
  return fallback;
}

async function sessionTargetTab(sessionId: string): Promise<chrome.tabs.Tab | undefined> {
  const tabId = primaryTabFor(controlState, sessionId) ?? effectiveAnchor(sessionId, Date.now());
  if (tabId == null) return undefined;
  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return undefined;
  }
}

async function adoptTab(sessionId: string, tabId: number, now = Date.now(), origin = false): Promise<void> {
  await loadControlState();
  takeover(controlState, sessionId, tabId, now);
  if (origin) rememberOrigin(controlState, sessionId, tabId);
  persistControl();
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch {
    // the tab may already be gone
  }
  void pushControlBadge(tabId, true);
  void publishControl();
}

/** Drop expired entries / requests and undo their side effects. */
async function pruneControlState(): Promise<void> {
  await loadControlState();
  const { changed, released } = pruneControl(controlState, Date.now());
  if (!changed) return;
  persistControl();
  for (const tabId of released) {
    void chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => undefined);
    void pushControlBadge(tabId, false);
  }
  void publishControl();
}

async function handleTabGone(tabId: number): Promise<void> {
  await loadControlState();
  if (releaseTab(controlState, tabId) == null) return;
  persistControl();
  void publishControl();
}

async function remapControlEntry(addedTabId: number, removedTabId: number): Promise<void> {
  await loadControlState();
  const entry = entryForTab(controlState, removedTabId);
  if (!entry) return;
  entry.tabId = addedTabId;
  for (const [sessionId, target] of Object.entries(controlState.targets)) {
    if (target === removedTabId) controlState.targets[sessionId] = addedTabId;
  }
  for (const key of ["origins", "trusted"] as const) {
    for (const [sessionId, ids] of Object.entries(controlState[key])) {
      if (ids.includes(removedTabId)) {
        controlState[key][sessionId] = ids.map((id) => (id === removedTabId ? addedTabId : id));
      }
    }
  }
  persistControl();
  void pushControlBadge(addedTabId, true);
  void publishControl();
}

/** No grant yet: ask the side panel, or answer from the cooldown / existing request. */
async function requestBorrow(sessionId: string, tab: chrome.tabs.Tab): Promise<ControlGate> {
  const tabId = tab.id as number;
  const title = stripControlMark(tab.title ?? "");
  const now = Date.now();
  if (isBlocked(controlState, sessionId, tabId, now)) {
    return {
      fail: {
        error: `The user took this tab's control back (or declined) recently, so it is still off limits: 「${title}」.`,
        reason: "borrow_denied",
        hint: "Do not retry on your own; ask the user with cursor/ask_question if the task still needs it.",
      },
    };
  }
  const pending = controlState.pending;
  if (pending && !(pending.sessionId === sessionId && pending.tabId === tabId)) {
    return {
      fail: {
        error: "Another tab-control request is already waiting for the user in the side panel.",
        reason: "borrow_pending",
        hint: "Wait for the user to answer the pending card, then retry this command once.",
      },
    };
  }
  if (!pending) {
    const requestId = crypto.randomUUID();
    setPending(controlState, { requestId, sessionId, tabId, at: now });
    persistControl();
    broadcast({ type: "control.request", requestId, tabId, title, url: tab.url ?? "", sessionId });
    void publishControl();
  }
  return {
    fail: {
      error: `This tab is not under the Agent's control yet: 「${title}」. A borrow request is waiting in the side panel.`,
      reason: "borrow_required",
      hint: "Tell the user about the side-panel card; after they allow it, retry this command once.",
    },
  };
}

async function resolveCommandTab(command: BrowserCommand, sessionId?: string): Promise<ControlGate> {
  await loadControlState();
  await pruneControlState();
  const now = Date.now();
  const explicit = command.args?.tabId;

  if (typeof explicit === "number") {
    let tab: chrome.tabs.Tab;
    try {
      tab = await chrome.tabs.get(explicit);
    } catch {
      return { fail: { error: `tab ${explicit} is gone`, reason: "no_target" } };
    }
    if (tab.id == null) return { fail: { error: `tab ${explicit} is gone`, reason: "no_target" } };
    if (!sessionId || !pageToolsAllowed(tab.url).ok) return { tab };
    const entry = entryForTab(controlState, tab.id);
    if (entry?.sessionId === sessionId) {
      touch(controlState, tab.id, now);
      persistControl();
      return { tab };
    }
    if (entry) {
      return {
        fail: {
          error: "Another OpenSider conversation is controlling this tab right now.",
          reason: "borrow_held",
          hint: "Leave it alone unless the user asks; do not work around it from another session.",
        },
      };
    }
    if (effectiveAnchor(sessionId, now) === tab.id || isRemembered(controlState, sessionId, tab.id)) {
      if (isControlWrite(command.method)) await adoptTab(sessionId, tab.id, now);
      return { tab };
    }
    return requestBorrow(sessionId, tab);
  }

  if (sessionId) {
    let targetId = targetFor(controlState, sessionId);
    if (targetId == null) {
      targetId = effectiveAnchor(sessionId, now);
      if (targetId != null) {
        setTarget(controlState, sessionId, targetId);
        persistControl();
      }
    }
    if (targetId != null) {
      let tab: chrome.tabs.Tab | undefined;
      try {
        tab = await chrome.tabs.get(targetId);
      } catch {
        tab = undefined;
      }
      if (tab?.id == null) {
        // The route is stale: forget it and fall back to the user's current tab.
        clearTarget(controlState, sessionId);
        persistControl();
      } else {
        const entry = entryForTab(controlState, tab.id);
        if (entry?.sessionId === sessionId) {
          touch(controlState, tab.id, now);
          persistControl();
          return { tab };
        }
        if (entry) {
          return {
            fail: {
              error: "Another OpenSider conversation is controlling this tab right now.",
              reason: "borrow_held",
              hint: "Leave it alone unless the user asks; do not work around it from another session.",
            },
          };
        }
        if (isControlWrite(command.method)) {
          if (isBlocked(controlState, sessionId, tab.id, now)) {
            return {
              fail: {
                error: "The user took this tab's control back (or declined) recently, so it is still off limits.",
                reason: "borrow_denied",
                hint: "Do not retry on your own; ask the user with cursor/ask_question if the task still needs it.",
              },
            };
          }
          await adoptTab(sessionId, tab.id, now);
        }
        return { tab };
      }
    }
  }

  const tab = await resolveFocusedActiveChromeTab();
  if (!tab?.id) return { fail: { error: "No active tab", reason: "no_target" } };
  if (sessionId && isControlWrite(command.method) && pageToolsAllowed(tab.url).ok) {
    const entry = entryForTab(controlState, tab.id);
    if (entry && entry.sessionId !== sessionId) {
      return {
        fail: {
          error: "Another OpenSider conversation is controlling this tab right now.",
          reason: "borrow_held",
          hint: "Leave it alone unless the user asks; do not work around it from another session.",
        },
      };
    }
    if (!entry) {
      if (isBlocked(controlState, sessionId, tab.id, now)) {
        return {
          fail: {
            error: "The user took this tab's control back (or declined) recently, so it is still off limits.",
            reason: "borrow_denied",
            hint: "Do not retry on your own; ask the user with cursor/ask_question if the task still needs it.",
          },
        };
      }
      await adoptTab(sessionId, tab.id, now);
    }
  }
  return { tab };
}

async function recordAnchor(sessionId: string | undefined, tabId: number | undefined): Promise<void> {
  await loadControlState();
  const id = tabId ?? (await resolveFocusedActiveChromeTab())?.id;
  if (id == null) return;
  pendingAnchor = { tabId: id, at: Date.now() };
  if (sessionId) {
    setAnchor(controlState, sessionId, id);
    // A new user message re-points the session: unqualified commands go back to the tab
    // the user was on, even if the Agent had wandered to a tab of its own.
    setTarget(controlState, sessionId, id);
    persistControl();
  }
}

/** User take-back from the side panel: release now, and keep the tabs off limits for a while. */
async function releaseControlFor(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await loadControlState();
  const now = Date.now();
  const tabIds = releaseSession(controlState, sessionId);
  for (const tabId of tabIds) blockPair(controlState, sessionId, tabId, now);
  persistControl();
  for (const tabId of tabIds) {
    void chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => undefined);
    void pushControlBadge(tabId, false);
  }
  void publishControl();
}

/**
 * The turn is over: give the held tabs back (badges off, banner clears) while keeping the
 * memories — tabs the session opened and tabs the user already approved stay free to
 * re-enter without a new card.
 */
async function parkControlFor(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await loadControlState();
  const tabIds = parkSession(controlState, sessionId);
  if (tabIds.length === 0) return;
  persistControl();
  for (const tabId of tabIds) {
    void chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => undefined);
    void pushControlBadge(tabId, false);
  }
  void publishControl();
}

/** The user answered a borrow card. */
async function resolveBorrow(requestId: string, allow: boolean): Promise<void> {
  await loadControlState();
  const pending = controlState.pending;
  if (!pending || pending.requestId !== requestId) return;
  const now = Date.now();
  clearPending(controlState);
  if (allow) {
    clearBlock(controlState, pending.sessionId, pending.tabId);
    takeover(controlState, pending.sessionId, pending.tabId, now);
    // The user approved this tab for the session: re-entering it later needs no new card.
    rememberTrusted(controlState, pending.sessionId, pending.tabId);
    persistControl();
    try {
      await chrome.tabs.update(pending.tabId, { autoDiscardable: false });
    } catch {
      // tab gone
    }
    void pushControlBadge(pending.tabId, true);
  } else {
    blockPair(controlState, pending.sessionId, pending.tabId, now);
    persistControl();
  }
  broadcast({ type: "control.request.done", requestId, allow });
  void publishControl();
}

/** The route target of the session that last commanded — what `current.json` calls `target`. */
async function currentControlTarget(): Promise<CurrentPage["target"] | undefined> {
  const sessionId = lastControlSessionId;
  if (!sessionId) return undefined;
  const tabId = primaryTabFor(controlState, sessionId);
  if (tabId == null) return undefined;
  try {
    const tab = await chrome.tabs.get(tabId);
    return { tabId, url: tab.url ?? "", title: stripControlMark(tab.title ?? "") };
  } catch {
    return undefined;
  }
}

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

/**
 * Screenshots go through the window's *active* tab (`captureVisibleTab`), so a background
 * target needs a guarded flip: activate it, capture, then give the view back — but only if
 * it is still ours (the user may have switched mid-capture; then we leave it alone).
 * Activating a tab in a window the user is not looking at is invisible to them.
 */
async function prepareCapture(
  tabId: number,
  windowId: number,
): Promise<{ restore: () => Promise<void> } | { fail: { error: string; reason: string; hint?: string } }> {
  let win: chrome.windows.Window;
  try {
    win = await chrome.windows.get(windowId);
  } catch {
    return { fail: { error: "The tab's window is gone.", reason: "no_target" } };
  }
  if (win.state === "minimized") {
    return {
      fail: {
        error: "A screenshot needs a visible window and this one is minimized.",
        reason: "needs_visible",
        hint: "Ask the user to restore the window, or use DOM reads (snapshot/getInteractive) instead.",
      },
    };
  }
  const [active] = await chrome.tabs.query({ active: true, windowId });
  if (active?.id === tabId) return { restore: async () => undefined };
  await chrome.tabs.update(tabId, { active: true });
  return {
    restore: async () => {
      const [now] = await chrome.tabs.query({ active: true, windowId });
      if (now?.id !== tabId) return;
      if (active?.id != null) await chrome.tabs.update(active.id, { active: true }).catch(() => undefined);
    },
  };
}

async function runCapture(tab: { id?: number; windowId?: number }, command: BrowserCommand): Promise<BrowserResult> {
  if (tab.id == null || tab.windowId == null) return fail(command, "tab is not capturable");
  const prepared = await prepareCapture(tab.id, tab.windowId);
  if ("fail" in prepared) return failWith(command, prepared.fail);
  try {
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
  } finally {
    await prepared.restore();
  }
}

function toTabRecord(tab: chrome.tabs.Tab, controlled?: Set<number>): TabRecord | undefined {
  if (tab.id == null || tab.windowId == null) return undefined;
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: stripControlMark(tab.title ?? ""),
    url: tab.url ?? "",
    active: Boolean(tab.active),
    pinned: Boolean(tab.pinned),
    restricted: isRestrictedUrl(tab.url),
    control: controlled?.has(tab.id) ? "agent" : "user",
  };
}

async function collectTabsSnapshot(): Promise<TabsSnapshot> {
  await loadControlState();
  const controlled = new Set(controlState.entries.map((entry) => entry.tabId));
  const windows = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
  return {
    updatedAt: new Date().toISOString(),
    windows: windows
      .filter((win) => win.id != null)
      .map((win) => ({
        windowId: win.id as number,
        focused: Boolean(win.focused),
        state: win.state,
        tabs: (win.tabs ?? [])
          .map((tab) => toTabRecord(tab, controlled))
          .filter((tab): tab is TabRecord => tab != null),
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

async function runWindowMethod(command: BrowserCommand, sessionId?: string): Promise<BrowserResult> {
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
    await loadControlState();
    // Quiet by default: open next to the tab the session works in (or the focused window),
    // in the background, and adopt it — opening a page must not take the user's view away.
    const anchorTab = sessionId ? await sessionTargetTab(sessionId) : undefined;
    const created = await chrome.tabs.create({
      url: parsed.toString(),
      windowId: command.args?.windowId ?? anchorTab?.windowId,
      index: anchorTab ? anchorTab.index + 1 : undefined,
      active: false,
    });
    if (created.id == null) return fail(command, "could not open tab");
    if (sessionId) await adoptTab(sessionId, created.id, Date.now(), true);
    await waitTabComplete(created.id, Math.min(command.args?.timeoutMs ?? 15_000, 20_000)).catch(() => undefined);
    return {
      id: command.id,
      ok: true,
      method: command.method,
      data: {
        tabId: created.id,
        windowId: created.windowId,
        url: parsed.toString(),
        background: true,
        ...(await collectTabsSnapshot()),
      },
    };
  }

  if (command.method === "closeTab") {
    let tabId = command.args?.tabId;
    if (tabId == null) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = active?.id;
    }
    if (tabId == null || !Number.isInteger(tabId)) return fail(command, "closeTab requires args.tabId or an active tab");
    if (sessionId) {
      await loadControlState();
      const entry = entryForTab(controlState, tabId);
      if (entry && entry.sessionId !== sessionId) {
        return failWith(command, {
          error: "Another OpenSider conversation is controlling this tab right now.",
          reason: "borrow_held",
          hint: "Leave it alone unless the user asks; do not work around it from another session.",
        });
      }
      if (!entry && anchorFor(controlState, sessionId) !== tabId && !isRemembered(controlState, sessionId, tabId)) {
        return failWith(command, {
          error: "That tab was not handed to the Agent, so it may not be closed from here.",
          reason: "borrow_required",
          hint: "Ask the user with cursor/ask_question first; they can close it themselves too.",
        });
      }
    }
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

// --- native UI (JS dialogs and other browser surfaces a page can pop up) ---------------
//
// The shim lives in the page's MAIN world (`native-ui-hook.ts`) because that is the only
// place `alert` / `confirm` / `prompt` / the file picker can be intercepted. It cannot talk
// to us — main-world scripts have no chrome.* APIs — so everything is pull-based: the hook
// buffers events and holds the dialog policy, and we read them here.

const NATIVE_UI_TOKENS_KEY = "opensiderNativeUiTokens";
const nativeUiTokens = new Map<number, string>();
/** In-flight lookups: two shim calls in the same tick must not mint two tokens. */
const nativeUiTokenPending = new Map<number, Promise<string>>();

/** Per-tab token so page scripts cannot drive either MAIN-world shim (the token only
 * ever travels in `chrome.scripting.executeScript` args). Shared by the native UI hook
 * and the page activity hook — each learns it from the first call it receives. */
async function nativeUiToken(tabId: number): Promise<string> {
  const cached = nativeUiTokens.get(tabId);
  if (cached) return cached;
  const pending = nativeUiTokenPending.get(tabId);
  if (pending) return pending;
  const mint = async () => {
    let stored: Record<string, string> | undefined;
    try {
      stored = (await chrome.storage.session.get(NATIVE_UI_TOKENS_KEY))?.[NATIVE_UI_TOKENS_KEY] as
        | Record<string, string>
        | undefined;
    } catch {
      stored = undefined;
    }
    const token = stored?.[String(tabId)] ?? crypto.randomUUID().replace(/-/g, "");
    nativeUiTokens.set(tabId, token);
    try {
      await chrome.storage.session.set({
        [NATIVE_UI_TOKENS_KEY]: { ...(stored ?? {}), [String(tabId)]: token },
      });
    } catch {
      // storage.session is best-effort: a service-worker restart just re-arms the token
    }
    return token;
  };
  const task = mint();
  nativeUiTokenPending.set(tabId, task);
  try {
    return await task;
  } finally {
    nativeUiTokenPending.delete(tabId);
  }
}

type NativeUiCall<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The two MAIN-world hooks: the classic script that installs each one, and the global it
 * leaves behind. Built by `packages/extension/scripts/build-page-hooks.mjs` with these exact
 * names, so they can be named here instead of being looked up in the manifest.
 */
const PAGE_HOOKS = {
  "native-ui-hook": { file: "page-hooks/native-ui-hook.js", key: NATIVE_UI_HOOK_KEY as string },
  "activity-hook": { file: "page-hooks/activity-hook.js", key: PAGE_ACTIVITY_HOOK_KEY as string },
} as const;
type PageHookName = keyof typeof PAGE_HOOKS;

/** Is the hook's global already standing in the tab's main frame? */
async function pageHookInstalled(tabId: number, key: string): Promise<boolean> {
  try {
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      world: "MAIN",
      args: [key],
      func: (hookKey: string) => Boolean((globalThis as unknown as Record<string, unknown>)[hookKey]),
    });
    return Boolean(entry?.result);
  } catch {
    return false;
  }
}

/**
 * Fires one MAIN-world hook into every frame of a tab.
 *
 * They are classic scripts, so `executeScript` resolving means the hook is already listening
 * (an ESM loader would not be, and the call after it would have left the hook installed
 * without its caller token). Idempotent either way: both hooks bail out when they find
 * themselves already installed.
 */
async function injectPageHook(tabId: number, name: PageHookName): Promise<boolean> {
  const hook = PAGE_HOOKS[name];
  if (await pageHookInstalled(tabId, hook.key)) return true;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [hook.file],
      injectImmediately: true,
      world: "MAIN",
    });
    return true;
  } catch {
    // restricted URL, closed tab, no host permission for it, missing file
    return false;
  }
}

/**
 * A hook that is installed but reports `authorized: false` was claimed by the page: its API is
 * reachable from page script and the first caller becomes the trusted one (`hook-caller.ts`).
 * That only ever affects that page's own tab, but it would leave the Agent blind, so drop the
 * instance and install a fresh one — the very next call claims it. Bounded: one re-seat per
 * call site, so a page that keeps racing costs us one extra injection, not a loop.
 */
async function reseatPageHook(tabId: number, name: PageHookName): Promise<boolean> {
  const key = PAGE_HOOKS[name].key;
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [key],
      func: (hookKey: string) => {
        try {
          delete (globalThis as unknown as Record<string, unknown>)[hookKey];
        } catch {
          // ignore
        }
      },
    });
  } catch {
    return false;
  }
  return injectPageHook(tabId, name);
}

/** Runs one shim call in every frame and merges the answers. */
async function callNativeUi<T>(
  tabId: number,
  method: "read" | "setPolicy",
  args: unknown[],
  inject = false,
): Promise<NativeUiCall<T>> {
  const token = await nativeUiToken(tabId);
  const run = async () =>
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [NATIVE_UI_HOOK_KEY as string, method, token, args],
      func: (key: string, fn: string, caller: string, fnArgs: unknown[]) => {
        const api = (globalThis as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
          key
        ];
        if (!api || typeof api[fn] !== "function") return { ok: false as const, error: "not installed" };
        const handshake = api.handshake?.(caller) as { authorized?: boolean } | undefined;
        if (handshake && handshake.authorized !== true) return { ok: false as const, error: "held" };
        try {
          return { ok: true as const, value: api[fn](caller, ...fnArgs) as unknown };
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });
  const framesOf = (
    results: chrome.scripting.InjectionResult<unknown>[],
  ): Array<{ ok: boolean; value?: unknown; error?: string }> =>
    results
      .map((entry) => entry.result as { ok: boolean; value?: unknown; error?: string } | undefined)
      .filter((entry): entry is { ok: boolean; value?: unknown; error?: string } => Boolean(entry));

  try {
    let frames = framesOf(await run());
    // The hook is injected per tab on demand, so the first call on a tab finds nothing:
    // put it in and ask again. Only while the panel is open — the Agent's commands are the
    // only thing that reads these events, and a closed panel means no injection anywhere.
    if (
      inject &&
      sidebars.size > 0 &&
      !frames.some((frame) => frame.ok) &&
      (await injectPageHook(tabId, "native-ui-hook"))
    ) {
      frames = framesOf(await run());
    }
    // A hook the page got to first answers `held`; re-seat it and ask once more.
    if (inject && frames.some((frame) => !frame.ok && frame.error === "held")) {
      if (await reseatPageHook(tabId, "native-ui-hook")) frames = framesOf(await run());
    }
    if (frames.length === 0 || !frames.some((frame) => frame.ok)) {
      return {
        ok: false,
        error: "The browser UI hook could not be installed in this tab (system page or no access).",
      };
    }
    if (method === "setPolicy") {
      return { ok: true, value: frames.find((frame) => frame.ok)?.value as T };
    }
    const snapshots = frames
      .filter((frame) => frame.ok)
      .map((frame) => frame.value as NativeUiSnapshot);
    const events = snapshots
      .flatMap((snapshot) => snapshot.events ?? [])
      .sort((a, b) => a.at - b.at);
    const first = snapshots[0];
    return {
      ok: true,
      value: {
        events,
        policy: first?.policy ?? normalizeDialogPolicy(undefined, Date.now()),
        ui: first?.ui ?? { visibility: "unknown", fullscreen: false, beforeunload: false, permissions: {} },
      } as T,
    };
  } catch (error) {
    return { ok: false, error: pageCommandError(error) };
  }
}

// --- page-level overlays (the modal / drawer / popup a site puts up itself) -------------
//
// Distinct from the native UI events above: these live in the page's DOM, and they are the
// usual reason an Agent decides "the click did nothing". Reported with the action result so
// the Agent does not have to ask, and persisted for `browser/overlays.json`.

/** Last overlay signature reported per tab, so unchanged state stays out of results. */
const overlaySignatures = new Map<number, string>();

/** Returns the overlay snapshot when it appeared or changed, otherwise undefined. */
async function readOverlays(tabId: number): Promise<OverlaySnapshot | undefined> {
  const command: BrowserCommand = {
    id: `overlays-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    method: "getOverlays",
    args: {},
  };
  const result = await runContentMethod(tabId, command);
  if (!result.ok) return undefined;
  const snapshot = result.data as OverlaySnapshot | undefined;
  if (!snapshot || !Array.isArray(snapshot.overlays)) return undefined;
  const signature = overlaySignature(snapshot);
  if (signature === (overlaySignatures.get(tabId) ?? "")) return undefined;
  overlaySignatures.set(tabId, signature);
  sendNative({ type: "overlays", tabId, url: "", overlays: snapshot.overlays, modal: snapshot.modal });
  return snapshot;
}

/** Take whatever the page popped up since the last read (used after every page command).
 *
 * This is also the moment a tab counts as "touched": every page command runs through here,
 * and the hook is installed on demand the first time. */
async function drainNativeUi(tabId: number): Promise<NativeUiEvent[]> {
  const pulled = await callNativeUi<NativeUiSnapshot>(tabId, "read", [true], true);
  if (!pulled.ok) return [];
  return pulled.value.events ?? [];
}

function reportNativeUi(tabId: number, url: string, events: NativeUiEvent[]): void {
  if (events.length === 0) return;
  sendNative({ type: "native.ui", tabId, url, events });
}

async function runNativeUiMethod(tabId: number, command: BrowserCommand): Promise<BrowserResult> {
  if (command.method === "setDialogPolicy") {
    const policy: DialogPolicy = normalizeDialogPolicy(command.args?.policy ?? command.args, Date.now());
    const applied = await callNativeUi<DialogPolicy>(tabId, "setPolicy", [policy], true);
    if (!applied.ok) return fail(command, applied.error);
    return {
      id: command.id,
      ok: true,
      method: command.method,
      data: { tabId, policy: applied.value },
    };
  }
  const pulled = await callNativeUi<NativeUiSnapshot>(tabId, "read", [true], true);
  if (!pulled.ok) return fail(command, pulled.error);
  const snapshot = pulled.value;
  reportNativeUi(tabId, "", snapshot.events ?? []);
  return {
    id: command.id,
    ok: true,
    method: command.method,
    data: {
      tabId,
      policy: snapshot.policy,
      events: snapshot.events ?? [],
      ui: snapshot.ui,
    },
  };
}

// --- page activity (the Agent's page must stay "visible" while the panel is open) ----
//
// Chrome hides a page whenever its tab is not the active one of a visible, unoccluded,
// non-minimised window: `document.visibilityState` flips to "hidden", `hasFocus()` goes
// false, `requestAnimationFrame` stops firing and timers get throttled. Sites use that
// signal to pause themselves, so page automation in the background stalls. The shim
// (`activity-hook.ts`, MAIN world) rewrites what the page reads; here we decide *when*:
// while any side panel is open, for the tabs the Agent actually touches. Closing the
// panel puts every tab back the way it was.

/** Tabs we have armed the shim on. Mirrored into `chrome.storage.session` because the
 * service worker can be torn down between arming and the panel closing, and a page must
 * never be left pretending to be visible. */
const activityArmed = new Set<number>();
const ACTIVITY_TABS_KEY = "opensiderActivityTabs";

async function rememberActivityTabs(tabs: number[]): Promise<void> {
  try {
    await chrome.storage.session.set({ [ACTIVITY_TABS_KEY]: tabs });
  } catch {
    // storage.session is best-effort; the shim's own TTL is the backstop
  }
}

async function persistedActivityTabs(): Promise<number[]> {
  try {
    const raw = (await chrome.storage.session.get(ACTIVITY_TABS_KEY))?.[ACTIVITY_TABS_KEY];
    return Array.isArray(raw) ? raw.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

type ActivityCall = { ok: true; value: PageActivityState } | { ok: false; error: string };

/** Runs one shim call in every frame and merges the answers (main frame wins). */
async function callActivity(tabId: number, enabled: boolean, inject: boolean): Promise<ActivityCall> {
  const token = await nativeUiToken(tabId);
  const run = async () =>
    chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [PAGE_ACTIVITY_HOOK_KEY as string, token, enabled],
      func: (key: string, caller: string, value: boolean) => {
        const api = (globalThis as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[
          key
        ];
        if (!api || typeof api.set !== "function") return { ok: false as const, error: "not installed" };
        const handshake = api.handshake?.(caller) as { authorized?: boolean } | undefined;
        if (handshake && handshake.authorized !== true) return { ok: false as const, error: "held" };
        try {
          return { ok: true as const, value: api.set(caller, value) as unknown };
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
        }
      },
    });

  try {
    let results = await run();
    const framesOf = (
      injected: chrome.scripting.InjectionResult<unknown>[],
    ): Array<{ ok: boolean; value?: unknown; error?: string }> =>
      injected
        .map((entry) => entry.result as { ok: boolean; value?: unknown; error?: string } | undefined)
        .filter((entry): entry is { ok: boolean; value?: unknown; error?: string } => Boolean(entry));
    let frames = framesOf(results);
    // The hook is injected per tab on demand, so the first touch finds nothing installed:
    // put it in by hand once, then ask again.
    const missing = frames.length > 0 && frames.every((frame) => !frame.ok);
    if (missing && inject && (await injectPageHook(tabId, "activity-hook"))) {
      results = await run();
      frames = framesOf(results);
    }
    // A hook the page got to first answers `held`; re-seat it and ask once more.
    if (inject && frames.some((frame) => !frame.ok && frame.error === "held")) {
      if (await reseatPageHook(tabId, "activity-hook")) {
        results = await run();
        frames = framesOf(results);
      }
    }
    const answers = frames;
    const armed = answers.find((answer) => answer.ok && (answer.value as PageActivityState)?.armed);
    const first = armed ?? answers.find((answer) => answer.ok);
    if (!first) {
      return { ok: false, error: answers[0]?.error ?? "activity shim not installed" };
    }
    return { ok: true, value: first.value as PageActivityState };
  } catch (error) {
    return { ok: false, error: pageCommandError(error) };
  }
}

/** Arm the shim on a tab the Agent is about to work with. No-op while the panel is shut. */
async function armActivity(tabId: number): Promise<void> {
  if (sidebars.size === 0) return;
  // Re-armed (and thus refreshed) on every touch: arming carries a TTL so a panel that
  // disappears without us noticing cannot leave pages faking visibility forever.
  const armed = await callActivity(tabId, true, true);
  if (!armed.ok) return;
  if (!activityArmed.has(tabId)) {
    activityArmed.add(tabId);
    void rememberActivityTabs([...activityArmed]);
  }
  // Keep Chrome from discarding the tab while it backs the Agent's work.
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: false });
  } catch {
    // tab already gone
  }
}

/** Arm whichever tab the Agent would act on right now (the focused window's active one). */
async function armCurrentTab(): Promise<void> {
  const tab = await resolveFocusedActiveChromeTab();
  if (tab?.id != null) void armActivity(tab.id);
}

/**
 * Undo everything both MAIN-world hooks patched in a tab and drop their globals.
 *
 * Releasing a tab has to leave it stock again: the patches are things the page (and the
 * site's own integrity checks) can see, and a tab the Agent is done with goes back to being
 * an ordinary page. The next touch re-injects both hooks — injecting is idempotent and the
 * hooks reappear from the manifest's file names.
 */
async function releasePageHooks(tabId: number): Promise<void> {
  const token = await nativeUiToken(tabId);
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [NATIVE_UI_HOOK_KEY as string, PAGE_ACTIVITY_HOOK_KEY as string, token],
      func: (nativeKey: string, activityKey: string, caller: string) => {
        const host = globalThis as unknown as Record<string, { release?: (c: unknown) => unknown }>;
        for (const key of [activityKey, nativeKey]) {
          try {
            host[key]?.release?.(caller);
          } catch {
            // one hook failing must not block the other
          }
        }
      },
    });
  } catch {
    // restricted URL, closed tab, no access
  }
}

/** Put every armed tab back to stock behaviour (side panel closed, or extension reset). */
async function releaseActivity(): Promise<void> {
  const tabs = [...new Set([...(await persistedActivityTabs()), ...activityArmed])];
  activityArmed.clear();
  await rememberActivityTabs([]);
  for (const tabId of tabs) {
    await callActivity(tabId, false, false).catch(() => undefined);
    await releasePageHooks(tabId);
    try {
      await chrome.tabs.update(tabId, { autoDiscardable: true });
    } catch {
      // tab already gone
    }
  }
}

async function dispatchCommand(
  command: BrowserCommand,
  sessionId?: string,
  onResult?: (result: BrowserResult) => void,
): Promise<void> {
  const publish = (result: BrowserResult) => {
    onResult?.(result);
    sendNative({ type: "browser.result", result });
    broadcast({ type: "browser.result", result, sessionId });
  };
  if (isWindowMethod(command.method)) {
    let result: BrowserResult;
    try {
      result = await runWindowMethod(command, sessionId);
    } catch (error) {
      result = fail(command, String(error));
    }
    publish(result);
    if (result.ok) {
      void publishTabs();
      const tabId = (result.data as { tabId?: number } | undefined)?.tabId;
      if (command.method !== "listTabs" && tabId != null) void requestPage(tabId);
    }
    return;
  }

  const gate = await resolveCommandTab(command, sessionId);
  const tab = gate.tab;
  if (!tab?.id) {
    publish(gate.fail ? failWith(command, gate.fail) : fail(command, "No active tab"));
    return;
  }
  if (sessionId) rememberControlSession(sessionId);
  // A write is the Agent choosing where it works — an unqualified next command follows it.
  if (sessionId && isControlWrite(command.method) && tab.id != null) {
    setTarget(controlState, sessionId, tab.id);
    persistControl();
  }
  void armActivity(tab.id);
  const watched = Boolean(sessionId && entryForTab(controlState, tab.id));
  if (watched) void setActing(tab.id, 1);

  try {
    if (isNativeUiMethod(command.method)) {
      const result = await runNativeUiMethod(tab.id, command);
      publish(result);
      return;
    }

    const allowed = pageToolsAllowed(tab.url);
    if (!allowed.ok && !isTabMethod(command.method)) {
      publish(fail(command, allowed.error));
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

    // Anything the page popped up while this command ran belongs in its result: that is how the
    // Agent learns "the click I just sent opened a confirm()" without a second round trip.
    const popped = await drainNativeUi(tab.id);
    if (popped.length > 0) {
      result = { ...result, data: { ...(result.data ?? {}), nativeUi: popped } };
      reportNativeUi(tab.id, tab.url ?? "", popped);
    }

    // The page's own layers too (modal / drawer / overlay): an action that "did nothing" has
    // often just opened one of these. Only reported when the set appears or changes, so a
    // command that leaves the page as it was stays quiet.
    if (isActionMethod(command.method)) {
      const overlays = await readOverlays(tab.id);
      if (overlays) result = { ...result, data: { ...(result.data ?? {}), overlays } };
    }

    publish(result);
    if (result.ok && (isActionMethod(command.method) || command.method === "getInteractive" || command.method === "waitFor")) {
      void requestPage(tab.id);
      void publishTabs();
    }
  } finally {
    if (watched) void setActing(tab.id, -1);
  }
}

async function requestPage(tabId: number, writeGen?: number): Promise<void> {
  const gen = writeGen ?? ++pageSyncGen;
  await loadControlState();
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
      void armActivity(tabId);
      const snap = await callPageApi<CurrentPage>(tabId, "snapshot", [tabId]);
      if (!snap.ok || !snap.value) throw new Error(snap.error ?? "snapshot failed");
      const target = await currentControlTarget();
      const page = { ...snap.value, favIconUrl, ...(target ? { target } : {}) };
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
  const target = await currentControlTarget();
  const page = { ...fallback(), ...(target ? { target } : {}) };
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

/** The control messages the side panel can send (also reachable from the verify seams). */
function handleControlMessage(msg: ExtToHost): boolean {
  if (msg.type === "control.anchor") {
    void recordAnchor(msg.sessionId, msg.tabId);
    return true;
  }
  if (msg.type === "control.release") {
    void releaseControlFor(msg.sessionId);
    return true;
  }
  if (msg.type === "control.grant") {
    void resolveBorrow(msg.requestId, msg.allow);
    return true;
  }
  return false;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidebar") return;
  sidebars.add(port);
  replay(port);
  connectNative();
  // A panel just opened: its tab-control banner should be current, not a stale replay.
  void publishControl();
  // A panel just opened: the tab it will work with has to start reading as visible even
  // if the Agent does not touch it until later.
  void armCurrentTab();
  port.onMessage.addListener((msg: ExtToHost) => {
    if (msg.type === "page.pick") {
      void startPagePick(msg.requestId, msg.hint);
      return;
    }
    if (msg.type === "page.pick.cancel") {
      void cancelPagePick();
      return;
    }
    if (handleControlMessage(msg)) return;
    sendNative(msg);
  });
  port.onDisconnect.addListener(() => {
    sidebars.delete(port);
    // Last panel gone: the pages should stop pretending to be visible.
    if (sidebars.size === 0) void releaseActivity();
  });
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
void publishControl();

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
  if (change.status === "complete") {
    void reassertControlBadge(tabId);
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
  void handleTabGone(tabId);
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  if (isClosedCurrentTab(currentTabId, removedTabId) || isClosedCurrentTab(lastKnownTabId(), removedTabId)) {
    rememberCurrentTab(addedTabId);
  }
  onActiveTabMaybeChanged();
  void remapControlEntry(addedTabId, removedTabId);
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
