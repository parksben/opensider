import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const CHUNKS = 60;
const CHUNK_MS = 200;

const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>fixture</title></head><body><h1>fixture page</h1></body></html>`);
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-e2e-", dist });
const { tracePath } = sandbox;
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    FAKE_ACP_CHUNKS: String(CHUNKS),
    FAKE_ACP_CHUNK_MS: String(CHUNK_MS),
    FAKE_ACP_TRACE: tracePath,
    // Lets a run exercise an agent that keeps going for a while after session/cancel:
    //   FAKE_ACP_IGNORE_CANCEL_MS=1500 node scripts/verify-queue-send-now.mjs
    ...(process.env.FAKE_ACP_IGNORE_CANCEL_MS
      ? { FAKE_ACP_IGNORE_CANCEL_MS: process.env.FAKE_ACP_IGNORE_CANCEL_MS }
      : {}),
  },
});

const bodyTextRaw = (page) => page.evaluate(() => document.body.innerText);

const trace = (path) => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

let panel;
try {
  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;
  ok("extension service worker started", Boolean(extensionId));

  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);
  await fixture.bringToFront();

  panel = await context.newPage();
  if (process.env.E2E_DEBUG) {
    panel.on("console", (msg) => console.log(`[panel] ${msg.type()}: ${msg.text()}`));
    panel.on("pageerror", (error) => console.log(`[panel] error: ${error.message}`));
    worker.on("console", (msg) => console.log(`[sw] ${msg.type()}: ${msg.text()}`));
  }
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.bringToFront();

  const composer = panel.locator('[contenteditable="true"]');
  const bodyText = () => panel.evaluate(() => document.body.innerText);
  const waitForText = async (needle, timeout = 30_000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if ((await bodyText()).includes(needle)) return;
      await panel.waitForTimeout(100);
    }
    throw new Error(`timed out waiting for ${JSON.stringify(needle)}`);
  };

  // 1. Connect to the fake agent through the onboarding screen (otherwise the panel may
  // auto-connect to whatever real CLI is installed here first).
  const agentButton = panel.getByRole("button", { name: "GitHub Copilot" });
  try {
    await agentButton.click({ timeout: 20_000 });
  } catch {
    console.log(`--- panel text ---\n${await bodyTextRaw(panel)}\n------------------`);
    throw new Error("could not find the agent button; see the panel text above");
  }
  try {
    await composer.waitFor({ state: "visible", timeout: 30_000 });
  } catch {
    console.log(`--- panel text ---\n${await bodyTextRaw(panel)}\n------------------`);
    throw new Error("the composer never appeared; see the panel text above");
  }
  ok("the sidepanel connected to the fake agent", true);

  const send = async (text) => {
    await composer.click();
    await panel.keyboard.type(text);
    await panel.keyboard.press("Enter");
  };

  // 2. Start a long turn, then queue a second message while it runs.
  const first = "first message";
  const second = "second message";
  const third = "third message";
  await send(first);
  await waitForText("T1.3");
  ok("the first turn is streaming", true);

  await send(second);
  const queued = panel.locator("ol li", { hasText: second });
  await queued.waitFor({ state: "visible", timeout: 15_000 });
  ok("the second message was queued while the first turn ran", true);
  await send(third);
  const queuedAfter = panel.locator("ol li", { hasText: third });
  await queuedAfter.waitFor({ state: "visible", timeout: 15_000 });
  ok("later messages remain queued behind the immediate send", true);

  // 3. Queue state has to survive an extension reload; otherwise the restart would
  // silently drop the text the user just typed while the turn was still running.
  await panel.waitForTimeout(900);
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get('opensider/state'))['opensider/state']);
  ok('webpage storage notifications contain settings, not transcripts', settings.sessions.length === 0 && !settings.queues);
  ok('settings storage remains small', JSON.stringify(settings).length < 4096);
  await panel.reload();
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  await queued.waitFor({ state: "visible", timeout: 20_000 });
  ok("the queued message survives a panel reload", true);

  // 4. Send it now while the agent cannot steer: it must interrupt the running turn
  // and start immediately, without consuming later queue entries.
  await queued.getByRole("button", { name: /Send now|立即发送/ }).click();
  let immediateStarted = true;
  try {
    await waitForText("T2.3", 15_000);
  } catch {
    immediateStarted = false;
  }
  ok("the immediate message starts before the current turn completes", immediateStarted);
  let cleared = true;
  try {
    await queued.waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    cleared = false;
  }
  ok("the immediate queue entry is consumed", cleared);
  ok("the remaining queue entry stays queued", await queuedAfter.isVisible());

  // 5. The remaining message starts only after the replacement turn completes.
  let remainingStarted = true;
  try {
    await waitForText("T3.3", 30_000);
  } catch {
    remainingStarted = false;
  }
  ok(
    "the remaining queued message starts after the replacement turn",
    remainingStarted,
    remainingStarted ? "" : "no T3.* chunk was streamed",
  );

  let remainingCleared = true;
  try {
    await queuedAfter.waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    remainingCleared = false;
  }
  ok("the remaining queue entry is consumed", remainingCleared);

  const text = await bodyText();
  ok("the sent message is still on screen", text.includes(second));
  ok("the later queued message is still on screen", text.includes(third));

  // 6. The agent's own view: three prompts, an interrupt between the first and second,
  // and the third prompt dispatched only after the second turn.
  const events = trace(tracePath);
  const prompts = events.filter((event) => event.event === "prompt");
  ok("the agent received exactly three prompts", prompts.length === 3, `saw ${prompts.length}`);
  ok(
    "the second prompt carried the queued message",
    Boolean(prompts[1]?.text?.includes(second)),
    prompts[1]?.text ? `got ${JSON.stringify(prompts[1].text.slice(0, 80))}` : "no second prompt",
  );
  ok(
    "the third prompt carried the remaining queued message",
    Boolean(prompts[2]?.text?.includes(third)),
    prompts[2]?.text ? `got ${JSON.stringify(prompts[2].text.slice(0, 80))}` : "no third prompt",
  );
  ok("the first turn was cancelled for immediate send", events.some((event) => event.event === "cancel"));

  const streamed = (text.match(/T1\.\d+/g) ?? []).length;
  ok("the interrupted first turn stopped before completion", streamed < CHUNKS, `${streamed}/${CHUNKS} chunks`);

  // 7. The Host should have logged exactly the immediate-send interrupt path.
  let logged = false;
  try {
    logged = execFileSync("grep", ["-r", "prompt interrupt requested", join(sandbox.home, ".opensider")], {
      encoding: "utf8",
    }).includes("prompt interrupt requested");
  } catch {
    logged = false;
  }
  ok("the host logged an interrupt", logged);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`--- panel text ---\n${await bodyText()}\n------------------`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
} catch (error) {
  console.log(`--- panel text ---\n${panel ? await panel.evaluate(() => document.body.innerText) : ""}\n------------------`);
  throw error;
} finally {
  await context.close();
  server.close();
}
