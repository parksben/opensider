import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARCHIVE_AFTER_MS,
  estimateSessionBytes,
  pickSessionsToArchive,
} from "./archive.ts";
import type { Session } from "./persist.ts";

function session(id: string, patch: Partial<Session> = {}): Session {
  return {
    id,
    title: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [{ id: `${id}-m`, role: "user", content: [{ type: "text", text: "hi" }], createdAt: new Date() }],
    todos: [],
    artifacts: [],
    ...patch,
  };
}

const NOW = Date.parse("2026-11-12T00:00:00.000Z");

describe("session archiving", () => {
  it("archives sessions that have been idle past the retention window", () => {
    const old = session("old", { updatedAt: new Date(NOW - ARCHIVE_AFTER_MS - 1).toISOString() });
    const fresh = session("fresh", { updatedAt: new Date(NOW - 1000).toISOString() });
    assert.deepEqual(pickSessionsToArchive({ sessions: [old, fresh], now: NOW }), ["old"]);
  });

  it("never archives the selected, pinned, running, already archived or empty sessions", () => {
    const stamp = new Date(NOW - ARCHIVE_AFTER_MS - 1).toISOString();
    const sessions = [
      session("selected", { updatedAt: stamp }),
      session("pinned", { updatedAt: stamp, pinnedAt: stamp }),
      session("running", { updatedAt: stamp }),
      session("archived", { updatedAt: stamp, archivedAt: stamp }),
      session("empty", { updatedAt: stamp, messages: [] }),
      session("candidate", { updatedAt: stamp }),
    ];
    const picked = pickSessionsToArchive({
      sessions,
      now: NOW,
      selectedId: "selected",
      runningIds: new Set(["running"]),
    });
    assert.deepEqual(picked, ["candidate"]);
  });

  it("archives oldest first until the state falls under the target size", () => {
    const big = (id: string, updatedAt: string) =>
      session(id, {
        updatedAt,
        messages: [
          {
            id: `${id}-m`,
            role: "user",
            content: [{ type: "text", text: "x".repeat(1_000_000) }],
            createdAt: new Date(),
          },
        ],
      });
    const sessions = [
      big("oldest", "2026-11-01T00:00:00.000Z"),
      big("middle", "2026-11-05T00:00:00.000Z"),
      big("newest", "2026-11-10T00:00:00.000Z"),
    ];
    const picked = pickSessionsToArchive({
      sessions,
      now: NOW,
      selectedId: "newest",
      afterMs: Number.POSITIVE_INFINITY,
      budgetBytes: 2_500_000,
      targetBytes: 1_500_000,
    });
    assert.deepEqual(picked, ["oldest", "middle"]);
    assert.ok(estimateSessionBytes(sessions[0]) > 1_000_000);
  });

  it("leaves a small state alone", () => {
    const sessions = [
      session("a", { updatedAt: new Date(NOW - 1000).toISOString() }),
      session("b", { updatedAt: new Date(NOW - 2000).toISOString() }),
    ];
    assert.deepEqual(pickSessionsToArchive({ sessions, now: NOW }), []);
  });
});
