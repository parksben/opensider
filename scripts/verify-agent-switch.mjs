#!/usr/bin/env node
// Does the Agent pill keep telling the truth while a turn runs?
//
// The Host pushes its state mirror (`ui.state`) on every `hello` — i.e. on every service
// worker / host reconnect, and right after an `agent.connect`. That mirror is written
// asynchronously and is usually *behind* the panel: a running turn's transcript is
// deliberately not persisted, and a 59MB state takes seconds to land. Restoring it
// unconditionally (the old `preferHostState` compared it against the snapshot taken at
// hydration, so it always looked "newer") rolled the panel back to a moment before the
// user switched agents:
//
//   - the pill showed the previous agent while the new one was actually running, and
//   - clicking the running agent did nothing, because it was already the connected one.
//
// This drives the real panel: switch agent, start a turn, hand the Host a stale mirror,
// force a reconnect, then click the agent the pill wrongly stopped showing.
//
//   node scripts/verify-agent-switch.mjs          # expects packages/extension/dist
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-agentswitch-", dist });
// Hermes 和 OpenCode 都指到同一个假 Agent：初始连着 Hermes，测的是「切到另一家」。
for (const bin of ["hermes-acp", "opencode"]) {
  const stub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", bin);
  mkdirSync(dirname(stub), { recursive: true });
  writeFileSync(stub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
  chmodSync(stub, 0o755);
}

const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  // 一轮要跑得够久，好在中间插一次「重连 + 旧镜像」。
  env: { FAKE_ACP_CHUNKS: "60", FAKE_ACP_CHUNK_MS: "500", FAKE_ACP_TRACE: sandbox.tracePath },
});

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
    selectedProviderId: "hermes",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [
      { id: "s1", title: "current", createdAt: now, updatedAt: now, todos: [], artifacts: [], messages: [] },
      {
        id: "s0",
        title: "history",
        createdAt: now,
        updatedAt: now,
        todos: [],
        artifacts: [],
        messages: [
          { id: "h1", role: "user", content: [{ type: "text", text: "an older question" }], createdAt: now },
          { id: "h2", role: "assistant", content: [{ type: "text", text: "an older answer" }], createdAt: now, durationMs: 4200 },
        ],
      },
    ],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 620, height: 860 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByText("Ask every time").first().waitFor({ timeout: 90_000 });

  const pill = () => panel.locator('button[title^="Switch agent"]').innerText();
  const userBubbles = () => panel.getByText("a long turn on opencode", { exact: false }).count();

  ok("the panel starts on the remembered agent", (await pill()).includes("Hermes"), await pill());

  await panel.locator('button[title^="Switch agent"]').click();
  await panel.getByRole("button", { name: "OpenCode", exact: true }).click();
  const cancel = panel.getByRole("button", { name: /^Cancel$|^取消$/ });
  await cancel.waitFor({ state: "visible", timeout: 20_000 }).catch(() => undefined);
  await cancel.waitFor({ state: "hidden", timeout: 90_000 }).catch(() => undefined);
  await sleep(500);
  ok("switching agents shows the new one", (await pill()).includes("OpenCode"), await pill());

  await composer.click();
  await panel.keyboard.type("a long turn on opencode");
  await panel.keyboard.press("Enter");
  await sleep(1200);
  ok("the message is on screen and the turn is running", (await userBubbles()) > 0, `bubbles=${await userBubbles()}`);

  // 交给 Host 一份「切换之前」的镜像（真实形态：状态几十 MB、写盘要几秒，于是镜像落后于
  // 内存），再强制重连一次 —— 新 Host 会在 hello 时把这份镜像推给面板。savedAt 取一个比
  // 面板自己那次写更晚的时刻：旧代码就是这样「镜像总显得更新」，于是整份灌回内存。
  const mirrorPath = join(sandbox.home, ".opensider", "ui-state.json");
  const mirror = JSON.parse(readFileSync(mirrorPath, "utf8"));
  writeFileSync(
    mirrorPath,
    JSON.stringify({
      ...mirror,
      selectedProviderId: "hermes",
      savedAt: new Date(Date.now() + 2000).toISOString(),
    }),
  );
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: "reconnect" }));
  await sleep(6000);

  ok(
    "a stale host mirror no longer rewrites the running session's agent",
    (await pill()).includes("OpenCode"),
    `pill=${await pill()}`,
  );
  ok(
    "the running turn's message survives the mirror push",
    (await userBubbles()) > 0,
    `bubbles=${await userBubbles()}`,
  );

  // 点一次「当前真的连着的那家」：以前这里什么都不会发生（requestConnect 早退），
  // 现在至少要保证点完还显示它、而且不会莫名其妙弹「切换会打断任务」。
  await panel.locator('button[title^="Switch agent"]').click();
  await sleep(200);
  await panel.getByRole("button", { name: "OpenCode", exact: true }).click();
  await sleep(400);
  ok(
    "clicking the connected agent keeps showing it and does not ask to interrupt",
    (await pill()).includes("OpenCode") &&
      (await panel.getByText(/Switching the agent/i).count()) === 0,
    `pill=${await pill()}`,
  );
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
