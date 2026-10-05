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
      target: "vscode",
      statePath: "/tmp/ui-state.json",
      sessionId: "sess",
      ...cut,
    });
    assert.match(prompt, /VS Code 里的 OpenSider/);
    assert.match(prompt, /\/tmp\/sessions\/sess\.json/);
    assert.match(prompt, /不在 ui-state\.json/);
    assert.match(prompt, /type 为 text/);
    assert.match(prompt, /只看第 2 轮之前/);
    assert.doesNotMatch(prompt, /在 sessions 里找/);
    assert.doesNotMatch(prompt, /User: /);
  });
});
