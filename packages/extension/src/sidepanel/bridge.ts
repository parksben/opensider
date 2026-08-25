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
};

const shared: Shared = {
  port: null,
  listeners: new Set(),
  alive: false,
  closedByUs: false,
  attaching: false,
  reconnectTimer: undefined,
  attempts: 0,
};

function emit(msg: HostToExt): void {
  for (const listener of shared.listeners) listener(msg);
}

function safePost(port: chrome.runtime.Port | null, msg: ExtToHost): boolean {
  if (!port) return false;
  try {
    port.postMessage(msg);
    return true;
  } catch (error) {
    shared.port = null;
    emit({
      type: "status",
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
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

    const port = chrome.runtime.connect({ name: "sidebar" });
    shared.port = port;
    port.onMessage.addListener((msg: HostToExt) => {
      shared.attempts = 0;
      emit(msg);
    });
    port.onDisconnect.addListener(() => {
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
  if (shared.reconnectTimer) {
    clearTimeout(shared.reconnectTimer);
    shared.reconnectTimer = undefined;
  }
  const port = shared.port;
  shared.port = null;
  try {
    port?.disconnect();
  } catch {
    // already gone
  }
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

export function connectSidebar(onMessage: Listener): {
  send: (msg: ExtToHost) => void;
  reconnect: () => void;
  disconnect: () => void;
} {
  shared.listeners.add(onMessage);
  shared.alive = true;
  shared.attempts = 0;
  void attach();

  return {
    send: (msg) => {
      if (!safePost(shared.port, msg)) {
        void attach().then(() => {
          safePost(shared.port, msg);
        });
      }
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
