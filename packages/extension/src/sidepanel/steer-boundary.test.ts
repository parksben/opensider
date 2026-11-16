import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { IDLE_STEER_BOUNDARY, steerBoundaryStep, type SteerBoundaryState } from "./steer-boundary.ts";

const text = { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } };
const toolStart = { sessionUpdate: "tool_call", status: "in_progress", toolCallId: "t1" };
const toolDone = { sessionUpdate: "tool_call_update", status: "completed", toolCallId: "t1" };
const toolFailed = { sessionUpdate: "tool_call_update", status: "failed", toolCallId: "t2" };
const thoughts = { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } };

const armed: SteerBoundaryState = { armed: true, boundary: false };

describe("steerBoundaryStep", () => {
  it("ignores everything until the steer is acknowledged", () => {
    let state = IDLE_STEER_BOUNDARY;
    for (const update of [text, toolDone, text]) {
      const step = steerBoundaryStep(state, update);
      state = step.state;
      assert.equal(step.consumed, false);
    }
  });

  it("keeps the answer above the message until a tool batch finishes", () => {
    // 正在流的正文、开始执行的工具，都还不算「读到了」。
    for (const update of [text, thoughts, toolStart]) {
      const step = steerBoundaryStep(armed, update);
      assert.equal(step.consumed, false);
    }
  });

  it("consumes on the first text after a finished tool call", () => {
    const afterTool = steerBoundaryStep(armed, toolDone);
    assert.equal(afterTool.state.boundary, true);
    const afterText = steerBoundaryStep(afterTool.state, text);
    assert.equal(afterText.consumed, true);
    assert.deepEqual(afterText.state, IDLE_STEER_BOUNDARY);
  });

  it("treats a failed tool as a boundary too (the batch is over either way)", () => {
    const afterTool = steerBoundaryStep(armed, toolFailed);
    assert.equal(steerBoundaryStep(afterTool.state, thoughts).consumed, false);
    assert.equal(steerBoundaryStep(afterTool.state, text).consumed, true);
  });

  it("waits for text, not for another tool call", () => {
    const afterTool = steerBoundaryStep(armed, toolDone);
    const anotherTool = steerBoundaryStep(afterTool.state, toolDone);
    assert.equal(anotherTool.consumed, false);
    assert.equal(anotherTool.state.boundary, true);
    assert.equal(steerBoundaryStep(anotherTool.state, text).consumed, true);
  });

  it("never fires twice for one acknowledgement", () => {
    const consumed = steerBoundaryStep(steerBoundaryStep(armed, toolDone).state, text);
    assert.equal(consumed.consumed, true);
    assert.equal(steerBoundaryStep(consumed.state, toolDone).consumed, false);
    assert.equal(steerBoundaryStep(consumed.state, text).consumed, false);
  });
});
