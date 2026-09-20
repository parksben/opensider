import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  promptMentionText,
  displayMentionText,
  mentionLabel,
  mentionTitle,
  parseMentionToken,
  parseMentionSegments,
  serializeMention,
  wrapUserMentions,
  type QuoteMention,
} from "./mentions.ts";

const quote: QuoteMention = { kind: "quote", text: "浏览器里的划词引用" };

describe("quote chip", () => {
  it("round-trips through its token", () => {
    const token = serializeMention(quote);
    assert.match(token, /^«@quote:/);
    assert.deepEqual(parseMentionToken(token), quote);
  });

  it("labels and titles with the quoted text itself", () => {
    assert.equal(mentionLabel(quote), quote.text);
    assert.equal(mentionTitle(quote), quote.text);
  });

  it("does not pretend to be an @-mention", () => {
    // 展示用文本不应带 `@`：它不是指向某个对象，就是一段原文。
    assert.equal(displayMentionText(serializeMention(quote)), quote.text);
  });

  it("survives text that looks like a token", () => {
    const tricky: QuoteMention = { kind: "quote", text: "«@tab:not json»" };
    assert.deepEqual(parseMentionToken(serializeMention(tricky)), tricky);
  });

  it("is dropped when the text is empty", () => {
    assert.equal(parseMentionToken(serializeMention({ kind: "quote", text: "" })), undefined);
  });
});

describe("promptMentionText", () => {
  it("expands a quote into a markdown blockquote", () => {
    const prompt = promptMentionText(`解释一下 ${serializeMention(quote)} 的意思`);
    assert.equal(prompt, "解释一下 > 浏览器里的划词引用 的意思");
  });

  it("quotes every line of a multiline selection", () => {
    const two = { kind: "quote" as const, text: "第一行\n第二行" };
    assert.equal(promptMentionText(serializeMention(two)), "> 第一行\n> 第二行");
  });

  it("keeps other mentions in their existing form", () => {
    const tab = {
      kind: "tab" as const,
      tabId: 7,
      title: "Example",
      url: "https://example.com",
    };
    const prompt = promptMentionText(`看 ${serializeMention(tab)} 和 ${serializeMention(quote)}`);
    assert.equal(prompt, "看 @Example 和 > 浏览器里的划词引用");
  });

  it("never leaks the internal token", () => {
    const prompt = wrapUserMentions(serializeMention(quote)).display;
    assert.ok(!prompt.includes("«"), prompt);
    assert.equal(prompt, "> 浏览器里的划词引用");
  });

  it("marks a quote as its own segment", () => {
    const segments = parseMentionSegments(`a ${serializeMention(quote)} b`);
    assert.deepEqual(
      segments.map((segment) => segment.type),
      ["text", "mention", "text"],
    );
  });
});
