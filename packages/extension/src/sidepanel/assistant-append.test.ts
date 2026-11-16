import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lastAssistant } from "./assistant-append.ts";
import type { ChatMessage } from "./chat-types.ts";

const user = (text: string, flags: Partial<ChatMessage> = {}): ChatMessage => ({
  id: `u-${text}`,
  role: "user",
  content: [{ type: "text", text }],
  createdAt: new Date(),
  ...flags,
});

const assistant = (id: string, text: string, durationMs?: number): ChatMessage => ({
  id,
  role: "assistant",
  content: [{ type: "text", text }],
  createdAt: new Date(),
  durationMs,
});

describe("lastAssistant", () => {
  it("keeps writing into the running answer while a steer is not picked up yet", () => {
    const messages = [user("first"), assistant("a1", "working"), user("steer", { awaitingSteer: true })];
    const next = lastAssistant(messages);
    assert.equal(next.messages.length, 3, "no new bubble below the unread message");
    assert.equal(next.index, 1);
  });

  it("keeps writing into the running answer while a message is held for the next turn", () => {
    const messages = [user("first"), assistant("a1", "working"), user("held", { pending: true })];
    const next = lastAssistant(messages);
    assert.equal(next.messages.length, 3);
    assert.equal(next.index, 1);
  });

  it("starts a new answer below the message once the Agent accepted it", () => {
    const messages = [user("first"), assistant("a1", "working"), user("steer", { awaitingSteer: false })];
    const next = lastAssistant(messages);
    assert.equal(next.messages.length, 4);
    assert.equal(next.index, 3);
    assert.equal(next.messages[3].role, "assistant");
  });

  it("appends after an answer that already follows an accepted steer", () => {
    const messages = [
      user("first"),
      assistant("a1", "before"),
      user("steer", { awaitingSteer: false }),
      assistant("a2", "after"),
      user("held", { pending: true }),
    ];
    const next = lastAssistant(messages);
    assert.equal(next.messages.length, 5);
    assert.equal(next.index, 3);
  });

  it("never grows a settled answer", () => {
    const messages = [user("first"), assistant("a1", "done", 1200), user("steer", { awaitingSteer: true })];
    const next = lastAssistant(messages);
    assert.equal(next.messages.length, 4);
    assert.equal(next.messages[1].content[0].text, "done");
  });

  it("creates the first answer when the turn has none yet", () => {
    const next = lastAssistant([user("first")]);
    assert.equal(next.messages.length, 2);
    assert.equal(next.messages[1].role, "assistant");
  });
});
