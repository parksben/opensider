import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acpToolOutput } from "./tool-content.ts";

describe("acpToolOutput", () => {
  it("unwraps the text-block wrapper Hermes sends for every tool", () => {
    // Verbatim shape from a real `terminal: ls -la` call — three levels of shell around
    // what the card should show as one line of output.
    const content = [
      { type: "content", content: { type: "text", text: "total 0\ndrwxr-xr-x  2 user  wheel  64 ." } },
    ];
    assert.equal(acpToolOutput(content), "total 0\ndrwxr-xr-x  2 user  wheel  64 .");
  });

  it("joins several text blocks in order", () => {
    const content = [
      { type: "content", content: { type: "text", text: "$ ls" } },
      { type: "content", content: { type: "text", text: "a.ts" } },
    ];
    assert.equal(acpToolOutput(content), "$ ls\na.ts");
  });

  it("accepts bare text blocks too", () => {
    assert.equal(acpToolOutput([{ type: "text", text: "done" }]), "done");
  });

  it("keeps the block list as soon as anything is not text", () => {
    // Diffs, images and resources carry structure the card should not throw away.
    const diff = { type: "diff", path: "a.ts", oldText: "a", newText: "b" };
    const content = [{ type: "content", content: { type: "text", text: "patched" } }, diff];
    assert.deepEqual(acpToolOutput(content), content);
  });

  it("passes anything unexpected straight through", () => {
    assert.equal(acpToolOutput("plain"), "plain");
    assert.equal(acpToolOutput({ type: "text", text: "x" }) instanceof Object, true);
    assert.deepEqual(acpToolOutput([]), []);
    assert.equal(acpToolOutput(undefined), undefined);
  });
});
