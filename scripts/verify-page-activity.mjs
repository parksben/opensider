#!/usr/bin/env node
// Verifies the page activity wiring end to end, in a real Chromium:
//
//   open the side panel -> the tab the Agent works with gets armed (it stops hearing the
//   "you are hidden" events; it reads as visible and focused; frames keep flowing)
//   close the panel -> the tab is released and hears its own events again
//
// Everything is driven through the extension's own paths: `switchTab` (the command the
// Agent uses) to make a tab current, and `chrome.scripting.executeScript` in the page's
// MAIN world to look at what the page itself sees.
//
// Scope note: Playwright's Chromium always reports pages as visible and focused (it turns
// on focus emulation itself) and hides nothing, so a tab cannot be made *really* hidden
// here. The hidden-state mechanics themselves — the visibility/focus override, the
// requestAnimationFrame fallback, restore-on-disarm — are covered by
// `packages/extension/src/activity-shim.test.ts` against a fake DOM; this script covers
// the arming/release wiring and the listener muting on the real code path.
//
//   node scripts/verify-page-activity.mjs           # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");

function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(pathToFileURL(join(globalRoot, "playwright", "index.js")))("playwright");
  }
}

function cachedChromium() {
  const cache = join(homedir(), "Library", "Caches", "ms-playwright");
  if (!existsSync(cache)) return undefined;
  const dir = readdirSync(cache)
    .filter((name) => name.startsWith("chromium-"))
    .sort()
    .pop();
  if (!dir) return undefined;
  const bin = join(cache, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium");
  return existsSync(bin) ? bin : undefined;
}

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>activity fixture</title></head>
<body><div id="out">fixture</div>
<script>
  const box = document.getElementById('out');
  document.addEventListener('visibilitychange', () => { box.dataset.earlyHeard = '1'; });
</script>
</body></html>`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const { chromium } = loadPlaywright();
const profile = mkdtempSync(join(tmpdir(), "opensider-activity-"));
const context = await chromium.launchPersistentContext(profile, {
  // Headed unless HEADLESS=1. A real window is the point: visibility/occlusion are exactly
  // what this feature is about, and Playwright's focus emulation only exists with a UI.
  headless: process.env.HEADLESS === "1",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

/**
 * Registers a fresh visibilitychange listener in the page's MAIN world, fires one synthetic
 * event at it, and reports how many of them the page heard (0 = muted by the shim).
 */
const probeEvents = (panel, tabId) =>
  panel
    .evaluate(
      async (id) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: id },
            world: "MAIN",
            func: () => {
              let heard = 0;
              document.addEventListener("visibilitychange", () => {
                heard += 1;
              });
              document.dispatchEvent(new Event("visibilitychange"));
              return heard;
            },
          })
        )[0]?.result ?? -1,
      tabId,
    )
    .catch(() => -1);

const probeState = (panel, tabId) =>
  panel
    .evaluate(
      async (id) =>
        (
          await chrome.scripting.executeScript({
            target: { tabId: id },
            world: "MAIN",
            func: async () => {
              let frames = 0;
              const started = performance.now();
              const tick = () => {
                frames += 1;
                if (performance.now() - started < 400) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
              await new Promise((resolve) => setTimeout(resolve, 500));
              return {
                visibility: document.visibilityState,
                hidden: document.hidden,
                hasFocus: document.hasFocus(),
                frames,
              };
            },
          })
        )[0]?.result ?? null,
      tabId,
    )
    .catch(() => null);

const waitFor = async (fn, expected, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last === expected) return { ok: true, last };
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return { ok: false, last };
};

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  check("extension service worker started", Boolean(extensionId));

  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);
  const untouched = await fixture.evaluate(() => {
    let heard = 0;
    document.addEventListener("visibilitychange", () => {
      heard += 1;
    });
    document.dispatchEvent(new Event("visibilitychange"));
    return heard;
  });
  check("an untouched page hears its own events", untouched === 1, `heard=${untouched}`);

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15_000 });

  const tabIds = await panel.evaluate(() =>
    chrome.tabs.query({}).then((tabs) => ({
      fixture: tabs.find((tab) => (tab.url ?? "").includes("127.0.0.1"))?.id ?? null,
    })),
  );
  check("found the fixture tab", tabIds.fixture != null, `tabId=${tabIds.fixture}`);

  // The Agent's own way of making a tab current; the extension arms whatever it works with.
  const makeCurrent = async () => {
    await sw.evaluate(
      (command) => globalThis.__opensiderDispatch(command),
      { id: `switch-${Date.now()}`, method: "switchTab", args: { tabId: tabIds.fixture } },
    );
  };

  await makeCurrent();
  const armed = await waitFor(
    async () => {
      await makeCurrent();
      return probeEvents(panel, tabIds.fixture);
    },
    0,
  );
  check("working with the tab arms it", armed.ok, armed.ok ? "" : `page still heard the event (${armed.last})`);

  const state = await probeState(panel, tabIds.fixture);
  check(
    "the armed tab reads as visible and focused",
    state?.visibility === "visible" && state?.hidden === false && state?.hasFocus === true,
    JSON.stringify(state),
  );
  check("animation frames keep flowing on the armed tab", (state?.frames ?? 0) >= 5, `${state?.frames} frames`);

  // Closing the panel has to hand the tab back to the browser. There is no panel left to
  // ask through, so this probe runs in the page's own world instead.
  await panel.close();
  const pageProbe = () =>
    fixture.evaluate(() => {
      let heard = 0;
      document.addEventListener("visibilitychange", () => {
        heard += 1;
      });
      document.dispatchEvent(new Event("visibilitychange"));
      return heard;
    });
  const released = await waitFor(pageProbe, 1, 10_000);
  check("closing the panel releases the tab", released.ok, released.ok ? "" : "events still muted");

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length > 0 ? 1 : 0;
} finally {
  await context.close();
  server.close();
}
