#!/usr/bin/env node
// Verifies copying an already-sent user message from its context menu, end to end:
//
//   right-click a user bubble -> "Copy message" -> the clipboard holds its text, and the
//   attachment chips are remembered the same way the composer's own copy does it
//   paste into an empty composer -> text AND attachment chips come back
//
//   node scripts/verify-message-copy.mjs          # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MOD = process.platform === "darwin" ? "Meta" : "Control";
const TEXT = "这个卡片的高度再压一压，顺便看下附件里的口径";
const ATTACHMENT = "vitals-spec.txt";

const sandbox = createSandbox({ root, prefix: "opensider-msgcopy-", dist });
const attachmentPath = join(sandbox.workspace, "vitals-spec.txt");
mkdirSync(dirname(attachmentPath), { recursive: true });
writeFileSync(attachmentPath, "P95 口径说明\n");

const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox, env: { FAKE_ACP_CHUNKS: "2", FAKE_ACP_CHUNK_MS: "20" } });

const bodyText = (panel) => panel.evaluate(() => document.body.innerText);
// 只看输入框这一块：消息列表里本来就带着那条消息和它的附件。
const composerText = (panel) => panel.locator(".cs-composer").innerText();
const appears = (locator) =>
  locator.waitFor({ state: "visible", timeout: 30_000 }).then(
    () => true,
    () => false,
  );

const worker = await waitForWorker(context, 60_000);
for (let i = 0; i < 40; i += 1) {
  if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
  await sleep(250);
}

try {
  const now = Date.now();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: new Date(now).toISOString(),
    locale: "en",
    theme: "light",
    selectedId: "s1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [
      {
        id: "s1",
        title: "copy me",
        createdAt: new Date(now - 2000).toISOString(),
        updatedAt: new Date(now).toISOString(),
        todos: [],
        artifacts: [],
        messages: [
          {
            id: "s1-u",
            role: "user",
            createdAt: new Date(now - 2000).toISOString(),
            content: [{ type: "text", text: TEXT }],
            attachments: [{ path: attachmentPath, name: ATTACHMENT, kind: "file" }],
          },
        ],
      },
    ],
  });

  const openPanel = async () => {
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
    const composer = panel.locator('[contenteditable="true"]');
    await Promise.race([
      appears(composer),
      appears(panel.getByRole("button", { name: "GitHub Copilot" })),
    ]);
    const agentButton = panel.getByRole("button", { name: "GitHub Copilot" });
    if (await agentButton.isVisible().catch(() => false)) await agentButton.click({ timeout: 20_000 });
    await composer.waitFor({ state: "visible", timeout: 40_000 });
    return { panel, composer };
  };

  const first = await openPanel();
  const bubble = first.panel.locator(".cs-user-bubble").first();
  await bubble.waitFor({ state: "visible", timeout: 30_000 });
  ok("the seeded user message is on screen with its attachment", (await bodyText(first.panel)).includes(ATTACHMENT));

  // 1. Right-click opens the menu.
  await bubble.click({ button: "right" });
  const menuItem = first.panel.getByRole("menuitem", { name: "Copy message" });
  const menuShown = await appears(menuItem);
  ok("right-clicking a user bubble offers Copy message", menuShown);

  // 2. Escape closes it without copying.
  await first.panel.keyboard.press("Escape");
  ok("Escape closes the menu", !(await menuItem.isVisible().catch(() => false)));

  // 3. Copy, then paste into an empty composer in another panel.
  await bubble.click({ button: "right" });
  await menuItem.waitFor({ state: "visible", timeout: 10_000 });
  await menuItem.click();
  ok("the menu closes after copying", !(await menuItem.isVisible().catch(() => false)));

  const second = await openPanel();
  await second.composer.click();
  await second.panel.keyboard.press(`${MOD}+v`);
  await sleep(500);
  const pasted = await composerText(second.panel);

  ok("the message text comes back", pasted.includes(TEXT.slice(0, 12)), pasted.slice(0, 120));
  ok("the attachment comes back as a chip", pasted.includes(ATTACHMENT), pasted);

  // 4. Pasting something else must not drag the old attachment along: the carry only
  //    comes back for the exact text that was copied.
  const third = await openPanel();
  await third.panel.evaluate(() => navigator.clipboard.writeText("unrelated clipboard text"));
  await third.composer.click();
  await third.panel.keyboard.press(`${MOD}+v`);
  await sleep(400);
  const mixed = await composerText(third.panel);
  ok(
    "unrelated text pastes without the old attachment",
    mixed.includes("unrelated clipboard text") && !mixed.includes(ATTACHMENT),
    mixed,
  );
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
