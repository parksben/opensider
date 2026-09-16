#!/usr/bin/env node
// Verifies dropped files end to end, in a real Chromium with the extension loaded:
//
//   dropping a file anywhere on the panel attaches it (instead of letting the browser open
//   it), the host writes a copy into the workspace `browser/uploads/`, and the panel ends up
//   with the file as an attachment chip.
//
// Everything runs in a throwaway sandbox (temp home for the host, temp Chromium profile,
// fake ACP agent as `copilot`) — see scripts/lib/sandbox.mjs.
//
//   node scripts/verify-file-drop.mjs           # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const CONTENT = "dropped file contents";
const NAME = "dropped.txt";

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>fixture</title><h1>fixture page</h1>");
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-drop-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: { FAKE_ACP_CHUNKS: "2", FAKE_ACP_CHUNK_MS: "20" },
});

try {
  const worker = await waitForWorker(context);
  ok("extension service worker started", Boolean(new URL(worker.url()).host));

  // A tab the Agent could act on (the panel needs one to be "ready").
  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);

  const panel = await context.newPage();
  const panelUrl = `chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`;
  await panel.goto(panelUrl);
  const bodyText = () => panel.evaluate(() => document.body.innerText);
  // On a cold profile the onboarding screen can take a moment to render (it asks the host for
  // the agent list first), so wait for either it or the composer instead of sampling once.
  const composer = panel.locator('[contenteditable="true"]');
  const agentButton = panel.getByRole("button", { name: "GitHub Copilot" });
  const appears = (locator) =>
    locator.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
  await Promise.race([appears(composer), appears(agentButton)]);
  if (await agentButton.isVisible().catch(() => false)) {
    await agentButton.click({ timeout: 20_000 });
  }
  try {
    await composer.waitFor({ state: "visible", timeout: 30_000 });
  } catch (error) {
    console.log(`--- panel body when the composer never came up ---\n${await bodyText()}\n------------------`);
    throw error;
  }
  ok("the side panel is connected and ready", true);
  const drop = (content, name) =>
    panel.evaluate(
      async ({ content, name }) => {
        const file = new File([new TextEncoder().encode(content)], name, { type: "text/plain" });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        const fire = (type) =>
          document.body.dispatchEvent(
            new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
          );
        fire("dragenter");
        fire("dragover");
        fire("drop");
      },
      { content, name },
    );

  // 1. Dragging over the panel shows the drop hint.
  await panel.evaluate(() => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["x"], "peek.txt", { type: "text/plain" }));
    document.body.dispatchEvent(
      new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer }),
    );
  });
  await panel.waitForTimeout(200);
  const hint = await bodyText();
  ok(
    "dragging over the panel shows the drop hint",
    hint.includes("Drop to attach") || hint.includes("松开即可添加附件"),
  );

  // 2. Dropping the file attaches it.
  await drop(CONTENT, NAME);
  let chipped = false;
  for (let attempt = 0; attempt < 40 && !chipped; attempt += 1) {
    await panel.waitForTimeout(250);
    chipped = (await bodyText()).includes(NAME);
  }
  ok("the dropped file shows up as an attachment", chipped);

  // 2b. A genuine OS drag. The synthetic drop above only ever reaches the `files` fallback
  // (a hand-built DataTransfer has no entries), so `webkitGetAsEntry()` + `entry.file()` -
  // the path every real Finder drag takes - was never covered. CDP hands the page the same
  // DataTransfer Chrome builds itself, entries included.
  const REAL_NAME = "dragged.txt";
  const REAL_CONTENT = "dragged in from the desktop";
  const realPath = join(sandbox.dir, REAL_NAME);
  writeFileSync(realPath, REAL_CONTENT);
  const client = await context.newCDPSession(panel);
  await client.send("Input.setInterceptDrags", { enabled: true });
  const box = await composer.boundingBox();
  const dragData = { items: [], files: [realPath], dragOperationsMask: 1 };
  const point = {
    x: Math.round((box?.x ?? 10) + (box?.width ?? 100) / 2),
    y: Math.round((box?.y ?? 10) + (box?.height ?? 20) / 2),
  };
  for (const type of ["dragEnter", "dragOver", "drop"]) {
    await client.send("Input.dispatchDragEvent", { type, ...point, data: dragData });
  }
  let realChipped = false;
  for (let attempt = 0; attempt < 40 && !realChipped; attempt += 1) {
    await panel.waitForTimeout(250);
    realChipped = (await bodyText()).includes(REAL_NAME);
  }
  ok("a real OS drag attaches the file", realChipped);
  const realUploaded = join(sandbox.uploads, REAL_NAME);
  ok(
    "the real drag landed in the workspace",
    existsSync(realUploaded) && readFileSync(realUploaded, "utf8") === REAL_CONTENT,
    realUploaded,
  );

  // 3. The host wrote the copy the Agent will read.
  const uploaded = join(sandbox.uploads, NAME);
  ok("the host wrote the file into workspace/browser/uploads", existsSync(uploaded), uploaded);
  if (existsSync(uploaded)) {
    ok("the uploaded copy matches what was dropped", readFileSync(uploaded, "utf8") === CONTENT);
  }

  // 4. A drop that cannot work has to say so. This is the bug users hit: the hint appears,
  // the drop lands, and the attachment bar just stays empty with no explanation.
  const BIG_NAME = "huge.bin";
  await panel.evaluate(
    async ({ name }) => {
      const file = new File([new Uint8Array(600 * 1024)], name, { type: "application/octet-stream" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const fire = (type) =>
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire("dragenter");
      fire("dragover");
      fire("drop");
    },
    { name: BIG_NAME },
  );
  let explained = false;
  for (let attempt = 0; attempt < 40 && !explained; attempt += 1) {
    await panel.waitForTimeout(250);
    const body = await bodyText();
    explained = /too large to drop|文件体积过大/.test(body);
  }
  ok("an oversized drop explains why nothing was attached", explained);
  ok("...and does not attach it", !(await bodyText()).includes(BIG_NAME));

  // 5. The browser was not allowed to do its default thing with the file.
  ok("the panel did not navigate away", panel.url() === panelUrl, panel.url());
  ok("the drop hint is gone again", !(await bodyText()).includes("Drop to attach"));

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) console.log(`--- panel ---\n${await bodyText()}\n-------------`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
