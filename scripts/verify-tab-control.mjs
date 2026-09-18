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
//   answering the card  -> the side panel itself nudges the Agent to carry on
//   control card        -> renders above the composer, no status prefix in its title
//   self-opened tab     -> writable without a gate
//   workspace files     -> tabs.json `control` and current.json `target` track the hold
//   turn ends           -> holds are parked (marks off), memories keep re-entry silent
//   take-back           -> releases everything, clears badges, blocks re-entry
//
// Everything is driven through the extension's own seams on the service worker
// (`__opensiderDispatch` / `__opensiderControl` / `__opensiderControlState` /
// `__opensiderSnapshot` / `__opensiderOutbound` / `__opensiderPrompts` / `__opensiderStatus`),
// the same handlers the side-panel port uses. Answering a borrow request is clicked on the
// real card.
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
  // No real host runs in this harness; the card's auto-nudge goes through the composer,
  // which refuses to send while the sidebar thinks the host is offline.
  const statusReady = () => sw.evaluate(() => globalThis.__opensiderStatus("ready"));
  await statusReady();

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
  const fixtureI = await context.newPage();
  await fixtureI.goto(`http://127.0.0.1:${port}/i`);

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
  // The title status is a text prefix; either locale counts (the browser's UI language
  // decides which one the extension picks).
  const MARK = /^\[(?:接管中|Agent)\] /;
  const marked = async (tabId) => MARK.test(await titleOf(tabId));
  const dispatch = async (command, sessionId) =>
    sw.evaluate(
      ([cmd, sid]) => globalThis.__opensiderDispatch(cmd, sid ?? undefined),
      [command, sessionId ?? null],
    );
  const control = async (msg) => sw.evaluate((payload) => globalThis.__opensiderControl(payload), msg);
  const controlState = async () => sw.evaluate(() => globalThis.__opensiderControlState());
  const policyNow = async () => sw.evaluate(() => globalThis.__opensiderPolicy());
  // The sidebar persists its permission mode; the SW reads it from storage, so wait for the
  // switch to land there before asserting the gate's behaviour.
  const waitForPolicy = async (want) => {
    const deadline = Date.now() + 8_000;
    let last;
    while (Date.now() < deadline) {
      last = await policyNow();
      if (last === want) return true;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    return false;
  };
  const setMode = async (from, to) => {
    await statusReady();
    await panel.getByRole("button", { name: from, exact: true }).click({ timeout: 5_000 });
    await panel.getByRole("button", { name: new RegExp(`^${to}`) }).click({ timeout: 5_000 });
  };
  const outbound = async () => sw.evaluate(() => globalThis.__opensiderOutbound());
  const promptsSent = async () => sw.evaluate(() => globalThis.__opensiderPrompts());  // No native host is registered in this harness, so the sidebar falls back to the bridge
  // setup screen and never renders the chat pane (where the control card lives). Re-seed the
  // status while polling for pane UI.
  const waitForPane = async (test, timeoutMs = 12_000) => {
    const deadline = Date.now() + timeoutMs;
    let ok = false;
    while (Date.now() < deadline && !ok) {
      await statusReady();
      ok = test(await panel.evaluate(() => document.body.innerText));
      if (!ok) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return ok;
  };

  const tabA = await tabOf("/a");
  const tabB = await tabOf("/b");
  const tabD = await tabOf("/d");
  const tabG = await tabOf("/g");
  const tabH = await tabOf("/h");
  const tabI = await tabOf("/i");
  check(
    "found the fixture tabs",
    [tabA, tabB, tabD, tabG, tabH, tabI].every((id) => id != null),
    `A=${tabA} B=${tabB} D=${tabD} G=${tabG} H=${tabH} I=${tabI}`,
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
  const badgeCreated = await waitFor(() => marked(created), true);
  check("the opened tab carries the title mark", badgeCreated.ok, `title=${badgeCreated.last}`);
  // The tab is still loading when it is adopted: the card has to pick the title up later.
  const cardTitle = await waitFor(async () => {
    await statusReady();
    const text = await panel.evaluate(() => {
      const dot = document.querySelector(".cs-control-dot");
      return dot?.closest("section")?.innerText ?? "";
    });
    return /“c”/.test(text) ? "c" : false;
  }, "c");
  check("the control card picks up the title once the tab loads", cardTitle.ok, cardTitle.last);

  // 2. The first write in the tab the user is on takes it over.
  await control({ type: "control.anchor", sessionId: "verify-s1", tabId: tabA });
  const clicked = await dispatch({ id: `click-${Date.now()}`, method: "click", args: { selector: "#btn" } }, "verify-s1");
  check("writing the anchor tab works", clicked?.ok === true, clicked?.error);
  const pinned = (await controlState()).entries.find((entry) => entry.tabId === tabA);
  check("the anchor tab is now held", pinned?.sessionId === "verify-s1", JSON.stringify(pinned));
  const badgeA = await waitFor(() => marked(tabA), true);
  check("the held tab carries the title mark", badgeA.ok, `title=${badgeA.last}`);

  // The card is the one surface that must say who is driving (locale-agnostic match).
  const bannerUp = await waitForPane((text) => /Take back|收回/.test(text));
  check("the side panel shows the control card", bannerUp);
  const bannerText = await panel.evaluate(() => document.body.innerText);
  check("the banner shows the title without the status prefix", !/\[(?:接管中|Agent)\] /.test(bannerText));

  // 2b. The title mark survives navigation and is applied exactly once.
  const navigated = await dispatch(
    { id: `nav-${Date.now()}`, method: "navigate", args: { url: `http://127.0.0.1:${port}/a?step=2` } },
    "verify-s1",
  );
  check("a held tab can navigate", navigated?.ok === true, navigated?.error);
  const badgeAfterNav = await waitFor(() => marked(tabA), true);
  check("the title mark survives navigation", badgeAfterNav.ok, `title=${badgeAfterNav.last}`);
  check("the title mark is applied exactly once", (((await titleOf(tabA)).match(/\[(?:接管中|Agent)\] /g) ?? []).length === 1));

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
  const isMinimized = await waitFor(
    () => panel.evaluate((windowId) => chrome.windows.get(windowId).then((win) => win.state === "minimized"), windowOfA),
    true,
  );
  check("the test window really minimized", isMinimized.ok, `state polled=${isMinimized.last}`);
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
  await waitFor(
    () => panel.evaluate((windowId) => chrome.windows.get(windowId).then((win) => win.state === "normal"), windowOfA),
    true,
  );

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
  const noBadgeH = !(await marked(tabH));
  check("the un-held tab carries no mark yet", noBadgeH);
  const cardUp = await waitForPane((text) => /asks to work in|想操作/.test(text));
  check("the side panel shows the borrow card", cardUp);

  // 6. Allowing on the real card grants it and nudges the Agent to carry on by itself.
  await statusReady();
  await panel.getByRole("button", { name: "Allow", exact: true }).click({ timeout: 5_000 });
  const allowed = await dispatch(
    { id: `allowed-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check("after allowing, the same command works", allowed?.ok === true, allowed?.error);
  const allowNudge = (await promptsSent()).find((entry) => /allowed you to work in/.test(entry.text));
  check(
    "allowing auto-sends a continue prompt",
    Boolean(allowNudge),
    JSON.stringify(allowNudge ?? (await promptsSent()).slice(-3)),
  );
  // The nudge is a bridge message: the panel must not show it as a user bubble.
  const cleanTranscript = await waitFor(async () => {
    await statusReady();
    return !/allowed you to work in/.test(await panel.evaluate(() => document.body.innerText));
  }, true);
  check("the nudge stays out of the transcript", cleanTranscript.ok);
  const badgeH = await waitFor(() => marked(tabH), true);
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

  // 6d. Denying keeps the tab off limits without re-asking - and answers the running turn
  // right away: the answer interrupts instead of queueing (the allow nudge above is still
  // "running" in this harness, no host ever ends it).
  await statusReady();
  await panel.getByRole("button", { name: "Deny", exact: true }).click({ timeout: 5_000 });
  let denyNudge;
  for (let attempt = 0; attempt < 20 && !denyNudge; attempt += 1) {
    denyNudge = (await promptsSent()).find((entry) => /declined your request/.test(entry.text));
    if (!denyNudge) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check(
    "denying answers the waiting turn with an interrupt",
    Boolean(denyNudge) && denyNudge.interrupt === true,
    JSON.stringify(denyNudge ?? (await promptsSent()).slice(-3)),
  );
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
    view.target?.tabId === created && view.target?.title === "c",
    `target=${JSON.stringify(view.target)}`,
  );

  // 7c. The turn ends: holds are parked, marks go off, memories survive.
  await sw.evaluate((sessionId) => globalThis.__opensiderTurnEnd(sessionId), "verify-s1");
  const parked = await controlState();
  check(
    "turn end parks every hold",
    !parked.entries.some((entry) => entry.sessionId === "verify-s1"),
    JSON.stringify(parked.entries),
  );
  const parkedMarks = await waitFor(
    async () => {
      const titles = await Promise.all([titleOf(tabA), titleOf(tabB), titleOf(created), titleOf(tabH)]);
      return titles.every((title) => !MARK.test(title));
    },
    true,
  );
  check("turn end clears the title marks", parkedMarks.ok, `titles=${parkedMarks.last}`);
  const parkedBanner = await waitFor(
    async () => !/Take back|收回/.test(await panel.evaluate(() => document.body.innerText)),
    true,
  );
  check("turn end takes the banner down", parkedBanner.ok);

  // 7d. Memory: a self-opened tab and a granted tab come back without a card.
  const reOwn = await dispatch(
    { id: `reown-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: created } },
    "verify-s1",
  );
  check("a parked self-opened tab re-enters silently", reOwn?.ok === true, reOwn?.error);
  check("no card was raised for it", (await controlState()).pending === null);
  const reTrusted = await dispatch(
    { id: `retrust-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check("a granted tab re-enters silently", reTrusted?.ok === true, reTrusted?.error);
  check("no card was raised for it either", (await controlState()).pending === null);

  // 7e. A user tab that was never approved still asks.
  const askAgain = await dispatch(
    { id: `ask-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabG } },
    "verify-s1",
  );
  check(
    "an un-approved user tab still asks",
    askAgain?.ok === false && askAgain?.reason === "borrow_required",
    `reason=${askAgain?.reason}`,
  );
  check("and the mark stays off it", !(await marked(tabG)));

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
      return titles.every((title) => !MARK.test(title));
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

  const blockedWrite = await dispatch(
    { id: `blocked-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check(
    "a taken-back tab asks again instead of being refused (no cooldown)",
    blockedWrite?.ok === false && blockedWrite?.reason === "borrow_required",
    `reason=${blockedWrite?.reason}`,
  );
  const rePending = (await controlState()).pending;
  check("its card is waiting", rePending?.tabId === tabH);
  // Answer it with a deny: that is the one answer that cools the tab down (for the
  // permission-mode rails below).
  await control({ type: "control.grant", requestId: rePending?.requestId ?? "", allow: false });
  check("denying it cools the tab down", (await controlState()).pending === null);

  // 9. Permission modes: `unattended` (and `auto`) answer the gate without a card.
  const askI = await dispatch(
    { id: `p9a-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabI } },
    "verify-s1",
  );
  check(
    "a fresh user tab still asks under 'ask'",
    askI?.ok === false && askI?.reason === "borrow_required",
    `reason=${askI?.reason}`,
  );
  const cardBeforeSwitch = await waitForPane((text) => /asks to work in/.test(text));
  check("its card is up before the mode switch", cardBeforeSwitch);

  await setMode("Ask every time", "Allow all");
  const autoAnswered = await waitFor(async () => {
    const sent = (await promptsSent()).find((entry) => /allowed you to work in/.test(entry.text));
    return Boolean(sent);
  }, true);
  check("switching to 'Allow all' answers the pending card", autoAnswered.ok);
  const autoHeld = await waitFor(
    async () => (await controlState()).entries.some((entry) => entry.sessionId === "verify-s1" && entry.tabId === tabI),
    true,
  );
  check("the pending tab is handed over", autoHeld.ok);
  check("the policy reached the service worker", await waitForPolicy("unattended"));

  const autoWrite = await dispatch(
    { id: `p9b-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabG } },
    "verify-s1",
  );
  check("under 'Allow all' a user tab is taken without a card", autoWrite?.ok === true, autoWrite?.error);
  check("no card was raised for it", (await controlState()).pending === null);
  const noCardShown = await waitFor(async () => {
    await statusReady();
    return !/asks to work in/.test(await panel.evaluate(() => document.body.innerText));
  }, true);
  check("the panel shows no borrow card either", noCardShown.ok);

  const foreignAuto = await dispatch(
    { id: `p9c-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabG } },
    "verify-s2",
  );
  check(
    "'Allow all' never overrides another session's hold",
    foreignAuto?.ok === false && foreignAuto?.reason === "borrow_held",
    `reason=${foreignAuto?.reason}`,
  );
  const blockedAuto = await dispatch(
    { id: `p9d-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabH } },
    "verify-s1",
  );
  check(
    "'Allow all' never overrides a declined request",
    blockedAuto?.ok === false && blockedAuto?.reason === "borrow_denied",
    `reason=${blockedAuto?.reason}`,
  );

  // A policy grant is not a user approval: with the mode back on `ask`, the tab asks again.
  await sw.evaluate((sessionId) => globalThis.__opensiderTurnEnd(sessionId), "verify-s1");
  await setMode("Allow all", "Ask every time");
  check("the policy was switched back", await waitForPolicy("ask"));
  const reAsk = await dispatch(
    { id: `p9e-${Date.now()}`, method: "click", args: { selector: "#btn", tabId: tabG } },
    "verify-s1",
  );
  check(
    "a policy-granted tab asks again once the mode is back to 'ask'",
    reAsk?.ok === false && reAsk?.reason === "borrow_required",
    `reason=${reAsk?.reason}`,
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
