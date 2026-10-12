#!/usr/bin/env node
// Verifies background tasks end to end, in a real Chromium (real Host + fake ACP agent):
//
//   keep running   -> closing the side panel mid-turn does not interrupt it; the turn
//                     finishes while no panel is connected
//   badge          -> the toolbar icon carries a green badge + "task running" tooltip
//                     while the turn is in flight, and clears when it ends
//   replay         -> reopening the panel after the turn finished shows the whole turn
//                     (every chunk the panel missed while it was closed)
//   mid-turn open  -> reopening while the turn still runs adopts it as running and the
//                     remaining chunks keep streaming into the reopened panel
//   permission     -> a permission request that arrives while the panel is closed is
//                     replayed when the panel opens; answering it lets the turn finish
//
// The fake agent turns on FAKE_ACP_PERMISSION: a prompt whose text mentions "permission"
// waits 1.5s, then asks the client for a permission and only continues once answered.
//
//   HEADLESS=1 node scripts/verify-background-task.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  check,
  createSandbox,
  launchSandbox,
  loadPlaywright,
  waitForWorker,
} from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const CHUNKS = 22;
const CHUNK_MS = 450; // a turn streams for ~10s
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-background-", dist });
const { tracePath } = sandbox;
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    FAKE_ACP_CHUNKS: String(CHUNKS),
    FAKE_ACP_CHUNK_MS: String(CHUNK_MS),
    FAKE_ACP_TRACE: tracePath,
    FAKE_ACP_PERMISSION: "1",
    FAKE_MODES: "none",
    FAKE_OPTIONS: "none",
  },
});

const traceEvents = () => {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
};
const waitTrace = async (test, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = traceEvents().findLast(test);
    if (last) return last;
    await sleep(250);
  }
  return undefined;
};

const bodyText = (panel) => panel.evaluate(() => document.body.innerText);
const lastChunk = async (panel, label) => {
  const text = await bodyText(panel);
  // 尾部空白会被渲染折叠，所以匹配不带尾空格的分片号。
  const matches = [...text.matchAll(new RegExp(`T${label}\\.(\\d+)`, "g"))];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : -1;
};
const waitBody = (panel, needle, timeout = 30_000) =>
  panel
    .waitForFunction((text) => document.body.innerText.includes(text), needle, { timeout })
    .then(() => true)
    .catch(() => false);

const badge = (worker) =>
  worker.evaluate(async () => ({
    text: await chrome.action.getBadgeText({}),
    title: await chrome.action.getTitle({}),
  }));
const waitBadgeRunning = async (worker, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await badge(worker);
    if (last.text !== "" && /Task running|任务运行中/.test(last.title)) return true;
    await sleep(200);
  }
  return false;
};
const waitBadgeCleared = async (worker, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await badge(worker)).text === "") return true;
    await sleep(200);
  }
  return false;
};

let panel;
try {
  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;
  ok("extension service worker started", Boolean(extensionId));

  // Seed a conversation so the panel auto-connects to the fake agent (sandbox `copilot`).
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "dark",
    selectedId: "bg-1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{ id: "bg-1", title: "background", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
  });
  // 等宿主扫完 Agent 列表再开面板（同 verify-first-connect）：否则自动连接可能抢在状态
  // 快照之前跑，误连到本机真实的第一个 CLI。
  const hostLog = join(sandbox.home, ".opensider", "host.log");
  let hostIdle = false;
  for (let i = 0; i < 120 && !hostIdle; i += 1) {
    hostIdle = existsSync(hostLog) && /idle agents=/.test(readFileSync(hostLog, "utf8"));
    if (!hostIdle) await sleep(250);
  }
  ok("the host is up and idle before the panel opens", hostIdle);

  const openPanel = async () => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 640 });
    await page.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
    await page.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 20_000 });
    await page.locator('[contenteditable="true"]').waitFor({ state: "visible", timeout: 60_000 });
    return page;
  };
  const send = async (page, text) => {
    const composer = page.locator('[contenteditable="true"]');
    await composer.click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };

  // --- A. The turn survives the panel closing, replays when it opens again ------------
  panel = await openPanel();
  ok("the panel connected to the fake agent", Boolean(panel));
  await send(panel, "background run");
  ok("the first turn is streaming", await waitBody(panel, "T1.3"));
  ok("the toolbar icon shows the running badge", await waitBadgeRunning(worker), JSON.stringify(await badge(worker)));

  await panel.close();
  panel = undefined;
  const finished = await waitTrace((entry) => entry.event === "end" && entry.turn === 1, 30_000);
  ok("the turn finished with no panel connected", Boolean(finished), JSON.stringify(finished ?? traceEvents().slice(-3)));
  ok("the badge clears once the turn ends", await waitBadgeCleared(worker), JSON.stringify(await badge(worker)));

  panel = await openPanel();
  const replayed = await waitBody(panel, `T1.${CHUNKS - 1}`, 20_000);
  ok(
    "reopening replays the whole missed turn",
    replayed,
    `last visible chunk = T1.${await lastChunk(panel, 1)} (expected T1.${CHUNKS - 1})`,
  );
  const idleAfterReplay = (await panel.locator('button[aria-label="Stop"]').count()) === 0;
  ok("the finished turn is not shown as running", idleAfterReplay);

  // --- B. Reopening mid-turn adopts the running turn and keeps streaming --------------
  await send(panel, "mid run");
  ok("the second turn is streaming", await waitBody(panel, "T2.3"));
  await sleep(1200);
  await panel.close();
  panel = undefined;
  await sleep(1500);
  panel = await openPanel();
  const adopted = await panel
    .locator('button[aria-label="Stop"]')
    .waitFor({ state: "visible", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  ok("reopening mid-turn adopts the running state", adopted, (await bodyText(panel)).replace(/\s+/g, " ").slice(0, 120));
  const continued = await waitBody(panel, `T2.${CHUNKS - 1}`, 25_000);
  ok(
    "the rest of the turn streams into the reopened panel",
    continued,
    `last visible chunk = T2.${await lastChunk(panel, 2)} (expected T2.${CHUNKS - 1})`,
  );
  const secondEnd = await waitTrace((entry) => entry.event === "end" && entry.turn === 2, 20_000);
  ok("the second turn finished normally", secondEnd?.stopReason === "end_turn", JSON.stringify(secondEnd ?? {}));

  // --- C. A permission request that arrived while the panel was closed is replayed ----
  await send(panel, "permission check");
  // The fake agent waits 1.5s before asking: closing now means the request lands with
  // nobody listening (the case that used to strand the task forever).
  await panel.close();
  panel = undefined;
  const requested = await waitTrace((entry) => entry.event === "permission_requested" && entry.turn === 3, 15_000);
  ok("the permission request arrived while the panel was closed", Boolean(requested));
  ok("the task is still on the badge while it waits", await waitBadgeRunning(worker));

  panel = await openPanel();
  const cardUp = await panel
    .getByRole("button", { name: "Allow once" })
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  ok("reopening shows the waiting permission card", cardUp, (await bodyText(panel)).replace(/\s+/g, " ").slice(0, 160));
  await panel.getByRole("button", { name: "Allow once" }).click();
  const answered = await waitTrace((entry) => entry.event === "permission_answered", 10_000);
  ok("answering the card reaches the agent", Boolean(answered), JSON.stringify(answered ?? {}));
  const thirdFinished = await waitBody(panel, `T3.${CHUNKS - 1}`, 30_000);
  ok(
    "the turn finishes after the answer",
    thirdFinished,
    `last visible chunk = T3.${await lastChunk(panel, 3)} (expected T3.${CHUNKS - 1})`,
  );
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 240));
} finally {
  await panel?.close().catch(() => undefined);
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
