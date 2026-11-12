import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cardBelongsToSession, sessionAcpIds } from "./session-ids.ts";

describe("handoff cards are scoped to their session", () => {
  it("collects the current and per-agent bindings", () => {
    assert.deepEqual(
      sessionAcpIds({ acpSessionId: "ses_a", acpByProvider: { copilot: "ses_b", opencode: "ses_c" } }),
      ["ses_a", "ses_b", "ses_c"],
    );
  });

  it("matches the current ACP session", () => {
    assert.equal(cardBelongsToSession({ acpSessionId: "ses_a" }, "ses_a"), true);
    assert.equal(cardBelongsToSession({ acpSessionId: "ses_a" }, "ses_b"), false);
  });

  it("also matches a binding remembered for another agent", () => {
    const item = { acpSessionId: "ses_a", acpByProvider: { copilot: "ses_b" } };
    assert.equal(cardBelongsToSession(item, "ses_b"), true);
  });

  it("shows unattributed cards in whichever conversation is open", () => {
    assert.equal(cardBelongsToSession({ acpSessionId: "ses_a" }, undefined), true);
  });
});
