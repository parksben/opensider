import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTROL_MARKS, controlMarkFor, createControlMark, stripControlMark } from "./control-badge.ts";

describe("control mark", () => {
  it("uses the Chinese label for Chinese browsers and the English one otherwise", () => {
    assert.equal(controlMarkFor("zh-CN"), "[接管中] ");
    assert.equal(controlMarkFor("zh"), "[接管中] ");
    assert.equal(controlMarkFor("zh_Hans"), "[接管中] ");
    assert.equal(controlMarkFor("en-US"), "[Agent] ");
    assert.equal(controlMarkFor(""), "[Agent] ");
  });

  it("strips either locale's mark, and only a mark", () => {
    assert.equal(stripControlMark("[接管中] Web form"), "Web form");
    assert.equal(stripControlMark("[Agent] Web form"), "Web form");
    assert.equal(stripControlMark("Web form"), "Web form");
    assert.equal(stripControlMark(""), "");
    for (const mark of CONTROL_MARKS) assert.equal(stripControlMark(mark), "");
  });

  it("adds the mark once and removes exactly what it added", () => {
    const doc = { title: "Web form" } as unknown as Document;
    const mark = createControlMark(doc);
    mark.set(true);
    assert.equal(doc.title, "[Agent] Web form");
    mark.set(true);
    assert.equal(doc.title, "[Agent] Web form");
    assert.equal(mark.read(), true);
    mark.set(false);
    assert.equal(doc.title, "Web form");
    assert.equal(mark.read(), false);
  });

  it("leaves a mark-like prefix that the page had on its own", () => {
    const doc = { title: "[Agent] own label" } as unknown as Document;
    const mark = createControlMark(doc);
    mark.set(true);
    mark.set(false);
    assert.equal(doc.title, "[Agent] own label");
  });
});
