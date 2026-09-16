import assert from "node:assert/strict";
import { describe, it } from "node:test";
// Relative import on purpose: these tests run under `node --test`, which does not know the
// bundler's `@shared` alias (same reason page-pick.test.ts imports "./page-pick").
import {
  DEFAULT_POLICY_MS,
  NATIVE_UI_EVENT_LIMIT,
  decideDialog,
  defaultDialogPolicy,
  isNativeUiKind,
  normalizeDialogPolicy,
  policyAnswers,
  pushEvent,
  truncateMessage,
  type NativeUiEvent,
} from "../../shared/src/native-ui.ts";

const event = (at: number): NativeUiEvent => ({ kind: "alert", message: "hi", url: "https://x.test", at });

describe("dialog policy", () => {
  it("defaults to observing, so page behaviour never changes on its own", () => {
    const policy = defaultDialogPolicy();
    assert.equal(policy.mode, "observe");
    for (const kind of ["alert", "confirm", "prompt", "file-chooser"] as const) {
      assert.deepEqual(decideDialog(policy, kind, Date.now()), { handle: false });
    }
  });

  it("garbage from the Agent falls back to the safe default", () => {
    const policy = normalizeDialogPolicy({ mode: "yes", confirm: "true", promptText: 42 }, 1_000);
    assert.equal(policy.mode, "observe");
    assert.equal(policy.confirm, false);
    assert.equal(policy.promptText, "");
    assert.equal(policy.expiresAt, undefined);
  });

  it("arms answer mode with a bounded lifetime", () => {
    const now = 1_000_000;
    const policy = normalizeDialogPolicy({ mode: "answer", confirm: true, promptText: "yes" }, now);
    assert.equal(policy.mode, "answer");
    assert.equal(policy.expiresAt, now + DEFAULT_POLICY_MS);
    assert.equal(policyAnswers(policy, now + 1), true);
    assert.equal(policyAnswers(policy, now + DEFAULT_POLICY_MS + 1), false);

    const long = normalizeDialogPolicy({ mode: "answer", expiresAt: now + 24 * 3600_000 }, now);
    assert.equal(long.expiresAt, now + 30 * 60_000, "an hour-long policy is capped at 30 minutes");

    const past = normalizeDialogPolicy({ mode: "answer", expiresAt: now - 5_000 }, now);
    assert.equal(past.expiresAt, now - 5_000, "a timestamp in the past stays in the past");
    assert.equal(policyAnswers(past, now), false);
  });

  it("answers confirm/prompt/alert/file-chooser, and never suppresses print or popups", () => {
    const now = 2_000_000;
    const policy = normalizeDialogPolicy({ mode: "answer", confirm: true, promptText: "ada" }, now);
    assert.deepEqual(decideDialog(policy, "confirm", now), { handle: true, answer: true });
    assert.deepEqual(decideDialog(policy, "prompt", now), { handle: true, answer: "ada" });
    assert.deepEqual(decideDialog(policy, "file-chooser", now), { handle: true, answer: null });
    assert.deepEqual(decideDialog(policy, "print", now), { handle: false });
    assert.deepEqual(decideDialog(policy, "popup", now), { handle: false });

    const keepAlert = normalizeDialogPolicy({ mode: "answer", alert: "observe" }, now);
    assert.deepEqual(decideDialog(keepAlert, "alert", now), { handle: false });
  });

  it("stops answering once the policy expired", () => {
    const now = 3_000_000;
    const policy = normalizeDialogPolicy({ mode: "answer", expiresAt: now - 1 }, now);
    assert.deepEqual(decideDialog(policy, "confirm", now), { handle: false });
  });
});

describe("event plumbing", () => {
  it("truncates and flattens messages for one-line display", () => {
    assert.equal(truncateMessage("a\n\n b   c"), "a b c");
    assert.equal(truncateMessage("x".repeat(400)).length, 300);
    assert.equal(truncateMessage(undefined), "");
  });

  it("keeps a bounded, newest-last list", () => {
    let list: NativeUiEvent[] = [];
    for (let i = 0; i < NATIVE_UI_EVENT_LIMIT + 12; i += 1) list = pushEvent(list, event(i));
    assert.equal(list.length, NATIVE_UI_EVENT_LIMIT);
    assert.equal(list[0].at, 12, "oldest events fall off the front");
    assert.equal(list[list.length - 1].at, NATIVE_UI_EVENT_LIMIT + 11);
  });

  it("recognises exactly the kinds the shim can produce", () => {
    assert.equal(isNativeUiKind("confirm"), true);
    assert.equal(isNativeUiKind("beforeunload"), false);
    assert.equal(isNativeUiKind(undefined), false);
  });
});
