import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { countSelection, overSelectionLimit, MAX_CJK_CHARS, MAX_WORDS } from "./selection-limit.ts";

const chinese = (count: number) => "字".repeat(count);
const english = (count: number) => Array.from({ length: count }, (_, index) => `word${index}`).join(" ");

describe("selection limit", () => {
  it("counts CJK characters and whitespace-separated words separately", () => {
    assert.deepEqual(countSelection("你好世界"), { cjk: 4, words: 0 });
    assert.deepEqual(countSelection("hello world"), { cjk: 0, words: 2 });
    assert.deepEqual(countSelection("你好 hello"), { cjk: 2, words: 1 });
  });

  it("lets exactly the budget through and rejects one step over", () => {
    assert.equal(overSelectionLimit(chinese(MAX_CJK_CHARS)), false);
    assert.equal(overSelectionLimit(chinese(MAX_CJK_CHARS + 1)), true);
    assert.equal(overSelectionLimit(english(MAX_WORDS)), false);
    assert.equal(overSelectionLimit(english(MAX_WORDS + 1)), true);
  });

  it("shares the budget when the selection mixes both", () => {
    // 一半中文额度 + 一半英文额度：刚好放行。
    assert.equal(overSelectionLimit(`${chinese(250)} ${english(100)}`), false);
    // 中文已经用满，再多的英文词就超了。
    assert.equal(overSelectionLimit(`${chinese(MAX_CJK_CHARS)} ${english(1)}`), true);
  });

  it("does not count punctuation or emoji as words", () => {
    assert.equal(overSelectionLimit("！！！ ？？？ 🙂🙂"), false);
    assert.deepEqual(countSelection("！！！ 🙂"), { cjk: 0, words: 0 });
  });

  it("a short two-line English paragraph is nowhere near the limit", () => {
    const paragraph =
      "OpenSider is a browser extension that drives local Agents (Claude Code, Codex, " +
      "OpenCode, Cursor and other local Agent CLIs that speak ACP) from within your browser " +
      "for web information gathering, web automation, and more.";
    assert.equal(countSelection(paragraph).words, 34);
    assert.equal(overSelectionLimit(paragraph), false);
  });
});
