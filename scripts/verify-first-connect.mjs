#!/usr/bin/env node
// Guard for the panel's very first open after the extension was reloaded: the model list
// and the reasoning-effort pill have to load on their own, without touching anything.
//
// The panel decides whether to connect the remembered Agent from the host messages it gets
// (`agents` / `idle`), but its own local cache has to be read first (hydration). Reading a
// cache full of sessions is slower than the host's cached replay, so the replay used to land
// while every ref was still empty — the decision was skipped, and nothing ever decided again.
// The panel then looked fine but had no models and no effort pill until the user switched
// Agent by hand. This seeds a big local state (that is what makes the race lose) and opens
// the panel only after the host is up and idle, which is the state right after a reload.
//
//   node scripts/verify-first-connect.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createSandbox, check, extensionIdFromDist, loadPlaywright, cachedChromium } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const { chromium } = loadPlaywright();
const results = [];
const ok = (name, passed, detail = "") => check(name, passed, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-first-connect-", dist });
const hostLog = join(sandbox.home, ".opensider", "host.log");
const context = await chromium.launchPersistentContext(sandbox.profile, {
  headless: process.env.HEADLESS !== "0",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_MODES: "both",
    FAKE_OPTIONS: process.env.FAKE_OPTIONS ?? "claude",
    FAKE_ACP_TRACE: sandbox.tracePath,
  },
});

try {
  const ourId = extensionIdFromDist(dist);
  const findSw = () => context.serviceWorkers().find((worker) => worker.url().includes(ourId));
  let sw;
  for (let i = 0; !sw && i < 80; i += 1) {
    sw = findSw();
    if (!sw) await sleep(250);
  }
  if (!sw) throw new Error("extension service worker never started");
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }
  ok("the sandboxed extension is up", storageReady);

  // 真机上这个 key 里躺着几十个会话、上千条消息，fromPersisted 的解析量不小——正是这份
  // 慢，让「读缓存」跑不过 Host 回放。
  const now = new Date().toISOString();
  const sessions = [
    { id: "m1", title: "first", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] },
  ];
  for (let s = 0; s < 40; s += 1) {
    const messages = [];
    for (let m = 0; m < 200; m += 1) {
      messages.push({
        id: `s${s}-m${m}`,
        role: m % 2 === 0 ? "user" : "assistant",
        content: [{ type: "text", text: `message ${m} `.repeat(60) }],
        createdAt: now,
      });
    }
    sessions.push({
      id: `s${s}`,
      title: `session ${s}`,
      createdAt: now,
      updatedAt: now,
      messages,
      todos: [],
      artifacts: [],
    });
  }
  await sw.evaluate(
    (payload) => chrome.storage.local.set({ "opensider/state": payload }),
    {
      version: 1,
      savedAt: now,
      locale: "en",
      theme: "dark",
      selectedId: "m1",
      selectedModelId: "",
      selectedModelByProvider: {},
      agentMode: "ask",
      selectedProviderId: "copilot",
      onboardingCompleted: true,
      sessionsOpen: false,
      sessionDrawerWidth: 248,
      sessions,
    },
  );

  // 扩展重载之后的常态：Host 已经起来并且报过 idle，SW 的回放里有 idle + agents。
  let hostIdle = false;
  for (let i = 0; i < 120 && !hostIdle; i += 1) {
    hostIdle = existsSync(hostLog) && /idle agents=/.test(readFileSync(hostLog, "utf8"));
    if (!hostIdle) await sleep(250);
  }
  ok("the host is up and idle before the panel opens", hostIdle);
  await sleep(600);

  const panel = await context.newPage();
  panel.on("pageerror", (error) => console.log(`    panel pageerror: ${String(error).slice(0, 200)}`));
  await panel.setViewportSize({ width: 900, height: 620 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);

  const sample = () =>
    panel.evaluate(() => {
      const model = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Model");
      const effort = document.querySelector('button[title^="Effort"]');
      return {
        model: model ? (model.textContent || "").trim() : null,
        effort: effort ? effort.getAttribute("title") : null,
      };
    });

  let model = null;
  let effort = null;
  for (let i = 0; i < 60 && !(model && effort); i += 1) {
    const seen = await sample().catch(() => ({ model: null, effort: null }));
    if (seen.model && !model) model = { value: seen.model, seconds: (i * 0.5).toFixed(1) };
    if (seen.effort && !effort) effort = { value: seen.effort, seconds: (i * 0.5).toFixed(1) };
    if (!model || !effort) await sleep(500);
  }

  ok(
    "the model list loads on the first open, with nothing clicked",
    Boolean(model),
    model ? `${model.value} after ${model.seconds}s` : "nothing after 30s",
  );
  ok(
    "the reasoning-effort pill loads too",
    Boolean(effort),
    effort ? `${effort.value} after ${effort.seconds}s` : "nothing after 30s",
  );

  // 面板到底有没有真的让 Host 连上引擎：这条能区分「只是控件没画出来」和「压根没连」。
  const logged = existsSync(hostLog) ? readFileSync(hostLog, "utf8") : "";
  ok(
    "the host really connected an agent",
    /acp runtime ready/.test(logged),
    /acp runtime ready/.test(logged) ? "" : "no `acp runtime ready` in host.log",
  );
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 200));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
