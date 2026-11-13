import assert from "node:assert/strict";
import test from "node:test";
import type { ChatMessage } from "./chat-types.ts";
import { nextStage, stageVisible } from "./turn-stage.ts";

function message(id: string, role: "user" | "assistant", durationMs?: number): ChatMessage {
  return { id, role, content: [], createdAt: new Date("2026-01-01T00:00:00Z"), durationMs };
}
const stageOf = (messages: ChatMessage[], isRunning: boolean, current?: { sessionId: string; id?: string }) => {
  const state = nextStage(current, "s1", messages, isRunning);
  return stageVisible(messages, state.id) ? state.id : undefined;
};

test("a live assistant turn is staged as soon as it starts streaming", () => {
  const messages = [message("u1", "user"), message("a1", "assistant")];
  assert.equal(stageOf(messages, true), "a1");
});

test("a finished turn stays staged until the next user message", () => {
  const finished = [message("u1", "user"), message("a1", "assistant", 1200)];
  const sticky = { sessionId: "s1", id: "a1" };
  assert.equal(stageOf(finished, false, sticky), "a1");

  const nextTurn = [...finished, message("u2", "user")];
  assert.equal(stageOf(nextTurn, false, sticky), undefined);
});

test("the next streamed turn takes over the stage", () => {
  const messages = [
    message("u1", "user"),
    message("a1", "assistant", 1200),
    message("u2", "user"),
    message("a2", "assistant"),
  ];
  assert.equal(stageOf(messages, true, { sessionId: "s1", id: "a1" }), "a2");
});

test("a panel opened on finished history does not stage an old turn", () => {
  const withDuration = [message("u1", "user"), message("a1", "assistant", 1200)];
  assert.equal(stageOf(withDuration, false), undefined);

  // A turn that finished while the panel was closed never got durationMs; it is not live.
  const unstamped = [message("u1", "user"), message("a1", "assistant")];
  assert.equal(stageOf(unstamped, false), undefined);
});

test("a forked session does not inherit the copied turn's stage", () => {
  const copy = [message("u1", "user"), message("a1", "assistant", 1200)];
  const state = nextStage({ sessionId: "s1", id: "a1" }, "fork-1", copy, false);
  assert.deepEqual(state, { sessionId: "fork-1" });

  // The fork's own next live turn stages as usual.
  const live = [...copy, message("u2", "user"), message("a2", "assistant")];
  assert.equal(stageOf(live, true, state), "a2");
});

test("a staged message that was edited away is no longer visible", () => {
  const messages = [message("u1", "user"), message("a2", "assistant", 900)];
  assert.equal(stageVisible(messages, "a1"), false);
});
