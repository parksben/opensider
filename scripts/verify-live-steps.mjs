#!/usr/bin/env node
// Is the live region telling the truth while a turn runs?
//
// Two things users reported (2026-11-16):
//
//   1. Only thinking shows up live — tool calls never show their content. Real agents put
//      a tool's output in the update that *closes* it (Hermes: `tool_call` carries just the
//      command, `tool_call_update` carries the result ~400 ms later, and never a
//      `rawOutput`). The live region used to drop a card the instant it finished, so the
//      content was never on screen at all.
//   2. Neither the thinking fold nor a tool card could be collapsed while the turn ran —
//      both were controlled-open with no way to override.
//
// Drives the real panel against a fake agent that speaks Hermes' exact tool shape, sampling
// the live region every frame.
//
//   node scripts/verify-live-steps.mjs          # expects packages/extension/dist
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-livesteps-", dist });
const hermesStub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", "hermes-acp");
mkdirSync(dirname(hermesStub), { recursive: true });
writeFileSync(hermesStub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
chmodSync(hermesStub, 0o755);

const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  // Scripted turn, Hermes' tool shape, wide enough steps to click into.
  env: { FAKE_ACP_STEPS: "1", FAKE_ACP_TOOL_STYLE: "hermes", FAKE_ACP_STEP_MS: "400" },
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
    sessions: [{ id: "s1", title: "live steps", createdAt: now, updatedAt: now, todos: [], artifacts: [], messages: [] }],
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
  await cancelConnect.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
  await cancelConnect.waitFor({ state: "hidden", timeout: 90_000 }).catch(() => undefined);

  // Every frame: what the live region is showing, and whether its pane is open.
  await panel.evaluate(() => {
    const out = (window.__liveSamples = []);
    const errs = (window.__liveErrors = []);
    const log = () => {
      try {
      const step = document.querySelector('[data-live-step="visible"]');
      out.push({
        t: performance.now(),
        text: step ? (step.textContent ?? "").replace(/\s+/g, " ").trim() : "",
        // TextFold's open state = the title button still has a pane after it.
        open: step ? (step.firstElementChild?.children.length ?? 0) > 1 : false,
        running: Boolean(document.querySelector(".cs-composer.is-running")),
      });
      } catch (err) {
        errs.push(String(err).slice(0, 200));
      }
      if (out.length >= 30_000) clearInterval(timer);
    };
    const timer = setInterval(log, 50);
  });

  const nowMs = () => panel.evaluate(() => performance.now());
  const samplesSince = (from) =>
    panel.evaluate((from) => (window.__liveSamples ?? []).filter((sample) => sample.t >= from), from);
  const stepNow = () =>
    panel.evaluate(() => {
      const step = document.querySelector('[data-live-step="visible"]');
      return {
        text: step ? (step.textContent ?? "").replace(/\s+/g, " ").trim() : "",
        open: step ? (step.firstElementChild?.children.length ?? 0) > 1 : false,
      };
    });
  const clickStepTitle = () =>
    panel.evaluate(() => {
      const step = document.querySelector('[data-live-step="visible"]');
      step?.querySelector("button")?.click();
    });
  const waitForStep = async (match, timeout = 25_000) => {
    const from = Date.now();
    while (Date.now() - from < timeout) {
      const step = await stepNow();
      if (match(step.text)) return step;
      await sleep(50);
    }
    return null;
  };

  await composer.click();
  await panel.keyboard.type("run the scripted turn");
  await panel.keyboard.press("Enter");

  // ---------------------------------------------------- 1. thinking can be folded shut
  const thinking = await waitForStep((text) => text.includes("Thinking"));
  ok("the thinking block is what the live region shows first", Boolean(thinking), thinking?.text?.slice(0, 60) ?? "never seen");
  if (thinking) {
    await clickStepTitle();
    await sleep(120);
    const closed = await stepNow();
    await sleep(500); // another thought chunk lands in this window
    const stillClosed = await stepNow();
    await clickStepTitle();
    await sleep(120);
    const reopened = await stepNow();
    ok(
      "the thinking title closes and reopens while the turn runs, and the choice survives new chunks",
      !closed.open && !stillClosed.open && reopened.open,
      `closed=${closed.open} stillClosed=${stillClosed.open} reopened=${reopened.open}`,
    );
  }

  // ------------------------------------- 2. the tool call, and its content, live
  const tool = await waitForStep((text) => /^Read\b/.test(text));
  ok("the tool call takes over the live region", Boolean(tool), tool?.text?.slice(0, 80) ?? "never seen");

  if (tool) {
    // A card that opened itself because it is running must still close on a click — and the
    // card finishes right about now, which used to snap it back open (or rather, the card
    // simply vanished, and the click looked like it had done nothing).
    await clickStepTitle();
    await sleep(120);
    const closed = await stepNow();
    await sleep(600); // the tool completes in this window
    const stillClosed = await stepNow();
    await clickStepTitle();
    await sleep(120);
    const reopened = await stepNow();
    ok(
      "the tool title closes and reopens while the turn runs",
      tool.open && !closed.open && !stillClosed.open && reopened.open,
      `initial=${tool.open} closed=${closed.open} stillClosed=${stillClosed.open} reopened=${reopened.open}`,
    );
  }

  // Hermes reports the output only in the update that closes the tool. The card has to be
  // on screen with that text while the turn is still running.
  const finished = await waitForStep((text) => text.includes("export function useThreadFollow"));
  ok("the tool's output reaches the live card", Boolean(finished), finished?.text?.slice(0, 80) ?? "never seen");

  // The card must hold: keep polling past the moment the output landed, until the next
  // step (the answer text) takes the live region over.
  const holdFrom = Date.now();
  let held = 0;
  let lost = "";
  while (Date.now() - holdFrom < 700) {
    const step = await stepNow();
    const running = await panel.evaluate(() => Boolean(document.querySelector(".cs-composer.is-running")));
    if (step.text.includes("export function useThreadFollow") && running) {
      held += 1;
    } else {
      lost = `${Math.round(Date.now() - holdFrom)}ms text="${step.text.slice(0, 40)}" running=${running}`;
      break;
    }
    await sleep(50);
  }
  ok(
    "the finished card stays on screen instead of vanishing",
    lost === "" && held >= 8,
    lost ? `lost after ${lost}` : `held for ${held} polls`,
  );
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
