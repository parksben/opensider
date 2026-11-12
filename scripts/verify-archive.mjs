#!/usr/bin/env node
// Verifies the session archive end to end: an old conversation's body leaves the
// panel state, stays in `~/.opensider/sessions/<id>.json`, does not come back when
// the panel reloads, and is restored on demand via `session.restore`.
//
//   node scripts/verify-archive.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-archive-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox });
try {
  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;

  const oldIso = "2026-01-01T00:00:00.000Z";
  const now = new Date().toISOString();
  const message = (id, text) => ({ id, role: "user", content: [{ type: "text", text }], createdAt: now });
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "dark",
    selectedId: "sel",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: true,
    sessionDrawerWidth: 248,
    sessions: [
      { id: "sel", title: "selected", createdAt: now, updatedAt: now, messages: [message("sel-m", "selected")], todos: [], artifacts: [] },
      { id: "old1", title: "old1", createdAt: oldIso, updatedAt: oldIso, messages: [message("o1-m", "old one")], todos: [], artifacts: [] },
      { id: "old2", title: "old2", createdAt: oldIso, updatedAt: oldIso, messages: [message("o2-m", "old two")], todos: [], artifacts: [] },
    ],
  });

  const openPanel = async () => {
    const page = await context.newPage();
    page.on("pageerror", (error) => console.log(`[panel] error: ${error.message}`));
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await page.bringToFront();
    await page.locator('[contenteditable="true"]').waitFor({ state: "visible", timeout: 40_000 });
    return page;
  };
  const readState = () =>
    worker.evaluate(async () => (await chrome.storage.local.get("opensider/state"))["opensider/state"]);

  let panel = await openPanel();
  let state = await readState();
  let old1;
  for (let i = 0; i < 120; i += 1) {
    await sleep(250);
    state = await readState();
    old1 = state.sessions.find((session) => session.id === "old1");
    if (old1?.archivedAt) break;
  }
  const selected = state.sessions.find((session) => session.id === "sel");
  ok("old sessions are archived automatically", Boolean(old1?.archivedAt), JSON.stringify(old1 && { archivedAt: old1.archivedAt, messages: old1.messages.length }));
  ok("archived sessions keep no body in the active state", old1?.messages.length === 0);
  ok("the selected session stays active", !selected?.archivedAt && selected?.messages.length === 1);

  const bodyFile = join(sandbox.home, ".opensider", "sessions", "old1.json");
  ok("the transcript file is kept on disk", existsSync(bodyFile));
  if (existsSync(bodyFile)) {
    const body = JSON.parse(readFileSync(bodyFile, "utf8"));
    ok("the transcript file still has the messages", Array.isArray(body.messages) && body.messages.length === 1);
  }

  // Reloading the panel must not pull the archived body back into the state.
  await panel.close();
  panel = await openPanel();
  await sleep(3000);
  state = await readState();
  const reopened = state.sessions.find((session) => session.id === "old1");
  ok("reopening keeps the archived session without its body", Boolean(reopened?.archivedAt) && reopened?.messages.length === 0);

  // The archived group is collapsed by default; open it and restore the conversation.
  await panel.getByRole("button", { name: /Archived/ }).first().click();
  await sleep(300);
  await panel.getByRole("button", { name: /old one/ }).first().click();
  let restored;
  for (let i = 0; i < 60; i += 1) {
    await sleep(250);
    state = await readState();
    restored = state.sessions.find((session) => session.id === "old1");
    if (restored && !restored.archivedAt && restored.messages.length === 1) break;
  }
  ok("restoring brings the body back", Boolean(restored && !restored.archivedAt), JSON.stringify(restored && { archivedAt: restored.archivedAt, messages: restored.messages.length }));
  ok("restored session keeps its message", restored?.messages.length === 1);
  ok("restoring selects the conversation", state.selectedId === "old1", String(state.selectedId));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
