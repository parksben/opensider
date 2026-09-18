import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATE_CHUNK_BYTES,
  STATE_SINGLE_BYTES,
  splitStateText,
  StateChunkSink,
  utf8Length,
} from "./state-transfer.ts";

describe("utf8Length", () => {
  it("counts utf-8 bytes, not utf-16 units", () => {
    assert.equal(utf8Length("abc"), 3);
    assert.equal(utf8Length("中文"), 6);
    assert.equal(utf8Length("🙂"), 4);
    assert.equal(utf8Length("中a🙂"), 8);
  });
});

describe("splitStateText", () => {
  it("keeps a small payload in one piece", () => {
    const text = '{"version":1}';
    assert.deepEqual(splitStateText(text), [text]);
  });

  it("splits a CJK-heavy payload by bytes and rejoins losslessly", () => {
    // 中文一个码元三字节：按字符数估会低估到三分之一，这正是要防的误差。
    const text = JSON.stringify({ blob: "汉".repeat(300_000) });
    assert.ok(utf8Length(text) > STATE_SINGLE_BYTES);
    const parts = splitStateText(text);
    assert.ok(parts.length > 1, "a payload over the byte limit must be split");
    assert.equal(parts.join(""), text);
    for (const part of parts) {
      assert.ok(
        utf8Length(part) <= STATE_CHUNK_BYTES,
        `chunk of ${utf8Length(part)} bytes is over the limit`,
      );
    }
  });

  it("never cuts a surrogate pair in half", () => {
    // 把 emoji 的高代理正好铺到第一道片边界上（边界前差 2 字节）。
    const prefix = "汉".repeat(87_380) + "ab";
    const text = prefix + "🙂" + "x".repeat(STATE_SINGLE_BYTES);
    const parts = splitStateText(text);
    assert.ok(parts.length > 1);
    assert.equal(parts.join(""), text);
    for (const part of parts) {
      assert.ok(!/[\uD800-\uDBFF]$/.test(part), "a chunk ends on a lone high surrogate");
      assert.ok(!/^[\uDC00-\uDFFF]/.test(part), "a chunk starts on a lone low surrogate");
    }
  });
});

describe("StateChunkSink", () => {
  it("rejoins in-order chunks", () => {
    const sink = new StateChunkSink();
    assert.equal(sink.push(0, 2, "hello "), undefined);
    assert.equal(sink.push(1, 2, "world"), "hello world");
  });

  it("ignores a chunk that arrives without its head", () => {
    const sink = new StateChunkSink();
    assert.equal(sink.push(1, 2, "tail"), undefined);
    // 下一轮完整传输不受影响
    assert.equal(sink.push(0, 1, "whole"), "whole");
  });

  it("ignores duplicate chunks until the transfer completes", () => {
    const sink = new StateChunkSink();
    assert.equal(sink.push(0, 2, "a"), undefined);
    assert.equal(sink.push(0, 2, "a"), undefined);
    assert.equal(sink.push(1, 2, "b"), "ab");
  });

  it("rejects absurd totals", () => {
    const sink = new StateChunkSink();
    assert.equal(sink.push(0, 0, "x"), undefined);
    assert.equal(sink.push(0, 100000, "x"), undefined);
    assert.equal(sink.push(-1, 2, "x"), undefined);
    assert.equal(sink.push(5, 2, "x"), undefined);
  });
});
