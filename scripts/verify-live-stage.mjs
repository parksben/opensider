#!/usr/bin/env node
// Verifies the live turn's minimum-height stage:
//
//   while a turn streams, the area under the user's message reserves a stage height so the
//   message does not jitter as steps come and go; the finished turn keeps that stage until
//   the next user message, which releases it and stages the new turn instead.
//
//   node scripts/verify-live-stage.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sandbox = createSandbox({ root, prefix: "opensider-stage-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: { FAKE_ACP_STEPS: "1", FAKE_ACP_STEP_MS: "300", FAKE_ACP_TRACE: sandbox.tracePath },
});
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
    sessions: [{ id: "s1", title: "stage", createdAt: now, updatedAt: now, todos: [], artifacts: [], messages: [] }],
  });

  const panel = await context.newPage();
  panel.on("pageerror", (error) => console.log(`[panel] ${error.message}`));
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.bringToFront();
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 40_000 });

  const hostLog = join(sandbox.home, ".opensider", "host.log");
  const ready = () => existsSync(hostLog) && readFileSync(hostLog, "utf8").includes("acp runtime ready");
  // The panel's auto-connect races the first host scan in a fresh profile; a reload after
  // the scan has been cached is the same nudge the other verification scripts use.
  for (let attempt = 0; attempt < 4 && !ready(); attempt += 1) {
    for (let i = 0; i < 50 && !ready(); i += 1) await sleep(300);
    if (ready()) break;
    await panel.reload();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
  }
  ok("runtime ready", ready());
  if (!ready()) throw new Error("agent runtime did not come up");

  await composer.click();
  await panel.keyboard.type("First turn: show the stage.");
  await panel.keyboard.press("Enter");
  await panel.locator(".cs-user-bubble").first().waitFor({ state: "visible", timeout: 15_000 });
  await panel.locator(".cs-live-stage").first().waitFor({ state: "attached", timeout: 15_000 });
  ok("a stage appears as soon as the turn starts", (await panel.locator(".cs-live-stage").count()) >= 1);
  // The pending placeholder is replaced by the assistant frame once the first chunk lands;
  // measure the frame, not the detached placeholder.
  const stage = panel.locator('.cs-live-stage:not([data-live-stage="pending"])').first();
  await stage.waitFor({ state: "visible", timeout: 15_000 });
  const height = await stage.evaluate((el) => el.offsetHeight);
  ok("the stage reserves a minimum height", height >= 180, `${height}px`);

  const positions = [];
  for (let i = 0; i < 24; i += 1) {
    positions.push(await panel.evaluate(() => {
      const bubbles = [...document.querySelectorAll(".cs-user-bubble")];
      const user = bubbles[bubbles.length - 1];
      return user ? Math.round(user.getBoundingClientRect().top * 10) / 10 : null;
    }));
    await sleep(50);
  }
  const tops = positions.filter((value) => typeof value === "number");
  const spread = Math.max(...tops) - Math.min(...tops);
  ok("the user message does not jitter while the turn streams", spread <= 4, `${spread}px spread`);

  const trace = () => {
    if (!existsSync(sandbox.tracePath)) return [];
    return readFileSync(sandbox.tracePath, "utf8").split("\n").filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return {}; } });
  };
  for (let i = 0; i < 200 && !trace().some((entry) => entry.event === "end" && entry.turn === 1); i += 1) await sleep(150);
  ok("turn 1 ended", trace().some((entry) => entry.event === "end" && entry.turn === 1));
  await sleep(1200);
  ok("the finished turn keeps its stage", (await panel.locator(".cs-live-stage").count()) >= 1);

  const firstStage = await panel.locator(".cs-live-stage").first().elementHandle();
  await composer.click();
  await panel.keyboard.type("Second turn: release the old stage.");
  await panel.keyboard.press("Enter");
  await sleep(800);
  const oldStillStaged = await firstStage.evaluate((el) => el.classList.contains("cs-live-stage"));
  ok("the previous turn's stage is released by the next user message", !oldStillStaged);
  ok("the new turn has its own stage", (await panel.locator(".cs-live-stage").count()) >= 1);
} finally {
  await context.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
