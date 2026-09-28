import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHandoffPrompt } from "./handoff.ts";
import { groupModelsByPrefix, modelShortName } from "./model-groups.ts";
import { nextThreadScroll } from "./thread-follow.ts";

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
  it("tells the browser side to continue and includes the workspace", () => {
    const prompt = buildHandoffPrompt({
      locale: "zh",
      target: "browser",
      workspace: "/tmp/repo",
      turns: [
        { role: "user", text: "看一下滚动" },
        { role: "assistant", text: "已经钉住了" },
      ],
    });
    assert.match(prompt, /浏览器端 OpenSider/);
    assert.match(prompt, /工作区：\/tmp\/repo/);
    assert.match(prompt, /User: 看一下滚动/);
    assert.match(prompt, /Assistant: 已经钉住了/);
  });
});

describe("thread scroll", () => {
  it("stays at the bottom while following and pins the anchor once the user has scrolled up", () => {
    assert.equal(nextThreadScroll(true, 0, -40), null);
    assert.equal(nextThreadScroll(true, -20, -40), 0);
    assert.equal(nextThreadScroll(false, -200, -40), -240);
    assert.equal(nextThreadScroll(false, -200, 0), null);
  });
});
