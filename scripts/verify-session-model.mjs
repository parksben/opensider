#!/usr/bin/env node
// Verifies the model picker is remembered per conversation × agent, end to end:
//
//   1. pick a concrete model in conversation 1 (it shows on the trigger)
//   2. switch to conversation 2 — no pick of its own yet, so the agent's default applies
//   3. pick another model there (the fake agent traces it for conversation 2)
//   4. switch back to conversation 1: the trigger shows ITS model again (not the last pick)
//      and the engine gets a model switch for conversation 1 (traced with its session id)
//
// The seed binds both conversations to one fake agent (distinct ACP session ids), so a
// switch is a real `session.use` + `models` round trip through the host, exactly like the
// user's flow. A conversation's pick has to survive that round trip.
//
//   node scripts/verify-session-model.mjs          # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const MODEL_A = "gpt-5.5";
const MODEL_A_NAME = "GPT-5.5";
const MODEL_B = "claude-opus-4.7";
const MODEL_B_NAME = "Claude Opus 4.7";

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>fixture</title><h1>fixture page</h1>");
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-model-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox, env: { FAKE_ACP_TRACE: sandbox.tracePath } });

const trace = () => {
  if (!existsSync(sandbox.tracePath)) return [];
  return readFileSync(sandbox.tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

const waitFor = async (fn, expected, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last === expected) return { ok: true, last };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, last };
};

try {
  const worker = await waitForWorker(context);
  ok("extension service worker started", Boolean(new URL(worker.url()).host));

  // A tab the Agent could act on (the panel needs one before it turns "ready").
  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);

  const now = Date.now();
  const seeded = (id, acp, title, at) => ({
    id,
    acpSessionId: acp,
    title,
    createdAt: new Date(at).toISOString(),
    updatedAt: new Date(at).toISOString(),
    todos: [],
    artifacts: [],
    messages: [
      { id: `${id}-u`, role: "user", createdAt: new Date(at).toISOString(), content: [{ type: "text", text: `${title} question` }] },
      {
        id: `${id}-a`,
        role: "assistant",
        createdAt: new Date(at + 1_000).toISOString(),
        content: [{ type: "text", text: `${title} answer` }],
        durationMs: 1_000,
      },
    ],
  });
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: new Date(now).toISOString(),
    locale: "en",
    theme: "dark",
    selectedId: "s1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [seeded("s1", "verify-m1", "First chat", now - 120_000), seeded("s2", "verify-m2", "Second chat", now - 60_000)],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.bringToFront();

  const modelButton = panel.getByRole("button", { name: "Model", exact: true });
  const pickerUp = await waitFor(async () => modelButton.isVisible().catch(() => false), true, 60_000);
  ok("the model picker is up (the agent advertises a list)", pickerUp.ok, String(pickerUp.last));
  const title = () => modelButton.getAttribute("title");

  const pickModel = async (id) => {
    await modelButton.click();
    await panel.locator(`[data-model-id="${id}"]`).click({ timeout: 5_000 });
  };
  const switchTo = async (sessionId, label) => {
    // The drawer stays open once it was opened for a switch, so only toggle when the rows
    // are not on screen.
    const row = panel.locator(`[data-session-id="${sessionId}"]`);
    if (!(await row.first().isVisible().catch(() => false))) {
      await panel.getByRole("button", { name: "Expand", exact: true }).click({ timeout: 5_000 });
      await row.first().waitFor({ state: "visible", timeout: 5_000 });
    }
    await panel.locator(`[data-session-id="${sessionId}"] button`, { hasText: label }).first().click({ timeout: 5_000 });
  };

  // 1. Conversation 1 picks a concrete model.
  await pickModel(MODEL_A);
  const stuck = await waitFor(async () => (await title()) === MODEL_A_NAME, true);
  ok("picking a model in conversation 1 shows up on the trigger", stuck.ok, await title());

  // 2. Conversation 2 starts on the agent default (the pick is per agent, not per panel)…
  const beforeS2 = Date.now();
  await switchTo("s2", "Second chat");
  const defaulted = await waitFor(async () => (await title()) === MODEL_A_NAME, true);
  ok("a conversation without a pick falls back to the agent's default", defaulted.ok, await title());

  // 3. …and then picks its own model.
  await pickModel(MODEL_B);
  const pickedB = await waitFor(async () => (await title()) === MODEL_B_NAME, true);
  ok("conversation 2 keeps its own model", pickedB.ok, await title());
  const tracedB = await waitFor(
    () => trace().some((entry) => entry.event === "set_config_option" && entry.value === MODEL_B && entry.sessionId === "verify-m2"),
    true,
  );
  ok("the engine was told about conversation 2's model", tracedB.ok, JSON.stringify(trace().at(-1) ?? {}));

  // 4. Back to conversation 1: its own pick is what the trigger shows, and the engine is
  // moved back to it (not left on conversation 2's model).
  const beforeBack = Date.now();
  await switchTo("s1", "First chat");
  const back = await waitFor(async () => (await title()) === MODEL_A_NAME, true);
  ok("switching back restores conversation 1's own model", back.ok, await title());
  const tracedBack = await waitFor(
    () =>
      trace().some(
        (entry) =>
          entry.event === "set_config_option" &&
          entry.value === MODEL_A &&
          entry.sessionId === "verify-m1" &&
          (entry.at ?? 0) >= beforeBack,
      ),
    true,
  );
  ok(
    "the engine is moved back for conversation 1 too",
    tracedBack.ok,
    JSON.stringify(trace().filter((entry) => entry.event === "set_config_option").slice(-4)),
  );

  // 5. And conversation 2 still remembers its own pick.
  await switchTo("s2", "Second chat");
  const againB = await waitFor(async () => (await title()) === MODEL_B_NAME, true);
  ok("conversation 2 still remembers its own model", againB.ok, await title());

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`--- panel ---\n${await panel.evaluate(() => document.body.innerText)}\n-------------`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
