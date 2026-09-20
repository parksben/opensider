#!/usr/bin/env node
// Guard for the panel's very first open after the extension was reloaded: the model list
// and the reasoning-effort pill have to load on their own, without touching anything.
//
// The panel decides whether to connect the remembered Agent from a state snapshot, and both
// halves of that snapshot can arrive late:
//
//   SCENARIO=local  (default) after an extension reload: the panel reads a big local cache
//                   (hydration）while the host's cached replay races it. Open the panel only
//                   after the host is up and idle — the state right after a reload.
//   SCENARIO=mirror after an uninstall + reinstall: chrome.storage is empty, so onboarding
//                   and the remembered Agent can only come from the host mirror, which is
//                   pushed in chunks and lands well after hydration.
//
// Either way the first open has to connect on its own: models, effort pill, one agent.connect.
//
//   node scripts/verify-first-connect.mjs
//   SCENARIO=mirror node scripts/verify-first-connect.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createSandbox, check, extensionIdFromDist, loadPlaywright, cachedChromium } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
// mirror = 卸载重装（本地缓存空、只有 Host 镜像）；local = 扩展重载（本地缓存大）。
const scenario = process.env.SCENARIO === "mirror" ? "mirror" : "local";
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
  if (scenario === "local") {
    let storageReady = false;
    for (let i = 0; i < 40 && !storageReady; i += 1) {
      storageReady = await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
      if (!storageReady) await sleep(250);
    }
    ok("the sandboxed extension is up", storageReady);
  } else {
    ok("the sandboxed extension is up", true, "fresh install: open the panel at once");
  }

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
  const seeded = {
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
  };

  // 两种场景是「引导状态从哪来」的两种极端：本地缓存，或者只能靠 Host 镜像。
  if (scenario === "mirror") {
    // 卸载重装：扩展本地缓存是空的，Host 那边的镜像还在（1MB 上下，分片推）。
    // 关键是**不等 Host**：镜像要等 Host 起来才推过来，而空缓存的 hydration 几乎是瞬间完成，
    // 所以镜像必然晚于 hydration——这正是真机上「装完立刻打开侧栏」的时序。
    writeFileSync(join(sandbox.home, ".opensider", "ui-state.json"), JSON.stringify(seeded));
    // 让 Host 晚一点起来：镜像必须**晚于** hydration 才做得到确定性复现（否则它会赶在
    // hydration 之前到，走的是另一条路——pendingHostState，那样旧代码也能连上）。
    const launcher = join(sandbox.dir, "launch-host.sh");
    writeFileSync(launcher, readFileSync(launcher, "utf8").replace("exec ", "sleep ${HOST_DELAY:-3}\nexec "));
    ok("the local cache is left empty (fresh install)", true, "no chrome.storage.local");
    await sleep(150);
  } else {
    await sw.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), seeded);
    // 真机上镜像与本地缓存内容一致；这里也写一份，时序才和真机一样。
    writeFileSync(join(sandbox.home, ".opensider", "ui-state.json"), JSON.stringify(seeded));
    // 扩展重载之后的常态：Host 已经起来并且报过 idle，SW 的回放里有 idle + agents。
    let hostIdle = false;
    for (let i = 0; i < 120 && !hostIdle; i += 1) {
      hostIdle = existsSync(hostLog) && /idle agents=/.test(readFileSync(hostLog, "utf8"));
      if (!hostIdle) await sleep(250);
    }
    ok("the host is up and idle before the panel opens", hostIdle);
    await sleep(600);
  }

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
  // `agent.connect` 只允许发一次：`agents` / `idle` 两条回放与 hydration 之后的判定容易
  // 落在同一拍，各发一次会把 Host 正在进行的连接一次次作废重来，结果谁也没连上（面板一直
  // 停在 connecting，模型列表与档位全空）。SW 只留最近 12 条出站消息，所以每一拍都读一次取最大值。
  let maxConnects = 0;
  for (let i = 0; i < 60 && !(model && effort); i += 1) {
    const seen = await sample().catch(() => ({ model: null, effort: null }));
    if (seen.model && !model) model = { value: seen.model, seconds: (i * 0.5).toFixed(1) };
    if (seen.effort && !effort) effort = { value: seen.effort, seconds: (i * 0.5).toFixed(1) };
    const sent = await sw.evaluate(() => globalThis.__opensiderOutbound?.() ?? []).catch(() => []);
    maxConnects = Math.max(maxConnects, sent.filter((msg) => msg.type === "agent.connect").length);
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

  // 这里刻意只断言「最终连上了、而且只发了一次」，不去卡秒表：SW 会在 starting 上挂一个
  // 10s 看门狗、端口断了还会重连并另起一次 Host，这些都会把慢路径兜起来（真机上你看到的
  // 那 8 秒就是某次迟到广播救的场），于是「快不快」在沙箱里量不准。要查判定时序，看
  // `[acl] effect` 这类临时日志，或者在真机 host.log 上对时间。
  // 面板到底有没有真的让 Host 连上引擎：这条能区分「只是控件没画出来」和「压根没连」。
  const logged = existsSync(hostLog) ? readFileSync(hostLog, "utf8") : "";
  ok(
    "the host really connected an agent",
    /acp runtime ready/.test(logged),
    /acp runtime ready/.test(logged) ? "" : "no `acp runtime ready` in host.log",
  );
  ok(
    "the panel asked for the agent exactly once",
    maxConnects === 1,
    `agent.connect sent ${maxConnects} times`,
  );
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 200));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
