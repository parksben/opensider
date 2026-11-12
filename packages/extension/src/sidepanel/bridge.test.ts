import assert from "node:assert/strict";
import { test } from "node:test";

type Listener = (msg: unknown) => void;

class FakePort {
  readonly posted: unknown[] = [];
  readonly messageListeners: Listener[] = [];
  readonly disconnectListeners: Array<() => void> = [];
  rejectNext = false;
  disconnected = false;
  onMessage = { addListener: (fn: Listener) => this.messageListeners.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => this.disconnectListeners.push(fn) };

  postMessage(msg: unknown): void {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new Error("Message exceeded maximum allowed size of 64MiB.");
    }
    this.posted.push(msg);
  }

  disconnect(): void {
    this.disconnected = true;
    for (const fn of this.disconnectListeners) fn();
  }

  deliver(msg: unknown): void {
    for (const fn of this.messageListeners) fn(msg);
  }
}

test("a rejected message retires its port instead of duplicating later updates", async () => {
  const ports: FakePort[] = [];
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      connect: () => {
        const port = new FakePort();
        ports.push(port);
        return port;
      },
      sendMessage: async () => ({ ok: true }),
      lastError: undefined,
    },
  };
  const { connectSidebar } = await import("./bridge.ts");
  const seen: unknown[] = [];
  const { send } = connectSidebar((msg) => seen.push(msg));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ports.length, 1);
  const first = ports[0];

  // A whole `ui.state.set` can exceed the 64MiB extension-port limit. The bridge must
  // disconnect that port, otherwise the service worker keeps broadcasting to it and every
  // later streaming update is applied twice (or more).
  first.rejectNext = true;
  send({ type: "ui.state.set", state: { huge: "x" } } as never);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(first.disconnected, true);
  assert.ok(ports.length >= 2, "the bridge reconnects without retrying the oversized message");
  const second = ports[ports.length - 1];

  // A late message from the retired port must not reach the panel.
  first.deliver({ type: "update", update: { sessionUpdate: "agent_message_chunk" }, sessionId: "s" });
  assert.equal(seen.length, 0);
  // The live port still delivers exactly once.
  second.deliver({ type: "update", update: { sessionUpdate: "agent_message_chunk" }, sessionId: "s" });
  assert.equal(seen.length, 1);
});
