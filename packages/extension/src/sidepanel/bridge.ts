import type { ExtToHost, HostToExt } from "@shared";

export function connectSidebar(onMessage: (msg: HostToExt) => void): {
  send: (msg: ExtToHost) => void;
  reconnect: () => void;
  disconnect: () => void;
} {
  let port: chrome.runtime.Port | null = null;
  let closedByUs = false;

  const attach = () => {
    closedByUs = false;
    port = chrome.runtime.connect({ name: "sidebar" });
    port.onMessage.addListener((msg: HostToExt) => onMessage(msg));
    port.onDisconnect.addListener(() => {
      if (closedByUs) return;
      port = null;
      const error = chrome.runtime.lastError?.message ?? "Lost connection to the extension service worker.";
      onMessage({ type: "status", state: "error", error });
    });
  };

  attach();

  return {
    send: (msg) => port?.postMessage(msg),
    reconnect: () => {
      closedByUs = true;
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
      port = null;
      chrome.runtime.sendMessage({ type: "reconnect" }).catch(() => undefined);
      attach();
    },
    disconnect: () => {
      closedByUs = true;
      try {
        port?.disconnect();
      } catch {
        // ignore
      }
      port = null;
    },
  };
}
