import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toolFinished } from "./tool-status.ts";

/** A tool call as an agent would send it, with only the fields under test filled in. */
function tool(over: Record<string, unknown> = {}) {
  return {
    type: "tool-call" as const,
    toolCallId: "t1",
    toolName: "read",
    args: {},
    ...over,
  };
}

describe("toolFinished", () => {
  it("counts a tool with a result as finished, whatever `status` says", () => {
    // The whole point: agents (Cursor / Copilot / OpenCode) often emit a result and leave
    // `status` at its default `"pending"`. Reading `status` alone spins those cards
    // forever, and makes a whole run look like it is still going.
    assert.equal(toolFinished(tool({ result: "done" })), true);
    assert.equal(toolFinished(tool({ result: "done", status: "pending" })), true);
    assert.equal(toolFinished(tool({ result: "done", status: "in_progress" })), true);
    // An error is a finished tool that failed, not one still in flight.
    assert.equal(toolFinished(tool({ result: "boom", status: "failed" })), true);
  });

  it("counts an explicitly completed / failed tool with no result as finished", () => {
    assert.equal(toolFinished(tool({ status: "completed" })), true);
    assert.equal(toolFinished(tool({ status: "failed" })), true);
  });

  it("keeps a tool with nothing back as still running", () => {
    assert.equal(toolFinished(tool()), false);
    assert.equal(toolFinished(tool({ status: "pending" })), false);
    assert.equal(toolFinished(tool({ status: "in_progress" })), false);
  });

  it("does not treat streaming progress content as a result", () => {
    // ACP streams `content` blocks (diffs, terminal text) while a tool runs; they are not
    // the result, and treating them as one would close the card mid-stream.
    assert.equal(toolFinished(tool({ content: [{ type: "text", text: "partial" }] })), false);
  });

  it("treats an empty result as still running", () => {
    // An agent that opens a result slot but fills nothing has not said anything yet.
    assert.equal(toolFinished(tool({ result: "" })), false);
    assert.equal(toolFinished(tool({ result: null })), false);
  });
});
