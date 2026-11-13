#!/usr/bin/env node
// Verifies the artifact list actions and the browser markdown preview page:
//
//   - the artifact header gets an "open artifacts folder" button left of the chevron
//   - a markdown artifact gets a "preview" button left of the reveal button
//   - clicking preview opens the extension preview page and renders the markdown
//
//   node scripts/verify-artifact-preview.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sandbox = createSandbox({ root, prefix: "opensider-artifact-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox });
try {
  const worker = await waitForWorker(context, 60_000);
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await sleep(250);
  }

  const artifact = join(sandbox.workspace, "outputs", "plan.md");
  mkdirSync(dirname(artifact), { recursive: true });
  writeFileSync(artifact, "# Artifact preview\n\nThis markdown came from the artifact list.\n", { flag: "w" });

  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1, savedAt: now, locale: "en", theme: "dark", selectedId: "s1",
    selectedModelId: "", selectedModelByProvider: {}, agentMode: "ask",
    selectedProviderId: "copilot", onboardingCompleted: true, sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{
      id: "s1", title: "artifact", createdAt: now, updatedAt: now, todos: [],
      artifacts: [{ path: artifact, name: "plan.md", kind: "file" }],
      messages: [],
    }],
  });

  const panel = await context.newPage();
  panel.on("pageerror", (error) => console.log(`[panel] ${error.message}`));
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.locator('[contenteditable="true"]').waitFor({ state: "visible", timeout: 40_000 });

  const folder = panel.getByRole("button", { name: "Open artifacts folder" });
  await folder.waitFor({ state: "visible", timeout: 20_000 });
  ok("the artifact header has an open-folder button", (await folder.count()) === 1);
  ok("the open-folder button has the requested tooltip", (await folder.getAttribute("aria-label")) === "Open artifacts folder");

  const row = panel.locator("li.group").first();
  await row.waitFor({ state: "visible", timeout: 20_000 });
  await row.hover();
  const preview = panel.getByRole("button", { name: "Preview" });
  ok("the artifact row has a preview button", (await preview.count()) === 1);

  const [viewer] = await Promise.all([
    context.waitForEvent("page", { timeout: 20_000 }),
    preview.click(),
  ]);
  viewer.on("pageerror", (error) => console.log(`[viewer] ${error.message}`));
  await viewer.waitForLoadState("domcontentloaded");
  await viewer.locator(".preview-doc").waitFor({ state: "visible", timeout: 20_000 });
  const heading = await viewer.locator(".preview-doc h1").innerText();
  ok("the markdown preview renders the file", heading.includes("Artifact preview"), heading);
  ok("the preview page is an extension page", viewer.url().startsWith(`chrome-extension://${sandbox.extensionId}/src/preview/index.html`), viewer.url());
  const hostLog = join(sandbox.home, ".opensider", "host.log");
  for (let i = 0; i < 40 && !(existsSync(hostLog) && readFileSync(hostLog, "utf8").includes("fs.read")); i += 1) await sleep(200);
  ok("the host served the file over fs.read", existsSync(hostLog) && readFileSync(hostLog, "utf8").includes("fs.read"));

  const textPath = join(sandbox.workspace, "outputs", "notes.txt");
  writeFileSync(textPath, "plain text preview\nsecond line\n");
  const imagePath = join(sandbox.workspace, "outputs", "dot.png");
  writeFileSync(imagePath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ));
  const previewUrl = `chrome-extension://${sandbox.extensionId}/src/preview/index.html`;
  const textViewer = await context.newPage();
  await textViewer.goto(`${previewUrl}?path=${encodeURIComponent(textPath)}&name=notes.txt`);
  await textViewer.locator(".preview-text").waitFor({ state: "visible", timeout: 20_000 });
  ok("the text preview renders plain files", (await textViewer.locator(".preview-text").innerText()).includes("second line"));

  const imageViewer = await context.newPage();
  await imageViewer.goto(`${previewUrl}?path=${encodeURIComponent(imagePath)}&name=dot.png`);
  const image = imageViewer.locator(".preview-image");
  await image.waitFor({ state: "visible", timeout: 20_000 });
  ok("the image preview loads the blob", (await image.evaluate((el) => el.naturalWidth)) === 1);
} finally {
  await context.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed === 0 ? 0 : 1);
