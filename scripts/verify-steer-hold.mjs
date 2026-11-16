#!/usr/bin/env node
// Verifies how a message sent during a running turn is handled in each send mode:
//
//   steer (Hermes, caps.steer): the message appears in the transcript immediately —
//     - text only: injected into the running turn (`/steer`, no "waiting" mark)
//     - with an attachment (cannot ride Hermes' text-only channel): stays on screen
//       with a "Waiting for the agent" line and NO queue card, then goes out as the
//       next turn once the running one ends
//   queue mode is covered by scripts/verify-queue-send-now.mjs (cards + persistence)
//
//   node scripts/verify-steer-hold.mjs          # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-steer-", dist });
// Hermes 是唯一声明 caps.steer 的 profile；入口仍指向假 Agent，测的只是消息流。
const hermesStub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", "hermes-acp");
mkdirSync(dirname(hermesStub), { recursive: true });
writeFileSync(hermesStub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
chmodSync(hermesStub, 0o755);

const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    // 一轮要跑十几秒，中间才有时间在「运行中」发消息。
    FAKE_ACP_CHUNKS: "40",
    FAKE_ACP_CHUNK_MS: "300",
    FAKE_ACP_TRACE: sandbox.tracePath,
  },
});

const trace = () => (existsSync(sandbox.tracePath) ? readFileSync(sandbox.tracePath, "utf8") : "");

try {
  const worker = await waitForWorker(context, 60_000);
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
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
    sessions: [{ id: "s1", title: "steer", createdAt: now, updatedAt: now, todos: [], artifacts: [], messages: [] }],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 620, height: 860 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByText("Ask every time").first().waitFor({ timeout: 90_000 });

  // 切到 Hermes（caps.steer=true），底部才会出现「引导 / 队列」胶囊。
  await panel.locator('button[title^="Switch agent"]').click();
  await panel.getByRole("button", { name: "Hermes", exact: true }).click();
  const cancelConnect = panel.getByRole("button", { name: /^Cancel$|^取消$/ });
  await cancelConnect.waitFor({ state: "visible", timeout: 30_000 });
  await cancelConnect.waitFor({ state: "hidden", timeout: 90_000 });

  const send = async (text) => {
    await composer.click();
    await panel.keyboard.type(text);
    await panel.keyboard.press("Enter");
  };
  const bubbles = () => panel.locator(".cs-user-bubble").count();
  const queueCards = () => panel.locator("ol.cs-list-cap li").count();
  const badge = () =>
    panel
      .getByText("Waiting for the agent")
      .count()
      .catch(() => 0);

  // 1. 开一轮：跑起来后底部会出现引导胶囊。先等这一轮真的到过 Agent（切 Agent
  //    之后会话要先绑定，抢在绑定前发消息会落在「待绑定」那条路上）。
  await send("turn one");
  for (let i = 0; i < 120 && !trace().includes("turn one"); i += 1) await sleep(250);
  ok("the first turn reaches the agent", trace().includes("turn one"));
  const steerPill = panel.locator('button[title^="Message send mode"]');
  try {
    await steerPill.waitFor({ state: "visible", timeout: 15_000 });
  } catch (error) {
    const dump = await panel.evaluate(() => {
      const composer = document.querySelector(".cs-composer");
      const footer = composer?.nextElementSibling;
      return {
        footer: (footer?.textContent || "").trim(),
        titles: [...(footer?.querySelectorAll("button") || [])].map((b) => b.getAttribute("title")),
        agent: document.querySelector('button[title^="Switch agent"]')?.textContent,
      };
    });
    console.log("DEBUG", JSON.stringify(dump));
    throw error;
  }
  ok("a running turn shows the send-mode pill", (await steerPill.count()) === 1);

  // 2. 引导 + 纯文本：立刻上屏，直接注入当前轮，不挂「等待」。
  await send("steer text only");
  for (let i = 0; i < 40 && (await bubbles()) < 2; i += 1) await sleep(250);
  ok("a text-only steer lands in the transcript right away", (await bubbles()) === 2, `bubbles=${await bubbles()}`);
  ok("a text-only steer shows no waiting mark", (await badge()) === 0);
  ok("a text-only steer never becomes a queue card", (await queueCards()) === 0);
  for (let i = 0; i < 40 && !trace().includes("/steer steer text only"); i += 1) await sleep(250);
  ok("the host received it as a steer prompt", trace().includes("/steer steer text only"));

  // 3. 引导 + 附件：附件过不了 Hermes 的纯文本通道，所以上屏后挂着等这一轮结束。
  await panel.evaluate(() => {
    const file = new File([new TextEncoder().encode("attached notes")], "notes.txt", { type: "text/plain" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    for (const type of ["dragenter", "dragover", "drop"]) {
      document.body.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }));
    }
  });
  for (let i = 0; i < 40 && (await panel.getByText("notes.txt").count()) === 0; i += 1) {
    await sleep(250);
  }
  await send("steer with an attachment");
  for (let i = 0; i < 60 && (await bubbles()) < 3; i += 1) await sleep(250);
  ok("the held message is on screen while the turn runs", (await bubbles()) === 3, `bubbles=${await bubbles()}`);
  for (let i = 0; i < 40 && (await badge()) === 0; i += 1) await sleep(250);
  ok("it carries the waiting mark", (await badge()) === 1, `badge=${await badge()}`);
  ok("and still no queue card", (await queueCards()) === 0);

  // 4. 本轮结束后，挂着的那条自动作为新一轮发出（不是 /steer，是正式 prompt）。
  for (let i = 0; i < 160 && (await badge()) > 0; i += 1) await sleep(250);
  ok("the waiting mark clears once the turn ends", (await badge()) === 0, `badge=${await badge()}`);
  for (let i = 0; i < 80 && !trace().includes("steer with an attachment"); i += 1) await sleep(250);
  const lines = trace().split("\n").filter((line) => line.includes("steer with an attachment"));
  ok(
    "the held message went out as a normal prompt, not a steer",
    lines.length > 0 && lines.every((line) => !line.includes("/steer")),
    lines.join(" | ").slice(0, 240),
  );
  ok("the transcript still holds exactly one copy of it", (await bubbles()) === 3, `bubbles=${await bubbles()}`);
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
