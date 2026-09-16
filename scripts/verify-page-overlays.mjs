#!/usr/bin/env node
// Verifies overlay awareness end to end, in a real Chromium with the extension loaded:
//
//   click a button -> the page opens its own modal -> the click result says so
//   a second action with nothing new -> stays quiet
//   close it -> the result says the overlay set changed (now empty)
//   and the host keeps `browser/overlays.json` in sync
//
// Everything runs in a throwaway sandbox (temp home for the host, temp Chromium profile,
// fake ACP agent as `copilot`) — see scripts/lib/sandbox.mjs.
//
//   node scripts/verify-page-overlays.mjs           # expects packages/extension/dist
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

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>overlay fixture</title>
<style>
  #modal { position: fixed; inset: 0; display: none; place-items: center; background: rgba(0,0,0,.4); z-index: 900; }
  #modal[data-open] { display: grid; }
  #modal .box { width: 60%; height: 60%; background: #fff; padding: 16px; }
</style></head>
<body>
<main id="content"><button id="open">Open settings</button></main>
<div id="modal" role="dialog" aria-modal="true" aria-label="Account settings">
  <div class="box"><h2>Account settings</h2><p>Change your details</p>
    <button id="close">Close</button></div>
</div>
<script>
  // Real modal implementations take the page behind out of play; the fixture does the same
  // so the "background is inert" signal can be checked.
  const open = () => {
    document.getElementById('modal').setAttribute('data-open', '');
    document.getElementById('content').setAttribute('inert', '');
  };
  const close = () => {
    document.getElementById('modal').removeAttribute('data-open');
    document.getElementById('content').removeAttribute('inert');
  };
  document.getElementById('open').onclick = open;
  document.getElementById('close').onclick = close;
</script>
</body></html>`;

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-overlay-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: { FAKE_ACP_CHUNKS: "2", FAKE_ACP_CHUNK_MS: "20" },
});

try {
  const worker = await waitForWorker(context);
  ok("extension service worker started", Boolean(new URL(worker.url()).host));

  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.bringToFront();
  await page.waitForTimeout(500);

  let counter = 0;
  const command = (method, args) =>
    worker.evaluate(
      (payload) => globalThis.__opensiderDispatch(payload),
      { id: `cmd-${++counter}`, method, args },
    );

  const clean = await command("getOverlays", {});
  ok(
    "a clean page reports no overlays",
    clean?.ok === true && Array.isArray(clean.data?.overlays) && clean.data.overlays.length === 0,
    JSON.stringify(clean?.data),
  );

  // 1. The button opens a modal: the click result has to say so.
  const opened = await command("click", { selector: "#open" });
  const overlays = opened?.data?.overlays?.overlays ?? [];
  ok("clicking the button reports the modal it opened", overlays.length > 0, JSON.stringify(opened?.data?.overlays));
  ok("the modal carries its label and modal flag", overlays[0]?.label === "Account settings" && overlays[0]?.modal === true, JSON.stringify(overlays[0]));
  ok("the page behind it reads as inert", overlays[0]?.backgroundInert === true, JSON.stringify(overlays[0]));

  // 2. The host keeps the snapshot on disk while the modal is open.
  const onDisk = () => {
    const path = join(sandbox.workspace, "browser", "overlays.json");
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  };
  let written = null;
  for (let attempt = 0; attempt < 20 && !written; attempt += 1) {
    await page.waitForTimeout(150);
    const doc = onDisk();
    if (doc?.overlays?.length) written = doc;
  }
  ok("the host wrote browser/overlays.json", Boolean(written), written ? JSON.stringify(written.overlays[0]?.label) : "missing");
  ok("the file says the page is showing a modal", written?.modal === true);

  // 3. An action that changes nothing new stays quiet.
  const again = await command("getInteractive", {});
  ok("an action with no new overlay keeps the result clean", again?.data?.overlays === undefined);

  // 4. Closing it reports the set changed (now empty), and the file follows.
  const closed = await command("click", { selector: "#close" });
  ok(
    "closing the modal is reported as a change",
    Array.isArray(closed?.data?.overlays?.overlays) && closed.data.overlays.overlays.length === 0,
    JSON.stringify(closed?.data?.overlays),
  );
  let emptied = null;
  for (let attempt = 0; attempt < 20 && !emptied; attempt += 1) {
    await page.waitForTimeout(150);
    const doc = onDisk();
    if (doc && Array.isArray(doc.overlays) && doc.overlays.length === 0) emptied = doc;
  }
  ok("browser/overlays.json is emptied again", Boolean(emptied), JSON.stringify(emptied?.overlays));

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
