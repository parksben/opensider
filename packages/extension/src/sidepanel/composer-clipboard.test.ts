// 「全选整个输入框时把附件栏一起带过去」的纯逻辑：载荷不进剪贴板，而是扩展自己记住一小段时间，
// 等一次内容完全一致的粘贴再还原附件（Chromium 的系统剪贴板不保留自定义 MIME，且会泄漏标记）。
// coversWholeEditor 需要 DOM，由 scripts/verify-composer-clipboard.mjs 在真浏览器里覆盖。
import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_ATTACHMENT_KINDS,
  COMPOSER_CARRY_TTL_MS,
  COMPOSER_CARRY_VERSION,
  MAX_CARRIED_ATTACHMENTS,
  composerCarryMatches,
  decodeComposerCarry,
  encodeComposerCarry,
  mergeAttachmentItems,
  normalizeComposerText,
} from "./composer-clipboard.ts";
import { ATTACHMENT_KINDS } from "../../../shared/src/protocol.ts";

const item = (path: string, kind = "file") => ({ path, name: path.split("/").pop(), kind });
const carry = (overrides = {}) => ({ text: "draft text", attachments: [item("/tmp/a.txt")], at: 1_000, ...overrides });

test("kinds we accept match the shared protocol", () => {
  assert.deepEqual([...COMPOSER_ATTACHMENT_KINDS], [...ATTACHMENT_KINDS], "kind lists drifted apart");
  assert.equal(COMPOSER_CARRY_VERSION, 1);
});

test("a round trip keeps text, time and attachments", () => {
  const source = carry({ attachments: [item("/tmp/photo.png", "image"), { ...item("/tmp/src", "folder"), missing: true }] });
  assert.deepEqual(decodeComposerCarry(encodeComposerCarry(source)), {
    at: 1_000,
    text: "draft text",
    attachments: [item("/tmp/photo.png", "image"), item("/tmp/src", "folder")],
  });
});

test("a foreign or broken payload decodes to nothing", () => {
  for (const raw of ["", undefined, "not json", "[]", JSON.stringify({ v: 2, at: 1, text: "x", attachments: [item("/tmp/a")] })]) {
    assert.equal(decodeComposerCarry(raw), undefined, String(raw));
  }
  assert.equal(decodeComposerCarry(JSON.stringify({ v: 1, at: 1, text: "x", attachments: [] })), undefined);
  assert.equal(decodeComposerCarry(JSON.stringify({ v: 1, at: "soon", text: "x", attachments: [item("/tmp/a")] })), undefined);
  // Bad entries are dropped, valid neighbours survive.
  const mixed = JSON.stringify({ v: 1, at: 1, text: "x", attachments: [item("/tmp/ok"), null, { path: 7 }] });
  assert.deepEqual(decodeComposerCarry(mixed)?.attachments, [item("/tmp/ok")]);
});

test("a huge payload is capped", () => {
  const many = Array.from({ length: MAX_CARRIED_ATTACHMENTS + 20 }, (_, index) => item(`/tmp/f${index}`));
  assert.equal(decodeComposerCarry(encodeComposerCarry(carry({ attachments: many })))?.attachments.length, MAX_CARRIED_ATTACHMENTS);
});

test("only a paste of exactly that text restores the attachments", () => {
  const remembered = carry();
  assert.equal(composerCarryMatches(remembered, "draft text", 1_100), true);
  assert.equal(composerCarryMatches(remembered, "  draft\n text ", 1_100), true, "whitespace is normalised");
  assert.equal(composerCarryMatches(remembered, "draft", 1_100), false, "partial selection");
  assert.equal(composerCarryMatches(remembered, "draft text plus more", 1_100), false);
  assert.equal(composerCarryMatches(undefined, "draft text", 1_100), false);
  assert.equal(composerCarryMatches(carry({ attachments: [] }), "draft text", 1_100), false);
});

test("a stale copy stops matching", () => {
  const remembered = carry();
  assert.equal(composerCarryMatches(remembered, "draft text", remembered.at + COMPOSER_CARRY_TTL_MS), true);
  assert.equal(composerCarryMatches(remembered, "draft text", remembered.at + COMPOSER_CARRY_TTL_MS + 1), false);
  assert.equal(composerCarryMatches(remembered, "draft text", remembered.at - 1), false, "clock went backwards");
});

test("an attachments-only draft only matches a paste that brought no text", () => {
  const remembered = carry({ text: "" });
  assert.equal(composerCarryMatches(remembered, "", 1_100), true);
  assert.equal(composerCarryMatches(remembered, "hello", 1_100), false);
});

test("text normalisation makes select-all comparisons stable", () => {
  assert.equal(normalizeComposerText("draft text"), "draft text");
  assert.equal(normalizeComposerText("  draft\n text \n"), "draft text");
  assert.equal(normalizeComposerText("draft\u00a0text"), "draft text");
  assert.equal(normalizeComposerText("\n\n"), "");
  // A chip's rendered name has to survive, since that is what both sides show.
  assert.equal(normalizeComposerText("notes.txt\n"), "notes.txt");
});

test("merging keeps order and never duplicates a path", () => {
  const current = [item("/tmp/a"), item("/tmp/b")];
  const merged = mergeAttachmentItems(current, [item("/tmp/b"), item("/tmp/c")]);
  assert.deepEqual(merged.map((entry) => entry.path), ["/tmp/a", "/tmp/b", "/tmp/c"]);
  assert.deepEqual(mergeAttachmentItems(current, []), current);
});
