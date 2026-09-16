#!/usr/bin/env node
// Verifies the composer clipboard carry-over end to end, in a real Chromium:
//
//   select the whole composer, copy/cut -> the attachment bar travels with the clipboard
//   paste in another composer -> text and attachments both come back
//   a partial selection, and pasting an image, behave exactly as before
//
// "Another composer" is a second side panel page: the clipboard is the browser's, and the
// attachments state is per composer, which is what the cross-session case boils down to.
//
// Everything runs in a throwaway sandbox (temp home for the host, temp Chromium profile,
// fake ACP agent as `copilot`) — see scripts/lib/sandbox.mjs.
//
//   node scripts/verify-composer-clipboard.mjs           # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const DRAFT = "draft text";
const ATTACHMENT = "carried.txt";

// 1x1 transparent PNG, for the "images still paste" check.
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (char) => char.charCodeAt(0),
);

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end("<!doctype html><title>fixture</title><h1>fixture page</h1>");
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const sandbox = createSandbox({ root, prefix: "opensider-clip-", dist });
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

  const openPanel = async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
    const composer = panel.locator('[contenteditable="true"]');
    return { panel, composer };
  };
  const bodyText = (panel) => panel.evaluate(() => document.body.innerText);
  const appears = (locator) =>
    locator.waitFor({ state: "visible", timeout: 30_000 }).then(
      () => true,
      () => false,
    );
  const connect = async (panel) => {
    // The first panel goes through onboarding; a later one already has the agent stored and
    // lands straight in the composer. Which of the two shows up first is timing dependent on
    // a cold profile, so wait for either rather than sampling the button once.
    const composer = panel.locator('[contenteditable="true"]');
    const agentButton = panel.getByRole("button", { name: "GitHub Copilot" });
    await Promise.race([appears(composer), appears(agentButton)]);
    if (await agentButton.isVisible().catch(() => false)) {
      await agentButton.click({ timeout: 20_000 });
    }
    try {
      await composer.waitFor({ state: "visible", timeout: 30_000 });
    } catch (error) {
      console.log(`--- panel body when the composer never came up ---\n${await bodyText(panel)}\n------------------`);
      throw error;
    }
  };

  const first = await openPanel();
  await connect(first.panel);
  ok("the side panel is connected and ready", true);

  const clearComposer = async ({ panel, composer }) => {
    await composer.click();
    await panel.keyboard.press(`${MOD}+a`);
    await panel.keyboard.press("Backspace");
    await panel.waitForTimeout(120);
  };
  const typeDraft = async ({ panel, composer }) => {
    await composer.click();
    await panel.keyboard.type(DRAFT);
    await panel.waitForTimeout(120);
  };

  // Attach something through the real drop path (that is how a user gets a chip).
  await first.panel.evaluate(
    async (name) => {
      const file = new File([new TextEncoder().encode("carried")], name, { type: "text/plain" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const fire = (type) =>
        document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
      fire("dragenter");
      fire("dragover");
      fire("drop");
    },
    ATTACHMENT,
  );
  let attached = false;
  for (let attempt = 0; attempt < 40 && !attached; attempt += 1) {
    await first.panel.waitForTimeout(250);
    attached = (await bodyText(first.panel)).includes(ATTACHMENT);
  }
  ok("the attachment bar has a file to carry", attached);

  await typeDraft(first);

  // 1. Copy with everything selected, paste into another composer.
  const second = await openPanel();
  await connect(second.panel);
  await clearComposer(second);

  await first.composer.click();
  await first.panel.keyboard.press(`${MOD}+a`);
  await first.panel.keyboard.press(`${MOD}+c`);
  await second.composer.click();
  await second.panel.keyboard.press(`${MOD}+v`);
  await second.panel.waitForTimeout(400);
  const pasted = await bodyText(second.panel);
  ok("the draft text came across", pasted.includes(DRAFT));
  ok("the attachment came across with it", pasted.includes(ATTACHMENT));
  ok("copying left the source composer alone", (await bodyText(first.panel)).includes(ATTACHMENT));

  // 2. A partial selection must not carry anything extra (so: a fresh, empty composer).
  const third = await openPanel();
  await connect(third.panel);
  await first.composer.click();
  await first.panel.keyboard.press(`${MOD}+a`);
  // Select a strict prefix programmatically: keyboard shrinking of a select-all is not
  // reliable enough to build a test on.
  const partialText = await first.panel.evaluate(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    const node = editor.firstChild;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 4);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
  await first.panel.keyboard.press(`${MOD}+c`);
  await third.composer.click();
  await third.panel.keyboard.press(`${MOD}+v`);
  await third.panel.waitForTimeout(400);
  const partial = await bodyText(third.panel);
  ok("a partial selection still pastes its text", partial.includes(partialText), `copied ${JSON.stringify(partialText)}`);
  ok("a partial selection does not carry attachments", !partial.includes(ATTACHMENT));

  // 3. Cut loses the text (that is the browser's own cut) but leaves the bar alone, and
  // still carries everything. Paste into a fresh panel so nothing can come from step 1.
  const fourth = await openPanel();
  await connect(fourth.panel);
  await first.composer.click();
  await first.panel.keyboard.press(`${MOD}+a`);
  await first.panel.keyboard.press(`${MOD}+x`);
  await first.panel.waitForTimeout(300);
  const cutSource = await bodyText(first.panel);
  ok("cut took the text out of the source composer", !cutSource.includes(DRAFT));
  ok("cut left the attachment bar alone", cutSource.includes(ATTACHMENT));
  await fourth.composer.click();
  await fourth.panel.keyboard.press(`${MOD}+v`);
  await fourth.panel.waitForTimeout(400);
  const afterCut = await bodyText(fourth.panel);
  ok("cut carries text and attachments like copy", afterCut.includes(DRAFT) && afterCut.includes(ATTACHMENT));

  // 4. Pasting an image still lands in the attachment bar.
  await clearComposer(second);
  await second.panel.evaluate((bytes) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File([new Uint8Array(bytes)], "paste.png", { type: "image/png" }));
    document
      .querySelector('[contenteditable="true"]')
      .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
  }, [...PNG]);
  let imageChip = false;
  for (let attempt = 0; attempt < 40 && !imageChip; attempt += 1) {
    await second.panel.waitForTimeout(250);
    imageChip = (await bodyText(second.panel)).includes("paste");
  }
  ok("pasting an image still attaches it", imageChip);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`--- first panel ---\n${await bodyText(first.panel)}\n--- second panel ---\n${await bodyText(second.panel)}\n------------------`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
