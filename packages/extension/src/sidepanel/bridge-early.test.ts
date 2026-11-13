import assert from "node:assert/strict";
import { test } from "node:test";

type Listener = (msg: unknown) => void;

class FakePort {
  readonly posted: unknown[] = [];
  onMessage = { addListener: (_fn: Listener) => undefined };
  onDisconnect = { addListener: (_fn: () => void) => undefined };
  postMessage(msg: unknown): void {
    this.posted.push(msg);
  }
  disconnect(): void {}
}

test("a preview request sent while attach() is still pending is delivered once", async () => {
  const ports: FakePort[] = [];
  let release: ((value: unknown) => void) | undefined;
  (globalThis as { chrome?: unknown }).chrome = {
    runtime: {
      connect: () => {
        const port = new FakePort();
        ports.push(port);
        return port;
      },
      sendMessage: () => new Promise((resolve) => { release = resolve; }),
      lastError: undefined,
    },
  };
  const { connectSidebar } = await import("./bridge.ts");
  const { send } = connectSidebar(() => undefined, "preview");
  send({ type: "fs.read", requestId: "r1", path: "/tmp/plan.md" });

  assert.equal(ports.length, 0, "attach has not resolved yet");
  release?.({ ok: true });
  for (let i = 0; i < 5 && ports.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.equal(ports.length, 1);
  assert.deepEqual(ports[0].posted, [{ type: "fs.read", requestId: "r1", path: "/tmp/plan.md" }]);
});
