import type { ExtToHost, HostToExt } from "@shared";

export function connectSidebar(onMessage: (msg: HostToExt) => void): {
  send: (msg: ExtToHost) => void;
  disconnect: () => void;
} {
  const port = chrome.runtime.connect({ name: "sidebar" });
  port.onMessage.addListener((msg: HostToExt) => onMessage(msg));
  return {
    send: (msg) => port.postMessage(msg),
    disconnect: () => port.disconnect(),
  };
}
