#!/usr/bin/env node
// Verifies the "continue in another Agent" handoff UI:
//
//   - the assistant action uses the Bot icon and the generic label
//   - the dialog title/hint no longer names VS Code or OpenSider
//   - the generated prompt is generic and does not mention ui-state.json
//
//   node scripts/verify-continue-agent.mjs
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sandbox = createSandbox({ root, prefix: "opensider-continue-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox });
try {
  const worker = await waitForWorker(context, 60_000);
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1, savedAt: now, locale: "en", theme: "dark", selectedId: "s1",
    selectedModelId: "", selectedModelByProvider: {}, agentMode: "ask",
    selectedProviderId: "copilot", onboardingCompleted: true, sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{
      id: "s1", title: "continue", createdAt: now, updatedAt: now, todos: [], artifacts: [],
      messages: [
        { id: "u1", role: "user", createdAt: now, content: [{ type: "text", text: "hello" }] },
        { id: "a1", role: "assistant", createdAt: now, durationMs: 100, content: [{ type: "text", text: "hi there" }] },
      ],
    }],
  });

  const panel = await context.newPage();
  panel.on("pageerror", (error) => console.log(`[panel] ${error.message}`));
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.locator('[contenteditable="true"]').waitFor({ state: "visible", timeout: 40_000 });

  const frame = panel.locator("[data-thread-anchor]").last();
  await frame.hover();
  const button = panel.getByRole("button", { name: "Continue in another Agent" });
  await button.waitFor({ state: "visible", timeout: 20_000 });
  ok("the action uses the generic label", (await button.count()) === 1);
  ok("the action uses the Bot icon", (await button.locator("svg.lucide-bot").count()) === 1);

  await button.click();
  const dialog = panel.getByRole("dialog");
  await dialog.waitFor({ state: "visible", timeout: 10_000 });
  const title = dialog.getByText("Continue in another Agent", { exact: true });
  ok("the dialog title is generic", (await title.count()) === 1);
  const hint = panel.getByText("The prompt is ready. Copy it and paste it into another Agent's chat to continue.", { exact: true });
  ok("the dialog hint is generic", (await hint.count()) === 1);

  const prompt = panel.locator("pre").last();
  const text = await prompt.innerText();
  ok("the prompt asks to continue generically", /Continue this conversation/.test(text));
  ok("the prompt asks for a paste when the file is unreadable", /if not, tell me and I will paste the transcript/.test(text));
  ok("the prompt no longer names VS Code or ui-state.json", !/VS Code|ui-state\.json/.test(text));
} finally {
  await context.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
