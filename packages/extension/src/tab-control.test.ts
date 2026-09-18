import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  BLOCK_MS,
  CONTROL_TTL_MS,
  PENDING_TTL_MS,
  anchorFor,
  blockPair,
  clearBlock,
  clearPending,
  emptyControl,
  entryForTab,
  isBlocked,
  isRemembered,
  parkSession,
  parseControl,
  policyAutoApproves,
  primaryTabFor,
  pruneControl,
  releaseSession,
  releaseTab,
  rememberOrigin,
  rememberTrusted,
  setAnchor,
  setPending,
  setTarget,
  takeover,
  tabsForSession,
  targetFor,
  touch,
} from "./tab-control.ts";

describe("tab-control store", () => {
  it("only the auto / unattended modes hand a tab over without a card", () => {
    assert.equal(policyAutoApproves("auto"), true);
    assert.equal(policyAutoApproves("unattended"), true);
    assert.equal(policyAutoApproves("ask"), false);
    assert.equal(policyAutoApproves("workspace"), false);
    assert.equal(policyAutoApproves("something-else"), false);
    assert.equal(policyAutoApproves(undefined), false);
  });

  it("hands a tab to one session at a time", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    assert.equal(entryForTab(state, 10)?.sessionId, "s1");

    takeover(state, "s2", 10, 2_000);
    assert.equal(entryForTab(state, 10)?.sessionId, "s2");
    assert.equal(state.entries.length, 1);
  });

  it("lists a session's tabs most recently used first", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    takeover(state, "s1", 11, 2_000);
    touch(state, 10, 3_000);
    assert.equal(primaryTabFor(state, "s1"), 10);
    assert.deepEqual(
      tabsForSession(state, "s1").map((entry) => entry.tabId),
      [10, 11],
    );
  });

  it("releases a tab or a whole session and forgets the session anchor", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    takeover(state, "s1", 11, 1_000);
    takeover(state, "s2", 12, 1_000);
    setAnchor(state, "s1", 10);
    setTarget(state, "s1", 11);
    assert.equal(releaseTab(state, 10), "s1");
    assert.equal(entryForTab(state, 10), undefined);
    assert.deepEqual(releaseSession(state, "s1").sort(), [11]);
    assert.equal(anchorFor(state, "s1"), undefined);
    assert.equal(targetFor(state, "s1"), undefined);
    assert.equal(entryForTab(state, 12)?.sessionId, "s2");
  });

  it("follows the target tab and forgets it when the tab goes away", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    setTarget(state, "s1", 10);
    assert.equal(targetFor(state, "s1"), 10);
    releaseTab(state, 10);
    assert.equal(targetFor(state, "s1"), undefined);
  });

  it("parks holds at turn end but keeps memories, blocks and pending requests", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    takeover(state, "s1", 11, 1_000);
    setAnchor(state, "s1", 10);
    setTarget(state, "s1", 11);
    rememberOrigin(state, "s1", 11);
    rememberTrusted(state, "s1", 12);
    blockPair(state, "s1", 13, 1_000);
    setPending(state, { requestId: "r1", sessionId: "s1", tabId: 14, at: 1_000 });

    assert.deepEqual(parkSession(state, "s1").sort(), [10, 11]);
    assert.equal(entryForTab(state, 10), undefined);
    assert.equal(anchorFor(state, "s1"), undefined);
    assert.equal(targetFor(state, "s1"), undefined);
    assert.equal(isRemembered(state, "s1", 11), true);
    assert.equal(isRemembered(state, "s1", 12), true);
    assert.equal(isBlocked(state, "s1", 13, 1_000), true);
    assert.equal(state.pending?.requestId, "r1");
  });

  it("a take-back is a full reset: holds, memories and pending all go", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 1_000);
    rememberOrigin(state, "s1", 10);
    rememberTrusted(state, "s1", 11);
    setPending(state, { requestId: "r1", sessionId: "s1", tabId: 12, at: 1_000 });

    releaseSession(state, "s1");
    assert.equal(isRemembered(state, "s1", 10), false);
    assert.equal(isRemembered(state, "s1", 11), false);
    assert.equal(state.pending, null);
  });

  it("remembers a tab once, and forgets it when the tab closes", () => {
    const state = emptyControl();
    rememberOrigin(state, "s1", 10);
    rememberOrigin(state, "s1", 10);
    assert.deepEqual(state.origins.s1, [10]);
    rememberTrusted(state, "s1", 11);
    releaseTab(state, 10);
    assert.equal(isRemembered(state, "s1", 10), false);
    assert.equal("s1" in state.origins, false);
    assert.equal(isRemembered(state, "s1", 11), true);
  });

  it("keeps a taken-back pair blocked for the cooldown only", () => {
    const state = emptyControl();
    blockPair(state, "s1", 10, 1_000);
    assert.equal(isBlocked(state, "s1", 10, 1_000 + BLOCK_MS - 1), true);
    assert.equal(isBlocked(state, "s1", 10, 1_000 + BLOCK_MS), false);
    assert.equal(isBlocked(state, "s2", 10, 1_000), false);
    clearBlock(state, "s1", 10);
    assert.equal(isBlocked(state, "s1", 10, 1_000), false);
  });

  it("prunes expired entries, blocks and requests", () => {
    const state = emptyControl();
    takeover(state, "s1", 10, 0);
    takeover(state, "s1", 11, CONTROL_TTL_MS);
    blockPair(state, "s1", 12, 0);
    setPending(state, { requestId: "r1", sessionId: "s1", tabId: 12, at: 0 });

    const result = pruneControl(state, CONTROL_TTL_MS + 10);
    assert.equal(result.changed, true);
    assert.deepEqual(result.released, [10]);
    assert.equal(entryForTab(state, 10), undefined);
    assert.equal(entryForTab(state, 11)?.sessionId, "s1");
    assert.equal(isBlocked(state, "s1", 12, CONTROL_TTL_MS + 10), false);
    assert.equal(state.pending, null);

    // A second pass with nothing stale left must not report changes.
    assert.equal(pruneControl(state, CONTROL_TTL_MS + 20).changed, false);
  });

  it("expires pending requests on their own clock", () => {
    const state = emptyControl();
    setPending(state, { requestId: "r1", sessionId: "s1", tabId: 10, at: 0 });
    assert.equal(pruneControl(state, PENDING_TTL_MS - 1).changed, false);
    assert.equal(pruneControl(state, PENDING_TTL_MS).changed, true);
    assert.equal(state.pending, null);
  });

  it("clears pending only for the matching request", () => {
    const state = emptyControl();
    setPending(state, { requestId: "r1", sessionId: "s1", tabId: 10, at: 0 });
    assert.equal(clearPending(state, "other"), null);
    assert.equal(state.pending?.requestId, "r1");
    assert.equal(clearPending(state, "r1")?.requestId, "r1");
    assert.equal(state.pending, null);
  });

  it("parses a snapshot tolerantly", () => {
    assert.deepEqual(parseControl(undefined), emptyControl());
    assert.deepEqual(parseControl("junk"), emptyControl());
    assert.deepEqual(parseControl({ entries: "junk" }), emptyControl());

    const state = parseControl({
      entries: [
        { sessionId: "s1", tabId: 10, startedAt: 1, lastUsedAt: 2 },
        { sessionId: "s1" },
        null,
      ],
      anchors: { s1: 10, s2: "junk" },
      targets: { s1: 11, s2: "junk" },
      origins: { s1: [10, "junk"], s2: "junk" },
      trusted: { s1: [12, 12] },
      blocked: { "s1:12": 5, "s1:13": "junk" },
      pending: { requestId: "r1", sessionId: "s1", tabId: 12 },
    });
    assert.deepEqual(
      state.entries.map((entry) => entry.tabId),
      [10],
    );
    assert.equal(state.anchors.s1, 10);
    assert.equal("s2" in state.anchors, false);
    assert.equal(state.targets.s1, 11);
    assert.equal("s2" in state.targets, false);
    assert.deepEqual(state.origins.s1, [10]);
    assert.equal("s2" in state.origins, false);
    assert.deepEqual(state.trusted.s1, [12]);
    assert.equal(state.blocked["s1:12"], 5);
    assert.equal("s1:13" in state.blocked, false);
    assert.equal(state.pending?.requestId, "r1");
  });
});
