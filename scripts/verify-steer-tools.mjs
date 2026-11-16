#!/usr/bin/env node
// Verifies the "the Agent decides when it reads your steer" contract on a turn that
// actually uses tools:
//
//   1. a long scripted turn starts (digging + tool calls)
//   2. a steer is sent while it runs -> Hermes only BUFFERS it (`/steer`), so the answer
//      keeps streaming in the SAME bubble and the message is marked "Steering"
//   3. once a tool batch finishes and the Agent starts talking again, the marker clears and
//      that output opens a NEW bubble below the message
//
// Ties the unit-tested rule in steer-boundary.ts to the real update stream.
//
//   node scripts/verify-steer-tools.mjs          # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-steertools-", dist });
const hermesStub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", "hermes-acp");
mkdirSync(dirname(hermesStub), { recursive: true });
writeFileSync(hermesStub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
chmodSync(hermesStub, 0o755);

const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  // A scripted turn: thoughts, tool calls that finish, then more text — long enough to steer.
  env: { FAKE_ACP_STEPS: "1", FAKE_ACP_STEP_MS: "150", FAKE_ACP_TRACE: sandbox.tracePath },
});

try {
  const worker = await waitForWorker(context, 60_000);
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "light",
    selectedId: "s1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{ id: "s1", title: "steer tools", createdAt: now, updatedAt: now, todos: [], artifacts: [], messages: [] }],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 620, height: 860 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByText("Ask every time").first().waitFor({ timeout: 90_000 });

  await panel.locator('button[title^="Switch agent"]').click();
  await panel.getByRole("button", { name: "Hermes", exact: true }).click();
  const cancelConnect = panel.getByRole("button", { name: /^Cancel$|^取消$/ });
  await cancelConnect.waitFor({ state: "visible", timeout: 30_000 });
  await cancelConnect.waitFor({ state: "hidden", timeout: 90_000 });

  const answers = () => panel.locator('div[class*="group/msg"]').count();
  const markers = () => panel.getByText("Steering").count();
  const answerAfterUser = () =>
    panel.evaluate(() => {
      const users = [...document.querySelectorAll(".cs-user-bubble")];
      const frames = [...document.querySelectorAll('div[class*="group/msg"]')];
      const lastUser = users[users.length - 1];
      const lastFrame = frames[frames.length - 1];
      if (!lastUser || !lastFrame) return null;
      return Boolean(lastUser.compareDocumentPosition(lastFrame) & Node.DOCUMENT_POSITION_FOLLOWING);
    });

  // 1. Start the scripted turn, then steer while it streams.
  await composer.click();
  await panel.keyboard.type("dig into the scroll bug");
  await panel.keyboard.press("Enter");
  await panel.locator('button[title^="Message send mode"]').waitFor({ state: "visible", timeout: 30_000 });
  // 切完 Agent 会话要先绑定：等第一条 prompt 真的到过 Agent，再发引导（否则它只是排队）。
  const traceText = () => (existsSync(sandbox.tracePath) ? readFileSync(sandbox.tracePath, "utf8") : "");
  for (let i = 0; i < 120 && !traceText().includes("dig into the scroll bug"); i += 1) await sleep(150);
  await composer.click();
  await panel.keyboard.type("steer while the tools run");
  await panel.keyboard.press("Enter");

  // 2. The Agent only buffers it: marked "Steering", answer still above, still one bubble.
  for (let i = 0; i < 40 && (await markers()) === 0; i += 1) await sleep(150);
  ok("the buffered steer is marked while unread", (await markers()) === 1, `markers=${await markers()}`);
  ok("no split happens just because the Agent acknowledged it", (await answerAfterUser()) === false, `answers=${await answers()}`);

  // 3. After a tool batch finishes and the Agent talks again, the marker clears and the
  //    continuation opens below the message.
  for (let i = 0; i < 120 && (await markers()) > 0; i += 1) await sleep(150);
  ok("the marker clears once the Agent reads it", (await markers()) === 0, `markers=${await markers()}`);
  ok(
    "the continuation renders below the steer message",
    (await answerAfterUser()) === true && (await answers()) >= 2,
    `after=${await answerAfterUser()} answers=${await answers()}`,
  );
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
