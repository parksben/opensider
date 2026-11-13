import type { ExtToHost, HostToExt } from "@shared";

type Listener = (msg: HostToExt) => void;

type Shared = {
  port: chrome.runtime.Port | null;
  listeners: Set<Listener>;
  alive: boolean;
  closedByUs: boolean;
  attaching: boolean;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  attempts: number;
  /** Messages sent while the first attach() is still resolving (e.g. a preview page). */
  pending: ExtToHost[];
};

const shared: Shared = {
  port: null,
  listeners: new Set(),
  alive: false,
  closedByUs: false,
  attaching: false,
  reconnectTimer: undefined,
  attempts: 0,
  pending: [],
};

function emit(msg: HostToExt): void {
  for (const listener of shared.listeners) listener(msg);
}

/**
 * Ports we dropped ourselves. A rejected `postMessage` does not disconnect the port: the
 * service worker keeps it in `sidebars` and every later broadcast reaches this page again.
 * That is how one streaming turn used to be rendered N times (each token repeated ~N
 * times) after a few oversized `ui.state.set` sends. Retired ports must stay silent even
 * if Chrome delivers something before the disconnect lands.
 */
const retiredPorts = new WeakSet<chrome.runtime.Port>();
/** Set by connectSidebar(); the preview page uses its own port name. */
let portName = "sidebar";
const TOO_LARGE = /maximum allowed size|message length exceeded/i;

type PostResult = { ok: true } | { ok: false; error: string; tooLarge: boolean };

function retirePort(port: chrome.runtime.Port): void {
  if (shared.port === port) shared.port = null;
  retiredPorts.add(port);
  try {
    port.disconnect();
  } catch {
    // already gone
  }
}

function postTo(port: chrome.runtime.Port | null, msg: ExtToHost): PostResult {
  if (!port || retiredPorts.has(port)) return { ok: false, error: "", tooLarge: false };
  try {
    port.postMessage(msg);
    return { ok: true };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    retirePort(port);
    return { ok: false, error: detail, tooLarge: TOO_LARGE.test(detail) };
  }
}

async function wake(): Promise<HostToExt | undefined> {
  try {
    const reply = (await chrome.runtime.sendMessage({ type: "ping" })) as
      | { ok?: boolean; status?: HostToExt }
      | undefined;
    return reply?.status;
  } catch {
    return undefined;
  }
}

function scheduleReconnect(): void {
  if (!shared.alive || shared.reconnectTimer || shared.port) return;
  const delay = Math.min(1500, 80 * 2 ** Math.min(shared.attempts, 5));
  shared.reconnectTimer = setTimeout(() => {
    shared.reconnectTimer = undefined;
    if (shared.alive && !shared.port) void attach();
  }, delay);
}

async function attach(): Promise<void> {
  if (shared.port || !shared.alive || shared.attaching) return;
  shared.attaching = true;
  shared.closedByUs = false;
  try {
    const replay = await wake();
    if (replay) emit(replay);
    if (shared.port || !shared.alive) return;

    const port = chrome.runtime.connect({ name: portName });
    shared.port = port;
    const pending = shared.pending;
    shared.pending = [];
    for (const msg of pending) postTo(port, msg);
    port.onMessage.addListener((msg: HostToExt) => {
      if (retiredPorts.has(port)) return;
      shared.attempts = 0;
      emit(msg);
    });
    port.onDisconnect.addListener(() => {
      if (retiredPorts.has(port)) return;
      const wasCurrent = shared.port === port;
      if (wasCurrent) shared.port = null;
      if (!wasCurrent || shared.closedByUs || !shared.alive) return;
      shared.attempts += 1;
      const detail = chrome.runtime.lastError?.message;
      if (shared.attempts >= 8) {
        emit({
          type: "status",
          state: "error",
          error:
            detail ??
            "Lost connection to the extension service worker. Reload the extension, then try Connection.",
        });
        return;
      }
      emit({ type: "status", state: "starting" });
      scheduleReconnect();
    });
  } finally {
    shared.attaching = false;
  }
}

function teardown(): void {
  shared.closedByUs = true;
  shared.pending = [];
  if (shared.reconnectTimer) {
    clearTimeout(shared.reconnectTimer);
    shared.reconnectTimer = undefined;
  }
  const port = shared.port;
  shared.port = null;
  if (port) retirePort(port);
}

function connectNativeHost(): void {
  chrome.runtime.sendMessage({ type: "reconnect" }).then(
    () => undefined,
    (error: unknown) => {
      emit({
        type: "status",
        state: "error",
        error:
          error instanceof Error
            ? error.message
            : "Could not reach the extension service worker. Reload the extension, then retry.",
      });
    },
  );
}

function onPageHide(): void {
  shared.alive = false;
  teardown();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", onPageHide);
}

export function connectSidebar(onMessage: Listener, name = "sidebar"): {
  send: (msg: ExtToHost) => void;
  reconnect: () => void;
  disconnect: () => void;
} {
  portName = name;
  shared.listeners.add(onMessage);
  shared.alive = true;
  shared.attempts = 0;
  void attach();

  return {
    send: (msg) => {
      // Only the preview page sends immediately after connectSidebar(). Keep the
      // sidebar's existing retry/oversize handling untouched.
      if (!shared.port && shared.attaching && portName === "preview") {
        shared.pending.push(msg);
        return;
      }
      const first = postTo(shared.port, msg);
      if (first.ok) return;
      if (first.tooLarge) {
        // This payload (usually a whole `ui.state.set` for a very large history) can never
        // fit the 64MiB port limit. Reconnecting and retrying would fail the same way and
        // leak one more port, so keep the channel alive and drop just this message.
        console.warn("opensider: dropped an oversized panel message", first.error);
        if (shared.alive && !shared.port) void attach();
        return;
      }
      if (first.error) {
        emit({ type: "status", state: "error", error: first.error });
      }
      void attach().then(() => {
        const retry = postTo(shared.port, msg);
        if (!retry.ok && retry.error && !retry.tooLarge) {
          emit({ type: "status", state: "error", error: retry.error });
        }
      });
    },
    reconnect: () => {
      shared.alive = true;
      shared.attempts = 0;
      teardown();
      shared.closedByUs = false;
      void attach();
      connectNativeHost();
    },
    disconnect: () => {
      shared.listeners.delete(onMessage);
    },
  };
}
