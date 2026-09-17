#!/usr/bin/env node
// Verifies the "leave no trace" rule end to end, in a real Chromium:
//
//   1. a tab the Agent has not touched has to be indistinguishable from a plain Chromium —
//      same entry points, no extra globals, nothing added to the document's prototype
//   2. the extension still sees every tab and the active one (that comes from the service
//      worker, so injecting less must not blind it)
//   3. the first touch installs the hooks in that tab, and letting the tab go again
//      (closing the panel) takes every one of those patches back out
//
//   node scripts/verify-page-tamper.mjs           # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
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
<html><head><meta charset="utf-8"><title>tamper fixture</title></head>
<body><div id="out">fixture</div></body></html>`;

/** Everything a site could use to tell that an extension is running inside its own JS world. */
const FINGERPRINT = () => {
  const native = (fn) => {
    try {
      return /\{\s*\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
    } catch {
      return "threw";
    }
  };
  const entryPoints = {
    "EventTarget.prototype.addEventListener": EventTarget.prototype.addEventListener,
    "EventTarget.prototype.removeEventListener": EventTarget.prototype.removeEventListener,
    "window.requestAnimationFrame": window.requestAnimationFrame,
    "window.cancelAnimationFrame": window.cancelAnimationFrame,
    "window.alert": window.alert,
    "window.confirm": window.confirm,
    "window.prompt": window.prompt,
    "window.print": window.print,
    "window.open": window.open,
    "HTMLInputElement.prototype.click": HTMLInputElement.prototype.click,
    "HTMLInputElement.prototype.showPicker": HTMLInputElement.prototype.showPicker,
  };
  const documentProto = Object.getPrototypeOf(document);
  const accessor = (key) => {
    const descriptor = Object.getOwnPropertyDescriptor(documentProto, key);
    if (!descriptor) return null;
    return { kind: "get" in descriptor ? "accessor" : "value", native: native("get" in descriptor ? descriptor.get : descriptor.value) };
  };
  return {
    wrappedEntryPoints: Object.entries(entryPoints)
      .filter(([, fn]) => !native(fn))
      .map(([name]) => name)
      .sort(),
    injectedGlobals: Object.getOwnPropertyNames(window)
      .filter((name) => name.startsWith("__opensider"))
      .sort(),
    documentProtoOwn: Object.getOwnPropertyNames(documentProto).sort(),
    documentProtoAccessors: ["hidden", "visibilityState", "hasFocus", "onvisibilitychange"]
      .map((key) => [key, accessor(key)])
      .filter(([, value]) => value != null),
  };
};

/** Does the page's `document.onvisibilitychange = fn` still reach the browser? */
const ON_VISIBILITY_ROUND_TRIP = () => {
  let heard = 0;
  const handler = () => {
    heard += 1;
  };
  document.onvisibilitychange = handler;
  try {
    document.dispatchEvent(new Event("visibilitychange"));
  } catch {
    // ignore
  }
  document.onvisibilitychange = null;
  return heard;
};

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
const url = `http://127.0.0.1:${port}/`;

const { chromium } = loadPlaywright();

async function launch(withExtension) {
  const profile = mkdtempSync(join(tmpdir(), "opensider-tamper-"));
  const context = await chromium.launchPersistentContext(profile, {
    // Headed unless HEADLESS=1: the fingerprint has to hold in the browser a user actually
    // browses with, not in a stripped-down headless one.
    headless: process.env.HEADLESS === "1",
    executablePath: cachedChromium(),
    args: withExtension ? [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`] : [],
  });
  return { context, profile };
}

/** Chromium's own answer, with no extension anywhere near it. */
const clean = await launch(false);
const cleanPage = await clean.context.newPage();
await cleanPage.goto(url);
const baseline = await cleanPage.evaluate(FINGERPRINT);
await clean.context.close();
rmSync(clean.profile, { recursive: true, force: true });

const { context, profile } = await launch(true);
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 30_000 });
  const command = (cmd) => sw.evaluate((c) => globalThis.__opensiderDispatch(c), cmd);
  const swReady = async () => (await sw.evaluate(() => typeof globalThis.__opensiderDispatch)) === "function";
  for (let i = 0; i < 40 && !(await swReady()); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("extension service worker started", await swReady());

  // The hooks are injected on demand, so the tab only has to exist before anything touches
  // it — and a first navigation that races the extension's registration cannot make the
  // "untouched" check pass by accident, because nothing is ever injected at load time.
  const page = await context.newPage();
  await page.goto(url);
  const tabId = await sw.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === target)?.id ?? null;
  }, url);
  check("found the fixture tab", tabId != null, `tabId=${tabId}`);

  const untouched = await page.evaluate(FINGERPRINT);
  check(
    "an untouched tab matches a plain Chromium exactly",
    JSON.stringify(untouched) === JSON.stringify(baseline),
    `untouched=${JSON.stringify(untouched)} baseline=${JSON.stringify(baseline)}`,
  );

  // Perception is the service worker's job: it must keep listing every tab and knowing
  // which one is active even though nothing at all has been injected into the page.
  const listed = await command({ id: "tabs-1", method: "listTabs", args: {} });
  const listedUrls = (listed?.data?.windows ?? []).flatMap((win) => (win.tabs ?? []).map((tab) => tab.url));
  check("every open tab is still visible to the Agent", listedUrls.includes(url), JSON.stringify(listedUrls));
  const activeIsFixture = await sw.evaluate(async () => {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return active?.url ?? null;
  });
  check("the active tab is still known", activeIsFixture === url, String(activeIsFixture));

  // Opening the panel is what lets the extension work on tabs at all.
  const extensionId = new URL(sw.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15_000 });
  await command({ id: "switch-1", method: "switchTab", args: { tabId } });
  // Working with a tab means running a page command on it; that is the moment both hooks go
  // in (the activity one on the touch, the native UI one when the command's result is
  // drained for dialogs).
  await command({ id: "touch-1", method: "getInteractive", args: {} });

  const waitFor = async (probe, expected, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      last = await probe();
      if (expected(last)) return { ok: true, last };
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { ok: false, last };
  };

  const touched = await waitFor(
    () => page.evaluate(FINGERPRINT),
    (fingerprint) => fingerprint.wrappedEntryPoints.length > 0,
  );
  check(
    "touching the tab installs the hooks there",
    touched.ok && touched.last.injectedGlobals.length === 2,
    JSON.stringify(touched.last),
  );
  check(
    "the document prototype carries the visibility override",
    touched.last.documentProtoOwn.includes("hidden") &&
      touched.last.documentProtoOwn.includes("visibilityState") &&
      // the on* takeover used to fail silently (Illegal invocation on the native getter)
      touched.last.documentProtoOwn.includes("onvisibilitychange"),
    JSON.stringify(touched.last.documentProtoOwn),
  );
  const armedRoundTrip = await page.evaluate(ON_VISIBILITY_ROUND_TRIP);
  check(
    "while armed, document.onvisibilitychange no longer reaches the browser",
    armedRoundTrip === 0,
    `handler fired ${armedRoundTrip}x`,
  );

  // Letting go of the tab has to leave it exactly the way it was found.
  await panel.close();
  const released = await waitFor(
    () => page.evaluate(FINGERPRINT),
    (fingerprint) => JSON.stringify(fingerprint) === JSON.stringify(baseline),
    20_000,
  );
  check(
    "closing the panel leaves the tab stock again",
    released.ok,
    `released=${JSON.stringify(released.last)}`,
  );
  const releasedRoundTrip = await page.evaluate(ON_VISIBILITY_ROUND_TRIP);
  check("the page's own onvisibilitychange works again", releasedRoundTrip === 1, `handler fired ${releasedRoundTrip}x`);

  // Working with the same tab again has to install the hooks a second time. This is where the
  // ESM-loader build quietly fell over: a module is evaluated once per document, so injecting
  // it again did nothing and the Agent stayed blind until the page was reloaded.
  const panelAgain = await context.newPage();
  await panelAgain.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panelAgain.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15_000 });
  await command({ id: "switch-2", method: "switchTab", args: { tabId } });
  await command({ id: "touch-2", method: "getInteractive", args: {} });
  const retouched = await waitFor(
    () => page.evaluate(FINGERPRINT),
    (fingerprint) => fingerprint.injectedGlobals.length === 2,
  );
  check(
    "the hooks can be installed again after a release",
    retouched.ok,
    `globals=${JSON.stringify(retouched.last?.injectedGlobals)}`,
  );

  // The hook lives in the page's own world, so page script can call it — and the first caller
  // is the one it trusts. A page that grabs a fresh instance must not be able to blind the
  // Agent: the service worker has to notice and re-seat the hook.
  await page.evaluate(() => {
    delete window.__opensiderNativeUi;
    // One-shot claimer: grab the next instance to appear, then stop being greedy.
    const timer = setInterval(() => {
      const api = window.__opensiderNativeUi;
      if (!api) return;
      clearInterval(timer);
      try {
        api.handshake("j".repeat(32));
      } catch {
        /* ignore */
      }
    }, 1);
  });
  const afterHijack = await command({ id: "hijack-1", method: "getInteractive", args: {} });
  const hijackState = await waitFor(
    () => page.evaluate(FINGERPRINT),
    (fingerprint) => fingerprint.injectedGlobals.includes("__opensiderNativeUi"),
    10_000,
  );
  check(
    "a page that grabbed the hook cannot blind the Agent",
    afterHijack?.ok === true && hijackState.ok,
    `command ok=${afterHijack?.ok} globals=${JSON.stringify(hijackState.last?.injectedGlobals)}`,
  );

  // One more release, to show what a grabbed instance costs: the activity patches still come
  // out (they belong to the instance we hold), while the wrapper layer the page claimed stays
  // — its originals live in a closure we cannot reach. That layer behaves as a pass-through.
  await panelAgain.close();
  const finalRelease = await waitFor(
    () => page.evaluate(FINGERPRINT),
    (fingerprint) => fingerprint.documentProtoOwn.length === 1 && fingerprint.injectedGlobals.length === 0,
    20_000,
  );
  check(
    "releasing after a grab still restores the activity patches",
    finalRelease.ok,
    `state=${JSON.stringify(finalRelease.last)}`,
  );
} finally {
  await context.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
