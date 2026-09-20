#!/usr/bin/env node
// Sending while the agent is still connecting must not swallow the message: the draft stays
// in the composer and goes out by itself once the host reports ready.
//
// The旧 code上屏了气泡就停在 `status !== "ready"`，prompt 没有会话可发，Host 连上也不会补发
// ——用户看到的就是「消息被吞了」。
//
//   ok 打字时 runtime 还没起来（不然这条窗口没测到）
//   ok 草稿留在输入框里（没被清空）
//   ok 没有报「离线发送」（用户没做错什么）
//   ok 也没有先把气泡上屏（会话里还是空的）
//   ok 就绪之后 prompt 真的发出去了，内容就是草稿
//   ok 只发了一条（补发不是重发）
//   ok 正文照常流式出来，草稿同时被消费掉
//
//   node scripts/verify-held-send.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const draft = "hold this until the agent is up";
const results = [];
const ok = (name, passed, detail = "") => check(name, passed, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-held-send-", dist });
const hostLog = join(sandbox.home, ".opensider", "host.log");
// 让 Host 晚几秒起来：面板先打开、先打字，才稳定落在「连接还没就绪」这个窗口里
// （不延迟的话本机快起来就直接 ready 了，测的是另一条路）。
const launcher = join(sandbox.dir, "launch-host.sh");
writeFileSync(launcher, readFileSync(launcher, "utf8").replace("exec ", "sleep ${HOST_DELAY:-4}\nexec "));
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    FAKE_ACP_TRACE: sandbox.tracePath,
    FAKE_ACP_CHUNKS: "20",
    FAKE_ACP_CHUNK_MS: "200",
  },
});
const ourId = sandbox.extensionId;
const runtimeReady = () => {
  if (!existsSync(hostLog)) return 0;
  return readFileSync(hostLog, "utf8").split("\n").filter((line) => line.includes("acp runtime ready")).length;
};
const trace = () => {
  if (!existsSync(sandbox.tracePath)) return [];
  return readFileSync(sandbox.tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
};

try {
  const worker = await waitForWorker(context, 60_000);
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
    selectedId: "h1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{ id: "h1", title: "held", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 700 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.bringToFront();
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 40_000 });
  ok("the runtime was still starting when we typed", runtimeReady() === 0);

  // 连接还没就绪就发。
  await composer.click();
  await panel.keyboard.type(draft);
  await panel.keyboard.press("Enter");
  await sleep(800);

  const composerText = async () =>
    (await panel.evaluate(() => document.querySelector('[contenteditable="true"]')?.textContent ?? "")).trim();
  const panelText = () => panel.evaluate(() => document.body.innerText);
  const storedMessages = () =>
    worker.evaluate(async () => {
      const bag = await chrome.storage.local.get("opensider/state");
      return (bag["opensider/state"]?.sessions ?? []).reduce((total, s) => total + (s.messages?.length ?? 0), 0);
    });

  ok("the draft stays in the composer", (await composerText()).includes(draft), `composer="${await composerText()}"`);
  ok(
    "it is not reported as an offline send",
    !(await panelText()).includes("Local agent is offline"),
    "no offline-send error on screen",
  );
  ok("no half-sent bubble was put on screen", (await storedMessages()) === 0, `${await storedMessages()} messages`);

  // 等 Host 起来并报 ready，那条 prompt 应该自己走出去。
  let ready = 0;
  for (let i = 0; i < 200 && ready === 0; i += 1) {
    ready = runtimeReady();
    if (ready === 0) await sleep(250);
  }
  ok("the host runtime came up", ready > 0);

  let prompts = [];
  for (let i = 0; i < 80 && prompts.length === 0; i += 1) {
    prompts = trace().filter((entry) => entry.event === "prompt");
    if (prompts.length === 0) await sleep(250);
  }
  ok(
    "the held prompt reached the agent",
    prompts.length > 0 && String(prompts[0].text ?? "").includes(draft),
    prompts.length ? String(prompts[0].text).slice(0, 120) : "no prompt in the trace",
  );
  await sleep(1200);
  ok(
    "it was sent exactly once",
    trace().filter((entry) => entry.event === "prompt").length === 1,
    `${trace().filter((entry) => entry.event === "prompt").length} prompts`,
  );

  // 正文照常流出来，草稿被消费掉。
  let streamed = false;
  for (let i = 0; i < 60 && !streamed; i += 1) {
    streamed = (await panelText()).includes("T1.3");
    if (!streamed) await sleep(250);
  }
  ok("the answer streams back", streamed);
  ok("the composer was consumed by the send", (await composerText()) === "", `composer="${await composerText()}"`);
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 200));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
