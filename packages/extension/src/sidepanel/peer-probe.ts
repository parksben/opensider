import type { ExtToHost } from "@shared";

const waiters = new Map<string, (installed: boolean | null) => void>();

/** Completes a `peer.probe` the side panel is waiting on. `null` means the host could not say. */
export function settlePeerProbe(requestId: string, installed: boolean | null): void {
  const waiter = waiters.get(requestId);
  if (!waiter) return;
  waiters.delete(requestId);
  waiter(installed);
}

/**
 * Ask the local host whether OpenSider for VS Code is installed.
 * Resolves `null` when this host is too old to answer or never answers.
 */
export function requestPeerProbe(send: (msg: ExtToHost) => void): Promise<boolean | null> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      waiters.delete(requestId);
      resolve(null);
    }, 4000);
    waiters.set(requestId, (installed) => {
      window.clearTimeout(timer);
      resolve(installed);
    });
    send({ type: "peer.probe", requestId, target: "vscode" });
  });
}
