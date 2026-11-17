import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ChatMessage } from "./chat-types.ts";
import { browserToolId, browserUpdateAccepted } from "./tool-presence.ts";

/** A settled assistant message: `durationMs` is what `turn.end` stamps on it. */
function settled(parts: ChatMessage["content"] = [{ type: "text", text: "the answer" }]): ChatMessage {
  return {
    id: "a1",
    role: "assistant",
    createdAt: new Date(),
    durationMs: 7000,
    content: parts,
  };
}

describe("browserUpdateAccepted", () => {
  it("drops a late command once the turn has settled", () => {
    // `navigate` / `runScript` fired at the end of a turn come back after `turn.end`. Writing
    // one then can only create a new assistant message — the extra 「已执行」 bubble.
    assert.equal(browserUpdateAccepted([settled()], browserToolId("c1"), false), false);
  });

  it("accepts anything while the turn is still running", () => {
    assert.equal(browserUpdateAccepted([settled()], browserToolId("c1"), true), true);
  });

  it("still updates a card that is already on screen", () => {
    // The result of a command the user can already see belongs on that card, even though the
    // turn has finished around it.
    const withTool: ChatMessage[] = [
      settled([{ type: "tool-call", toolCallId: browserToolId("c1"), toolName: "navigate", args: {}, status: "in_progress" }]),
    ];
    assert.equal(browserUpdateAccepted(withTool, browserToolId("c1"), false), true);
  });

  it("keys the command and its result to the same id", () => {
    assert.equal(browserToolId("abc"), "browser:abc");
    assert.notEqual(browserToolId("abc"), browserToolId("abd"));
  });
});
