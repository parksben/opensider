#!/usr/bin/env node
// Verifies agent tab control end to end, in a real Chromium:
//
//   openTab             -> opens in the background, never takes the user's view
//   first write         -> takes the anchor tab over (badge on, state recorded)
//   user switches tabs  -> the session keeps working in its pinned target
//   background capture  -> flips the view only for the shot and gives it back
//   another user tab    -> borrow_required + a pending request, then granted on allow
//   self-opened tab     -> writable without a gate
//   take-back           -> releases everything, clears badges, blocks re-entry
//
// Everything is driven through the extension's own seams on the service worker
// (`__opensiderDispatch` / `__opensiderControl` / `__opensiderControlState`), the same
// handlers the side-panel port uses.
//
//   node scripts/verify-tab-control.mjs             # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure. Headed by default:
// `captureVisibleTab` needs a real window.
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
    // Fall back to a global install, then to whatever `npx playwright` left in its cache.
    const candidates = [];
    try {
      const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
      candidates.push(join(globalRoot, "playwright"));
    } catch {
      // npm not available — keep going with the cache probe
    }
    const npxRoot = join(homedir(), ".npm", "_npx");
    if (existsSync(npxRoot)) {
      for (const dir of readdirSync(npxRoot)) candidates.push(join(npxRoot, dir, "node_modules", "playwright"));
    }
    for (const candidate of candidates) {
      const entry = join(candidate, "index.js");
      if (existsSync(entry)) return createRequire(pathToFileURL(entry))("playwright");
    }
    throw new Error("playwright not found: install it globally, or run `npx playwright --version` once");
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

const page = (name) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${name}</title></head>
<body><h1>${name}</h1><button id="btn" type="button">Click</button>
<script>document.getElementById('btn').addEventListener('click', () => { window.__clicked = (window.__clicked ?? 0) + 1; });</script>
</body></html>`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = createServer((req, res) => {
  const name = (req.url ?? "/").replace(/^\//, "") || "a";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(page(name));
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const { chromium } = loadPlaywright();
const profile = mkdtempSync(join(tmpdir(), "opensider-control-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: process.env.HEADLESS === "1",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const waitFor = async (fn, expected, timeoutMs = 8000) => {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last === expected) return { ok: true, last };
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { ok: false, last };
};

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  check("extension service worker started", Boolean(extensionId));

  // Seed a conversation already bound to "verify-s1" so the side panel's banner is the
  // real one (a matching `selectedAcpId`), then open it.
  const now = new Date().toISOString();
  await sw.evaluate(
    (payload) => chrome.storage.local.set({ "opensider/state": payload }),
    {
      version: 1,
      savedAt: now,
      locale: "en",
      theme: "dark",
      selectedId: "verify-local-1",
      selectedModelId: "",
      selectedModelByProvider: {},
      agentMode: "ask",
      selectedProviderId: "cursor",
      onboardingCompleted: true,
      sessionsOpen: false,
      sessionDrawerWidth: 248,
      sessions: [
        {
          id: "verify-local-1",
          title: "verify",
          createdAt: now,
          updatedAt: now,
          messages: [],
          todos: [],
          artifacts: [],
          acpSessionId: "verify-s1",
        },
      ],
    },
  );

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 15_000 });

  const fixtureA = await context.newPage();
  await fixtureA.goto(`http://127.0.0.1:${port}/a`);
  const fixtureB = await context.newPage();
  await fixtureB.goto(`http://127.0.0.1:${port}/b`);

  const tabOf = async (urlPart) =>
    panel.evaluate(
      (part) => chrome.tabs.query({}).then((tabs) => tabs.find((tab) => (tab.url ?? "").includes(part))?.id ?? null),
      urlPart,
    );
  const activeTab = async () =>
    panel.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab?.id ?? null));
  const activate = async (tabId) => panel.evaluate((id) => chrome.tabs.update(id, { active: true }), tabId);
  const titleOf = async (tabId) =>
    panel
      .evaluate(
        async (id) =>
          (await chrome.scripting.executeScript({ target: { tabId: id }, func: () => document.title }))[0]?.result ??
          "",
        tabId,
      )
      .catch(() => "");
  const dispatch = async (command, sessionId) =>
    sw.evaluate(
      ([cmd, sid]) => globalThis.__opensiderDispatch(cmd, sid ?? undefined),
      [command, sessionId ?? null],
    );
  const control = async (msg) => sw.evaluate((payload) => globalThis.__opensiderControl(payload), msg);
  const controlState = async () => sw.evaluate(() => globalThis.__opensiderControlState());

  const tabA = await tabOf("/a");
  const tabB = await tabOf("/b");
  check("found both fixture tabs", tabA != null && tabB != null, `A=${tabA} B=${tabB}`);

  // 1. openTab goes to the background and never takes the user's view.
  await activate(tabA);
  const opened = await dispatch(
    { id: `open-${Date.now()}`, method: "openTab", args: { url: `http://127.0.0.1:${port}/c` } },
    "verify-s1",
  );
  const created = opened?.data?.tabId ?? null;
  check("openTab reports a background tab", opened?.ok === true && opened?.data?.background === true, JSON.stringify(opened?.data ?? opened?.error));
  const stillA = await activeTab();
  check("openTab leaves the user's active tab alone", stillA === tabA, `active=${stillA} expected=${tabA}`);
  const adoptedState = await controlState();
  check(
    "the opened tab becomes the session's",
    adoptedState.entries.some((entry) => entry.tabId === created && entry.sessionId === "verify-s1"),
  );
  const badgeCreated = await waitFor(async () => (await titleOf(created)).startsWith("● "), true);
  check("the opened tab carries the title mark", badgeCreated.ok, `title=${badgeCreated.last}`);

  // 2. The first write in the tab the user is on takes it over.
  await control({ type: "control.anchor", sessionId: "verify-s1", tabId: tabA });
  const clicked = await dispatch({ id: `click-${Date.now()}`, method: "click", args: { selector: "#btn" } }, "verify-s1");
  check("writing the anchor tab works", clicked?.ok === true, clicked?.error);
  const pinned = (await controlState()).entries.find((entry) => entry.tabId === tabA);
  check("the anchor tab is now held", pinned?.sessionId === "verify-s1", JSON.stringify(pinned));
  const badgeA = await waitFor(async () => (await titleOf(tabA)).startsWith("● "), true);
  check("the held tab carries the title mark", badgeA.ok, `title=${badgeA.last}`);

  // The banner is the one surface that must say who is driving (locale-agnostic match).
  const bannerUp = await waitFor(
    async () => /Take back|收回/.test(await panel.evaluate(() => document.body.innerText)),
    true,
  );
  check("the side panel shows the control banner", bannerUp.ok);

  // 3. The user switches tabs; commands keep going to the pinned target.
  await activate(tabB);
  const meta = await dispatch({ id: `meta-${Date.now()}`, method: "getMeta", args: {} }, "verify-s1");
  check(
    "a command with no tabId stays on the pinned tab",
    meta?.ok === true && String(meta?.data?.url ?? "").includes("/a"),
    `url=${meta?.data?.url}`,
  );

  // 4. Capturing the background target flips the view only for the shot.
  const shot = await dispatch({ id: `shot-${Date.now()}`, method: "screenshot", args: {} }, "verify-s1");
  check("a background tab can be captured", shot?.ok === true, shot?.error);
  const restored = await waitFor(activeTab, tabB);
  check("the capture gives the user's view back", restored.ok, `active=${restored.last}`);

  // 5. Another user tab needs a grant.
  const gated = await dispatch(
    { id: `gated-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabB } },
    "verify-s1",
  );
  check("an un-held user tab asks first", gated?.ok === false && gated?.reason === "borrow_required", `reason=${gated?.reason}`);
  const pending = (await controlState()).pending;
  check("a borrow request is pending", Boolean(pending) && pending.tabId === tabB);
  const noBadgeB = !(await titleOf(tabB)).startsWith("● ");
  check("the un-held tab carries no mark yet", noBadgeB);
  const cardUp = await waitFor(
    async () => /asks to work in|想操作/.test(await panel.evaluate(() => document.body.innerText)),
    true,
  );
  check("the side panel shows the borrow card", cardUp.ok);

  // 6. Allowing grants it.
  await control({ type: "control.grant", requestId: pending?.requestId ?? "", allow: true });
  const allowed = await dispatch(
    { id: `allowed-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabB } },
    "verify-s1",
  );
  check("after allowing, the same command works", allowed?.ok === true, allowed?.error);
  const badgeB = await waitFor(async () => (await titleOf(tabB)).startsWith("● "), true);
  check("the granted tab carries the title mark", badgeB.ok, `title=${badgeB.last}`);

  // 7. A self-opened tab needs no gate.
  await dispatch({ id: `wait-${Date.now()}`, method: "waitFor", args: { selector: "#btn", timeoutMs: 5000, tabId: created } }, "verify-s1");
  const ownTab = await dispatch(
    { id: `own-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: created } },
    "verify-s1",
  );
  check("a self-opened tab works without a gate", ownTab?.ok === true, ownTab?.error);

  // 8. Take-back releases everything, clears marks and blocks re-entry for a while.
  await control({ type: "control.release", sessionId: "verify-s1" });
  const released = await controlState();
  check(
    "take-back releases every held tab",
    !released.entries.some((entry) => entry.sessionId === "verify-s1"),
    JSON.stringify(released.entries),
  );
  const marksGone = await waitFor(
    async () => {
      const titles = await Promise.all([titleOf(tabA), titleOf(tabB), titleOf(created)]);
      return titles.every((title) => !title.startsWith("● "));
    },
    true,
  );
  check("take-back clears the title marks", marksGone.ok, `titles=${marksGone.last}`);
  const bannerDown = await waitFor(
    async () => !/Take back|收回/.test(await panel.evaluate(() => document.body.innerText)),
    true,
  );
  check("take-back takes the banner down", bannerDown.ok);
  const blockedWrite = await dispatch({ id: `blocked-${Date.now()}`, method: "click", args: { selector: "#btn" } }, "verify-s1");
  check(
    "a taken-back tab is off limits (no silent re-take)",
    blockedWrite?.ok === false && blockedWrite?.reason === "borrow_denied",
    `reason=${blockedWrite?.reason}`,
  );

  const failed = results.filter((item) => !item.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  await context.close();
  server.close();
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error("verify-tab-control crashed:", error);
  await context.close().catch(() => undefined);
  server.close();
  process.exit(1);
}
