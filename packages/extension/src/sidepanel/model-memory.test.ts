import assert from "node:assert/strict";
import test from "node:test";

import { adoptableCurrentId, modelForSession, withSessionModel } from "./model-memory.ts";
import type { Session } from "./persist.ts";

function session(partial: Partial<Session> = {}): Session {
  return {
    id: "s1",
    title: "",
    createdAt: "2026-10-09T00:00:00.000Z",
    updatedAt: "2026-10-09T00:00:00.000Z",
    messages: [],
    todos: [],
    ...partial,
  } as Session;
}

test("a session's own pick wins over the agent default and the fallback", () => {
  const s = session({ modelByProvider: { copilot: "gpt-5", cursor: "sonnet" } });
  assert.equal(modelForSession(s, "copilot", { copilot: "auto" }, "screen"), "gpt-5");
  assert.equal(modelForSession(s, "cursor", { copilot: "auto" }, "screen"), "sonnet");
});

test("a session with no pick falls back to that agent's remembered default", () => {
  assert.equal(modelForSession(session(), "copilot", { copilot: "opus" }, "screen"), "opus");
});

test("with nothing remembered anywhere the screen value is the fallback", () => {
  assert.equal(modelForSession(session(), "copilot", {}, "screen"), "screen");
  assert.equal(modelForSession(undefined, "copilot", {}, ""), "");
});

test("another agent's memory never leaks in", () => {
  const s = session({ modelByProvider: { cursor: "sonnet" } });
  // The copilot slot is empty: its own memory is what applies, not cursor's pick.
  assert.equal(modelForSession(s, "copilot", { cursor: "sonnet" }, ""), "");
});

test("withSessionModel records per agent without touching other slots", () => {
  const before = session({ modelByProvider: { cursor: "sonnet" } });
  const after = withSessionModel(before, "copilot", "gpt-5");
  assert.deepEqual(after.modelByProvider, { cursor: "sonnet", copilot: "gpt-5" });
  assert.deepEqual(before.modelByProvider, { cursor: "sonnet" }, "input is not mutated");
  assert.equal(withSessionModel(after, "", "x"), after, "no provider means no record");
});

test("an engine current id is only adopted when this agent advertises it", () => {
  assert.equal(adoptableCurrentId("sonnet", ["auto", "sonnet"]), "sonnet");
  assert.equal(adoptableCurrentId("gpt-5", ["auto", "sonnet"]), "");
  assert.equal(adoptableCurrentId(undefined, ["auto"]), "");
});
