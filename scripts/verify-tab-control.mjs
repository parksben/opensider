#!/usr/bin/env node
// Verifies agent tab control end to end, in a real Chromium:
//
//   openTab             -> opens in the background, never takes the user's view
//   first write         -> takes the anchor tab over (badge on, state recorded)
//   new message         -> re-points the route; reads never move it, writes do
//   navigation          -> the title mark survives it and is applied exactly once
//   background capture  -> flips the view only for the shot and gives it back
//   minimized window    -> capture fails with `needs_visible`, no hang
//   openTab placement   -> lands in the session's window, not the user's focused one
//   another user tab    -> borrow_required -> allow / deny / borrow_pending / borrow_held
//   self-opened tab     -> writable without a gate
//   workspace files     -> tabs.json `control` and current.json `target` track the hold
//   take-back           -> releases everything, clears badges, blocks re-entry
//
// Everything is driven through the extension's own seams on the service worker
// (`__opensiderDispatch` / `__opensiderControl` / `__opensiderControlState` /
// `__opensiderSnapshot`), the same handlers the side-panel port uses.
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
  const name = ((req.url ?? "/").split("?")[0] ?? "").replace(/^\//, "") || "a";
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
  const fixtureD = await context.newPage();
  await fixtureD.goto(`http://127.0.0.1:${port}/d`);
  const fixtureG = await context.newPage();
  await fixtureG.goto(`http://127.0.0.1:${port}/g`);
  const fixtureH = await context.newPage();
  await fixtureH.goto(`http://127.0.0.1:${port}/h`);

  const tabOf = async (urlPart) =>
    panel.evaluate(
      (part) =>
        chrome.tabs.query({}).then(
          (tabs) =>
            tabs.find((tab) => {
              try {
                return new URL(tab.url ?? "").pathname === part;
              } catch {
                return false;
              }
            })?.id ?? null,
        ),
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
  const tabD = await tabOf("/d");
  const tabG = await tabOf("/g");
  const tabH = await tabOf("/h");
  check(
    "found the fixture tabs",
    [tabA, tabB, tabD, tabG, tabH].every((id) => id != null),
    `A=${tabA} B=${tabB} D=${tabD} G=${tabG} H=${tabH}`,
  );

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

  // 2b. The title mark survives navigation and is applied exactly once.
  const navigated = await dispatch(
    { id: `nav-${Date.now()}`, method: "navigate", args: { url: `http://127.0.0.1:${port}/a?step=2` } },
    "verify-s1",
  );
  check("a held tab can navigate", navigated?.ok === true, navigated?.error);
  const badgeAfterNav = await waitFor(async () => (await titleOf(tabA)).startsWith("● "), true);
  check("the title mark survives navigation", badgeAfterNav.ok, `title=${badgeAfterNav.last}`);
  check("the title mark is applied exactly once", (((await titleOf(tabA)).match(/● /g) ?? []).length === 1));

  // 3. The user switches tabs; commands keep going to the pinned target.
  await activate(tabB);
  const meta = await dispatch({ id: `meta-${Date.now()}`, method: "getMeta", args: {} }, "verify-s1");
  check(
    "a command with no tabId stays on the pinned tab",
    meta?.ok === true && String(meta?.data?.url ?? "").includes("/a"),
    `url=${meta?.data?.url}`,
  );

  // 3b. A new user message re-points the session even while an old tab is still held.
  await control({ type: "control.anchor", sessionId: "verify-s1", tabId: tabB });
  const reanchored = await dispatch({ id: `re-${Date.now()}`, method: "click", args: { selector: "#btn" } }, "verify-s1");
  check("a write after a new message follows the new anchor", reanchored?.ok === true, reanchored?.error);
  const heldB = (await controlState()).entries.find((entry) => entry.tabId === tabB);
  check("the new anchor tab is taken over", heldB?.sessionId === "verify-s1", JSON.stringify(heldB));
  const afterRe = await dispatch({ id: `meta2-${Date.now()}`, method: "getMeta", args: {} }, "verify-s1");
  check(
    "unqualified commands follow the new anchor",
    String(afterRe?.data?.url ?? "").includes("/b"),
    `url=${afterRe?.data?.url}`,
  );

  // 3c. Reads do not move the route; the next write does.
  const readA = await dispatch({ id: `readA-${Date.now()}`, method: "getMeta", args: { tabId: tabA } }, "verify-s1");
  const stillB = await dispatch({ id: `meta3-${Date.now()}`, method: "getMeta", args: {} }, "verify-s1");
  check(
    "an explicit read does not move the route",
    readA?.ok === true && String(stillB?.data?.url ?? "").includes("/b"),
    `url=${stillB?.data?.url}`,
  );
  const writeA = await dispatch(
    { id: `writeA-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabA } },
    "verify-s1",
  );
  const nowA = await dispatch({ id: `meta4-${Date.now()}`, method: "getMeta", args: {} }, "verify-s1");
  check(
    "an explicit write moves the route",
    writeA?.ok === true && String(nowA?.data?.url ?? "").includes("/a"),
    `url=${nowA?.data?.url}`,
  );

  // 4. Capturing the background target flips the view only for the shot.
  const shot = await dispatch({ id: `shot-${Date.now()}`, method: "screenshot", args: {} }, "verify-s1");
  check("a background tab can be captured", shot?.ok === true, shot?.error);
  const restored = await waitFor(activeTab, tabB);
  check("the capture gives the user's view back", restored.ok, `active=${restored.last}`);

  // 4b. A minimized window refuses capture with a clear reason instead of hanging.
  const windowOfA = await panel.evaluate((id) => chrome.tabs.get(id).then((tab) => tab.windowId), tabA);
  await panel.evaluate((windowId) => chrome.windows.update(windowId, { state: "minimized" }), windowOfA);
  const minimizedShot = await dispatch(
    { id: `shot-min-${Date.now()}`, method: "screenshot", args: { tabId: tabA } },
    "verify-s1",
  );
  check(
    "a minimized window refuses capture with a reason",
    minimizedShot?.ok === false && minimizedShot?.reason === "needs_visible",
    `reason=${minimizedShot?.reason}`,
  );
  await panel.evaluate((windowId) => chrome.windows.update(windowId, { state: "normal" }), windowOfA);

  // 4c. openTab lands in the session's window, not the user's focused one.
  const otherWindow = await panel.evaluate(
    (url) => chrome.windows.create({ url, focused: true }).then((win) => win.id),
    `http://127.0.0.1:${port}/f`,
  );
  await panel.evaluate((id) => chrome.windows.update(id, { focused: true }), otherWindow);
  const userView = () =>
    panel.evaluate(() =>
      chrome.windows.getLastFocused({ populate: true }).then((win) => ({
        windowId: win.id,
        activeTab: win.tabs?.find((tab) => tab.active)?.id ?? null,
      })),
    );
  const focusBefore = await userView();
  const openedQuiet = await dispatch(
    { id: `open2-${Date.now()}`, method: "openTab", args: { url: `http://127.0.0.1:${port}/w` } },
    "verify-s1",
  );
  const placed = await panel.evaluate(
    ([createdId, expectedWindow]) => chrome.tabs.get(createdId).then((tab) => tab.windowId === expectedWindow),
    [openedQuiet?.data?.tabId, windowOfA],
  );
  check(
    "openTab lands in the session's window",
    openedQuiet?.ok === true && placed,
    JSON.stringify(openedQuiet?.data ?? openedQuiet?.error),
  );
  const focusAfter = await userView();
  check(
    "openTab leaves the user's view alone",
    focusAfter.windowId === focusBefore.windowId && focusAfter.activeTab === focusBefore.activeTab,
    `${JSON.stringify(focusBefore)} -> ${JSON.stringify(focusAfter)}`,
  );
  await panel.evaluate((windowId) => chrome.windows.remove(windowId), otherWindow);

  // 5. Another user tab needs a grant.
  const gated = await dispatch(
    { id: `gated-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check("an un-held user tab asks first", gated?.ok === false && gated?.reason === "borrow_required", `reason=${gated?.reason}`);
  const pending = (await controlState()).pending;
  check("a borrow request is pending", Boolean(pending) && pending.tabId === tabH);
  const noBadgeH = !(await titleOf(tabH)).startsWith("● ");
  check("the un-held tab carries no mark yet", noBadgeH);
  const cardUp = await waitFor(
    async () => /asks to work in|想操作/.test(await panel.evaluate(() => document.body.innerText)),
    true,
  );
  check("the side panel shows the borrow card", cardUp.ok);

  // 6. Allowing grants it.
  await control({ type: "control.grant", requestId: pending?.requestId ?? "", allow: true });
  const allowed = await dispatch(
    { id: `allowed-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check("after allowing, the same command works", allowed?.ok === true, allowed?.error);
  const badgeH = await waitFor(async () => (await titleOf(tabH)).startsWith("● "), true);
  check("the granted tab carries the title mark", badgeH.ok, `title=${badgeH.last}`);

  // 6b. Reads on an un-held tab go through the same gate.
  const readD = await dispatch({ id: `readD-${Date.now()}`, method: "getMeta", args: { tabId: tabD } }, "verify-s1");
  check("reading an un-held tab asks first", readD?.ok === false && readD?.reason === "borrow_required", `reason=${readD?.reason}`);
  const pendingD = (await controlState()).pending;
  check("the read request is pending", pendingD?.tabId === tabD);

  // 6c. Only one request at a time: a second session waits its turn.
  const busy = await dispatch(
    { id: `busy-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabG } },
    "verify-s2",
  );
  check("a second request answers borrow_pending", busy?.ok === false && busy?.reason === "borrow_pending", `reason=${busy?.reason}`);

  // 6d. Denying keeps the tab off limits without re-asking.
  await control({ type: "control.grant", requestId: pendingD?.requestId ?? "", allow: false });
  const deniedAgain = await dispatch(
    { id: `deny2-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabD } },
    "verify-s1",
  );
  check("a denied tab is off limits", deniedAgain?.ok === false && deniedAgain?.reason === "borrow_denied", `reason=${deniedAgain?.reason}`);
  check("a denied tab does not re-ask while cooling down", (await controlState()).pending === null);

  // 6e. Another conversation cannot take a held tab.
  const foreign = await dispatch(
    { id: `foreign-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabA } },
    "verify-s2",
  );
  check("another session answers borrow_held", foreign?.ok === false && foreign?.reason === "borrow_held", `reason=${foreign?.reason}`);

  // 7. A self-opened tab needs no gate.
  await dispatch({ id: `wait-${Date.now()}`, method: "waitFor", args: { selector: "#btn", timeoutMs: 5000, tabId: created } }, "verify-s1");
  const ownTab = await dispatch(
    { id: `own-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: created } },
    "verify-s1",
  );
  check("a self-opened tab works without a gate", ownTab?.ok === true, ownTab?.error);

  // 7b. The agent-facing snapshot marks holders and the route.
  const view = await sw.evaluate(() => globalThis.__opensiderSnapshot());
  const controlOf = (tabId) =>
    view.snapshot.windows.flatMap((win) => win.tabs).find((tab) => tab.tabId === tabId)?.control;
  check(
    "tabs.json marks every held tab",
    [tabA, tabB, created, tabH].every((id) => controlOf(id) === "agent") &&
      controlOf(tabD) === "user" &&
      controlOf(tabG) === "user",
    JSON.stringify({ a: controlOf(tabA), b: controlOf(tabB), c: controlOf(created), d: controlOf(tabD), g: controlOf(tabG), h: controlOf(tabH) }),
  );
  check(
    "current.json routes to the last tab the Agent worked in",
    view.target?.tabId === created,
    `target=${JSON.stringify(view.target)}`,
  );

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
      const titles = await Promise.all([titleOf(tabA), titleOf(tabB), titleOf(created), titleOf(tabH)]);
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

  // 8b. The workspace files follow the release too.
  const viewAfter = await sw.evaluate(() => globalThis.__opensiderSnapshot());
  const anyAgent = viewAfter.snapshot.windows.flatMap((win) => win.tabs).some((tab) => tab.control === "agent");
  check("take-back clears control in tabs.json", !anyAgent);
  check("take-back clears the route in current.json", viewAfter.target === undefined, JSON.stringify(viewAfter.target));

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
