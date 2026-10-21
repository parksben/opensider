#!/usr/bin/env node
// Guards "reopen the panel, keep chatting in an old session" when the Agent cannot reload
// the ACP session (new process / adapter without session/load).
//
// The host falls back to `session/new` and tells the panel `{ created: true }`. The panel
// must turn the local transcript into `pendingForkContext`, otherwise the next prompt goes
// out with no history and the Agent looks like it lost the thread ("断片").
//
// The fake agent fails `session/load` on purpose (FAKE_ACP_FAIL_LOAD=1) and traces the full
// prompt text, so the check is on what the Agent actually received.
//
//   HEADED=1 node scripts/verify-session-recover.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  check,
  createSandbox,
  launchSandbox,
  loadPlaywright,
  waitForWorker,
} from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-session-recover-", dist });
// The JS fake is the normal one, but Node can be instrumented on this machine (an endpoint
// agent injects a --require probe that blocks startup). Point the stub at the Python twin.
const stub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", "copilot");
writeFileSync(stub, `#!/bin/sh\nexec python3 "${join(root, "scripts", "fake-acp-agent.py")}" "$@"\n`);
chmodSync(stub, 0o755);
const { tracePath } = sandbox;
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: {
    FAKE_ACP_CHUNKS: "2",
    FAKE_ACP_CHUNK_MS: "60",
    FAKE_ACP_TRACE: tracePath,
    FAKE_ACP_TRACE_FULL: "1",
    FAKE_ACP_FAIL_LOAD: "1",
    // 本机 AgentD 会给每个 node 进程注入 --require 探针；它偶发卡住假 Agent 的启动，
    // 与本次要验的东西无关，测试里清掉。
    NODE_OPTIONS: "",
    FAKE_MODES: "none",
    FAKE_OPTIONS: "none",
  },
});

const traceEvents = () => {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
};

const waitTrace = async (test, timeoutMs = 20_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = traceEvents().findLast(test);
    if (hit) return hit;
    await sleep(200);
  }
  return undefined;
};

let panel;
try {
  const worker = await waitForWorker(context);
  const extensionId = new URL(worker.url()).host;
  ok("extension service worker started", Boolean(extensionId));

  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }
  ok("the sandboxed extension is up", storageReady);

  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "dark",
    selectedId: "recover-1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [
      {
        id: "recover-1",
        title: "recover",
        createdAt: now,
        updatedAt: now,
        acpSessionId: "fake-old-session",
        acpByProvider: { copilot: "fake-old-session" },
        todos: [],
        artifacts: [],
        messages: [
          {
            id: "recover-u1",
            role: "user",
            content: [{ type: "text", text: "seeded prior question" }],
            createdAt: now,
          },
          {
            id: "recover-a1",
            role: "assistant",
            content: [{ type: "text", text: "seeded prior answer" }],
            createdAt: now,
            durationMs: 1000,
          },
        ],
      },
    ],
  });

  const hostLog = join(sandbox.home, ".opensider", "host.log");
  let hostIdle = false;
  for (let i = 0; i < 120 && !hostIdle; i += 1) {
    hostIdle = existsSync(hostLog) && /idle agents=/.test(readFileSync(hostLog, "utf8"));
    if (!hostIdle) await sleep(250);
  }
  ok("the host is up and idle before the panel opens", hostIdle);

  panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 640 });
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.locator('[contenteditable="true"]').waitFor({ state: "visible", timeout: 60_000 });
  ok("the panel opened", true);

  const failedLoad = await waitTrace((entry) => entry.event === "load_failed", 20_000);
  ok(
    "session/load was refused (the old ACP session is gone)",
    Boolean(failedLoad),
    JSON.stringify(failedLoad ?? {}),
  );
  // The panel applies the host's `session` reply (created:true) before the next send; give
  // the round trip a beat so the test does not race the fix it is testing.
  await sleep(1200);

  const composer = panel.locator('[contenteditable="true"]');
  await composer.click();
  await panel.keyboard.type("follow up question");
  await panel.keyboard.press("Enter");

  const prompt = await waitTrace(
    (entry) => entry.event === "prompt" && String(entry.text ?? "").includes("follow up question"),
    20_000,
  );
  ok("the follow-up reached the Agent", Boolean(prompt), JSON.stringify(prompt ?? {}));
  const text = String(prompt?.text ?? "");
  ok("the prompt carries the fork wrapper", text.includes("prior messages only"), text.slice(0, 160));
  ok("the prompt carries the earlier user turn", text.includes("seeded prior question"), text.slice(0, 240));
  ok("the prompt carries the earlier assistant turn", text.includes("seeded prior answer"), text.slice(0, 240));
  const sessionId = String(prompt?.sessionId ?? "");
  ok("the prompt went to the new ACP session", sessionId !== "" && sessionId !== "fake-old-session", sessionId);
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 240));
} finally {
  await panel?.close().catch(() => undefined);
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
