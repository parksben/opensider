#!/usr/bin/env node
// Verifies the "the bridge is older than the extension" path end to end:
//
//   an older host silently drops commands it does not know, which used to look like
//   "the drop hint appeared and then nothing happened". The panel now says so, and the
//   warning must be visible (not just a tooltip behind the status pill) and dismissible —
//   and it must not stop the features the bridge does support.
//
// The host is built from the current tree but told to report an old version, so everything
// else in the run stays real.
//
//   node scripts/verify-host-skew.mjs           # expects packages/extension/dist
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const CONTENT = "still droppable";
const NAME = "after-warning.txt";

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>fixture</title><h1>fixture page</h1>");
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-skew-", dist, hostVersion: "0.2.0" });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: { FAKE_ACP_CHUNKS: "2", FAKE_ACP_CHUNK_MS: "20" },
});

try {
  const worker = await waitForWorker(context);
  ok("extension service worker started", Boolean(new URL(worker.url()).host));

  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.getByRole("button", { name: "GitHub Copilot" }).click({ timeout: 20_000 });
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  ok("the side panel is connected and ready", true);

  const bodyText = () => panel.evaluate(() => document.body.innerText);
  const OUTDATED = ["older than this extension", "比扩展旧"];
  let warned = false;
  for (let attempt = 0; attempt < 20 && !warned; attempt += 1) {
    await panel.waitForTimeout(250);
    const body = await bodyText();
    warned = OUTDATED.some((text) => body.includes(text));
  }
  ok("the panel says the bridge is older than the extension", warned);

  // Dismissing it is the user's call, and it must really go away.
  await panel.getByRole("button", { name: /Dismiss|关闭/ }).click({ timeout: 10_000 });
  await panel.waitForTimeout(200);
  const afterDismiss = await bodyText();
  ok("the notice can be dismissed", !OUTDATED.some((text) => afterDismiss.includes(text)));

  // A stale bridge is a warning, not a stop sign: what the host still understands works.
  await panel.evaluate(
    async ({ content, name }) => {
      const file = new File([new TextEncoder().encode(content)], name, { type: "text/plain" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const fire = (type) =>
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire("dragenter");
      fire("dragover");
      fire("drop");
    },
    { content: CONTENT, name: NAME },
  );
  let chipped = false;
  for (let attempt = 0; attempt < 40 && !chipped; attempt += 1) {
    await panel.waitForTimeout(250);
    chipped = (await bodyText()).includes(NAME);
  }
  ok("a drop still attaches while the warning is up", chipped);
  ok("the upload still reached the workspace", existsSync(join(sandbox.uploads, NAME)));

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) console.log(`--- panel ---\n${await bodyText()}\n-------------`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
