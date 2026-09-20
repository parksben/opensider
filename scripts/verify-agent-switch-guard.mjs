#!/usr/bin/env node
// 有任务在跑的时候，从 header 左上角切 Agent 必须先问一句：Host 会停掉旧 runtime，正在跑的
// 那几轮会被打断，不能默默切走。
//
//   ok 有运行中任务 → 弹全局面板式确认（数量正确、两个按钮在位）
//   ok 取消       → 什么都没发生（host.log 里没有新的 runtime）
//   ok 确认       → 新 runtime 起来、会话不再显示在跑
//   ok 没有在跑的任务 → 不弹窗，直接切
//
// 文案与用户逐字确认过（见 i18n 的 switchAgent*）。
//
//   node scripts/verify-agent-switch-guard.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { createSandbox, check, extensionIdFromDist, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, passed, detail = "") => check(name, passed, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-switch-guard-", dist });
const hostLog = join(sandbox.home, ".opensider", "host.log");
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    // 一轮慢慢吐：测试期间那一轮必须还在跑（400 × 300ms ≈ 2 分钟）。
    FAKE_ACP_CHUNKS: "400",
    FAKE_ACP_CHUNK_MS: "300",
  },
});
const ourId = extensionIdFromDist(dist);
const runtimeReady = () => {
  if (!existsSync(hostLog)) return 0;
  return readFileSync(hostLog, "utf8").split("\n").filter((line) => line.includes("acp runtime ready")).length;
};

try {
  const worker = await waitForWorker(context, 60_000);
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate(
    (payload) => chrome.storage.local.set({ "opensider/state": payload }),
    {
      version: 1,
      savedAt: now,
      locale: "en",
      theme: "dark",
      selectedId: "s1",
      selectedModelId: "",
      selectedModelByProvider: {},
      agentMode: "ask",
      selectedProviderId: "copilot",
      onboardingCompleted: true,
      sessionsOpen: false,
      sessionDrawerWidth: 248,
      sessions: [{ id: "s1", title: "guard", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
    },
  );

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 700 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.bringToFront();
  // 输入框在「正在连接」时就已经渲染出来了，所以光等 composer 不够：这之前按下回车，消息
  // 只会躺进会话里没有 runtime 可发。等 Host 把 runtime 拉起来（host.log）再动键盘。
  let ready = 0;
  for (let i = 0; i < 120 && ready === 0; i += 1) {
    ready = runtimeReady();
    if (ready === 0) await sleep(250);
  }
  ok("the host runtime is ready before typing", ready > 0);

  const composer = panel.locator('[contenteditable="true"]');
  try {
    await composer.waitFor({ state: "visible", timeout: 40_000 });
  } catch {
    // 面板没连上时把屏幕上的文字打出来，比一句 timeout 有用得多。
    const shown = await panel.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
      html: document.body.innerHTML.length,
    }));
    ok("the panel connected to the fake agent", false, JSON.stringify(shown));
    throw new Error("the composer never appeared");
  }
  ok("the panel connected to the fake agent", true);

  const switcher = panel.locator('button[aria-label="Switch agent"]');
  const dialog = panel.getByRole("dialog");
  const pickAgent = async (name) => {
    await switcher.click({ timeout: 10_000 });
    await panel.getByText(name, { exact: true }).last().click({ timeout: 10_000 });
  };

  // ---------------------------------------------------------------- 有任务在跑
  await composer.click();
  await panel.keyboard.type("hold the turn open");
  await panel.keyboard.press("Enter");
  // 「停止」钮只在某一轮跑着时出现——它就是「有任务在执行」的可见判据。
  const stopButton = panel.locator('button[aria-label="Stop"]');
  const runningAppeared = await stopButton
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  ok("a turn is running", runningAppeared);

  const beforeCancel = runtimeReady();
  await pickAgent("Gemini");
  const dialogShown = await dialog
    .waitFor({ state: "visible", timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const text = dialogShown ? (await dialog.innerText()).replace(/\s+/g, " ") : "";
  ok(
    "switching with a task running asks first, with the right count",
    dialogShown && text.includes("1 task is still running") && text.includes("Switch Agent"),
    text.slice(0, 120) || "no dialog",
  );
  ok(
    "the dialog offers Cancel and a danger Switch",
    dialogShown &&
      (await dialog.getByRole("button", { name: "Cancel" }).count()) === 1 &&
      (await dialog.getByRole("button", { name: "Switch" }).count()) === 1,
    dialogShown ? `${await dialog.getByRole("button").count()} buttons` : "no dialog",
  );
  const dangerTone = dialogShown
    ? await dialog
        .getByRole("button", { name: "Switch" })
        .evaluate((node) => getComputedStyle(node).backgroundColor)
        .catch(() => "")
    : "";
  ok("the Switch button uses the theme danger colour", /rgb\(/.test(dangerTone) && dangerTone !== "rgba(0, 0, 0, 0)", dangerTone || "unreadable");

  // Cancel: nothing may happen.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await sleep(1500);
  ok(
    "Cancel switches nothing (no new host runtime)",
    runtimeReady() === beforeCancel,
    `runtime ready ${beforeCancel} → ${runtimeReady()}`,
  );
  ok("Cancel closes the dialog", (await dialog.count()) === 0);

  // Confirm: the host starts a new runtime and the interrupted turn stops showing as running.
  await pickAgent("Gemini");
  await dialog.getByRole("button", { name: "Switch" }).waitFor({ state: "visible", timeout: 5_000 });
  await dialog.getByRole("button", { name: "Switch" }).click();
  let switched = false;
  for (let i = 0; i < 60 && !switched; i += 1) {
    await sleep(500);
    switched = runtimeReady() > beforeCancel;
  }
  ok("confirming really switches (the host starts a new runtime)", switched, `runtime ready ${beforeCancel} → ${runtimeReady()}`);
  const stopGone = await stopButton
    .waitFor({ state: "detached", timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  ok("the interrupted turn no longer shows as running", stopGone);

  // ---------------------------------------------------------------- 没有任务在跑
  const beforeQuiet = runtimeReady();
  await pickAgent("GitHub Copilot");
  await sleep(1200);
  ok("switching with nothing running asks nothing", (await dialog.count()) === 0, `${await dialog.count()} dialogs`);
  let quietSwitch = false;
  for (let i = 0; i < 60 && !quietSwitch; i += 1) {
    await sleep(500);
    quietSwitch = runtimeReady() > beforeQuiet;
  }
  ok("that switch went through without a prompt", quietSwitch, `runtime ready ${beforeQuiet} → ${runtimeReady()}`);
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 200));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
