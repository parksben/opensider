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
  const waitForText = (needle, timeout = 30_000) =>
    panel.waitForFunction((value) => document.body.innerText.includes(value), needle, { timeout });

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
  await send(first);
  await waitForText("T1.3");
  ok("the first turn is streaming", true);

  await send(second);
  const queued = panel.locator("ol li", { hasText: second });
  await queued.waitFor({ state: "visible", timeout: 15_000 });
  ok("the second message was queued while the first turn ran", true);

  // 3. Send it now: this is the reported flow (interrupt + send the new message).
  await queued.locator("button").first().click();

  let started = true;
  try {
    await waitForText("T2.3", 30_000);
  } catch {
    started = false;
  }
  ok("a new turn started for the queued message", started, started ? "" : "no T2.* chunk was streamed");

  let cleared = true;
  try {
    await queued.waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    cleared = false;
  }
  ok("the queue entry was consumed", cleared);

  // The transcript has to still carry the message the user sent.
  const text = await bodyText();
  ok("the sent message is still on screen", text.includes(second));

  // 4. The agent's own view: two prompts, the second one carrying the queued text.
  const events = trace(tracePath);
  const prompts = events.filter((event) => event.event === "prompt");
  ok("the agent received exactly two prompts", prompts.length === 2, `saw ${prompts.length}`);
  ok(
    "the second prompt carried the queued message",
    Boolean(prompts[1]?.text?.includes(second)),
    prompts[1]?.text ? `got ${JSON.stringify(prompts[1].text.slice(0, 80))}` : "no second prompt",
  );
  ok(
    "the first turn was cancelled by the host",
    events.some((event) => event.event === "cancel") &&
      events.some((event) => event.event === "end" && event.turn === 1 && event.stopReason === "cancelled"),
  );

  // The interrupt has to actually cut the running turn short.
  const streamed = (text.match(/T1\.\d+/g) ?? []).length;
  ok("the interrupted turn stopped early", streamed < CHUNKS, `${streamed}/${CHUNKS} chunks`);

  // 5. The host really took the interrupt path (not the "prompt ignored" one).
  let logged = false;
  try {
    logged = execFileSync("grep", ["-r", "prompt interrupt requested", join(sandbox.home, ".opensider")], {
      encoding: "utf8",
    }).includes("prompt interrupt requested");
  } catch {
    logged = false;
  }
  ok("the host logged the interrupt", logged);

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
