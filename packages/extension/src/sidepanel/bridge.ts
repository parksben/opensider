import type { ExtToHost, HostToExt } from "@shared";

type Listener = (msg: HostToExt) => void;

type Shared = {
  port: chrome.runtime.Port | null;
  listeners: Set<Listener>;
  refs: number;
  closedByUs: boolean;
  teardownTimer: ReturnType<typeof setTimeout> | undefined;
};

const shared: Shared = {
  port: null,
  listeners: new Set(),
  refs: 0,
  closedByUs: false,
  teardownTimer: undefined,
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

function attach(): void {
  if (shared.port) return;
  shared.closedByUs = false;
  const port = chrome.runtime.connect({ name: "sidebar" });
  shared.port = port;
  port.onMessage.addListener((msg: HostToExt) => emit(msg));
  port.onDisconnect.addListener(() => {
    shared.port = null;
    if (shared.closedByUs) return;
    const error =
      chrome.runtime.lastError?.message ?? "Lost connection to the extension service worker.";
    emit({ type: "status", state: "error", error });
  });
}

function teardown(): void {
  shared.closedByUs = true;
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

export function connectSidebar(onMessage: Listener): {
  send: (msg: ExtToHost) => void;
  reconnect: () => void;
  disconnect: () => void;
} {
  shared.listeners.add(onMessage);
  shared.refs += 1;
  if (shared.teardownTimer) {
    clearTimeout(shared.teardownTimer);
    shared.teardownTimer = undefined;
  }
  attach();

  return {
    send: (msg) => {
      if (!safePost(shared.port, msg)) {
        attach();
        safePost(shared.port, msg);
      }
    },
    reconnect: () => {
      teardown();
      attach();
      connectNativeHost();
    },
    disconnect: () => {
      shared.listeners.delete(onMessage);
      shared.refs = Math.max(0, shared.refs - 1);
      if (shared.refs > 0) return;
      if (shared.teardownTimer) clearTimeout(shared.teardownTimer);
      shared.teardownTimer = setTimeout(() => {
        shared.teardownTimer = undefined;
        if (shared.refs === 0) teardown();
      }, 200);
    },
  };
}
