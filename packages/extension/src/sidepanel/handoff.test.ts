import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHandoffPrompt, handoffCutoff } from "./handoff.ts";
import { groupModelsByPrefix, modelShortName } from "./model-groups.ts";

describe("model groups", () => {
  it("turns the text before / into a heading and keeps the rest as the label", () => {
    const groups = groupModelsByPrefix([
      { name: "OpenCode Zen/Big Pickle" },
      { name: "OpenCode Zen/Ling 3.0 Flash" },
      { name: "StepCode (Anthropic)" },
    ]);
    assert.deepEqual(
      groups.map((group) => ({ label: group.label, names: group.items.map((item) => modelShortName(item.name)) })),
      [
        { label: "OpenCode Zen", names: ["Big Pickle", "Ling 3.0 Flash"] },
        { label: "", names: ["StepCode (Anthropic)"] },
      ],
    );
  });
});

describe("handoff prompt", () => {
  it("points at the session file and stops before the next round", () => {
    const cut = handoffCutoff(
      [
        { id: "u1", role: "user" },
        { id: "a1", role: "assistant" },
        { id: "u2", role: "user" },
      ],
      "a1",
    );
    assert.ok(cut);
    assert.equal(cut.beforeRound, 2);
    const prompt = buildHandoffPrompt({
      locale: "zh",
      statePath: "/tmp/ui-state.json",
      sessionId: "sess",
      ...cut,
    });
    assert.match(prompt, /请接着这个会话继续/);
    assert.match(prompt, /如果读不到，请告诉我，我会把记录贴过来/);
    assert.match(prompt, /\/tmp\/sessions\/sess\.json/);
    assert.match(prompt, /type 为 text/);
    assert.match(prompt, /只看第 2 轮之前/);
    assert.doesNotMatch(prompt, /VS Code|OpenSider|ui-state\.json/);
    assert.doesNotMatch(prompt, /在 sessions 里找/);
    assert.doesNotMatch(prompt, /User: /);
  });

  it("uses the same generic wording in English", () => {
    const prompt = buildHandoffPrompt({
      locale: "en",
      statePath: "/tmp/ui-state.json",
      sessionId: "sess",
      beforeRound: 2,
      throughMessageId: "a1",
    });
    assert.match(prompt, /Continue this conversation/);
    assert.match(prompt, /if not, tell me and I will paste the transcript/);
    assert.match(prompt, /\/tmp\/sessions\/sess\.json/);
    assert.doesNotMatch(prompt, /VS Code|OpenSider|ui-state\.json/);
  });
});
