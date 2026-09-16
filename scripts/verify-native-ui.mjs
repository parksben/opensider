#!/usr/bin/env node
// Verifies the native UI shim end to end: a real Chromium with the built extension loaded,
// fixture pages that pop `confirm` / `prompt` / `window.open` / a file picker, and commands
// driven through the service worker's test seam (`globalThis.__opensiderDispatch`).
//
//   node scripts/verify-native-ui.mjs            # expects packages/extension/dist to be built
//
// It prints one line per check and exits non-zero on the first failure. Uses the globally
// installed playwright plus the already-cached Chromium build.
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

const PAGE = (csp) => `<!doctype html>
<html><head><meta charset="utf-8">
${csp ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'">` : ""}
<title>fixture</title></head>
<body>
<button id="confirm">confirm</button>
<button id="prompt">prompt</button>
<button id="popup">popup</button>
<button id="pick">pick</button>
<input id="file" type="file">
<div id="out"></div>
<script>
  const out = document.getElementById('out');
  document.getElementById('confirm').onclick = () => { out.textContent = 'confirm:' + String(window.confirm('Delete the thing?')); };
  document.getElementById('prompt').onclick = () => { out.textContent = 'prompt:' + String(window.prompt('Your name?', 'anon')); };
  document.getElementById('popup').onclick = () => { const w = window.open('about:blank', '_blank'); out.textContent = 'popup:' + (w ? 'opened' : 'blocked'); if (w) w.close(); };
  document.getElementById('pick').onclick = () => { document.getElementById('file').click(); out.textContent = 'pick:clicked'; };
</script>
</body></html>`;

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const server = createServer((req, res) => {
  const csp = req.url?.includes("csp");
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE(csp));
});

const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const base = `http://127.0.0.1:${port}`;

const { chromium } = loadPlaywright();
const profile = mkdtempSync(join(tmpdir(), "opensider-native-ui-"));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
});

const command = (sw, cmd) => sw.evaluate((c) => globalThis.__opensiderDispatch(c), cmd);
const nativeUi = (result) => result?.data?.nativeUi ?? [];

try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const swReady = async () => (await sw.evaluate(() => typeof globalThis.__opensiderDispatch)) === "function";
  for (let i = 0; i < 40 && !(await swReady()); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  check("extension service worker started", await swReady());

  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept("typed-by-user");
  });

  // The first page of a fresh profile can load before the extension has registered its
  // content scripts, so give the shim a few chances (a reload is the cheapest way).
  const hookReady = async (target) => (await target.evaluate(() => typeof window.__opensiderNativeUi)) === "object";
  const waitForHook = async (target, url) => {
    await target.goto(url);
    for (let i = 0; i < 10; i += 1) {
      if (await hookReady(target)) return true;
      await new Promise((resolve) => setTimeout(resolve, 250));
      await target.reload();
    }
    return false;
  };

  check("shim installed on a plain page", await waitForHook(page, `${base}/plain.html`));

  // 1. observe mode: the real dialog opens, and we still learn the answer the user gave.
  const click = (selector) => command(sw, { id: `c-${selector}`, method: "click", args: { selector } });

  const observedClick = await click("#confirm");
  await page.waitForTimeout(300);
  const observed = nativeUi(observedClick).find((event) => event.kind === "confirm");
  check(
    "confirm() observed with the user's answer",
    Boolean(observed) && observed.handled !== true && observed.answer === true,
    JSON.stringify(observed),
  );
  check("the native dialog really opened", dialogs.includes("Delete the thing?"), dialogs.join(" | "));

  // 2. answer mode: no dialog at all, the page still gets a value.
  const applied = await command(sw, {
    id: "policy-1",
    method: "setDialogPolicy",
    args: { policy: { mode: "answer", confirm: true, promptText: "from-agent" } },
  });
  check(
    "setDialogPolicy arms answer mode",
    applied?.ok === true && applied.data?.policy?.mode === "answer",
    JSON.stringify(applied?.data),
  );
  dialogs.length = 0;
  const answered = await click("#confirm");
  await page.waitForTimeout(200);
  const outText = await page.textContent("#out");
  check("answer mode returns true to the page", outText === "confirm:true", String(outText));
  check("answer mode shows no dialog", dialogs.length === 0, dialogs.join(" | "));
  const handled = nativeUi(answered).find((event) => event.kind === "confirm");
  check("answered dialog rides along in the command result", Boolean(handled?.handled), JSON.stringify(handled));

  // 3. prompt gets the policy text, again without a dialog.
  const prompted = await click("#prompt");
  const promptOut = await page.textContent("#out");
  check("answer mode types the policy text into prompt()", promptOut === "prompt:from-agent", String(promptOut));
  check("prompt event recorded as handled", nativeUi(prompted).some((e) => e.kind === "prompt" && e.handled));

  // 4. window.open is only ever observed, never blocked by us.
  const popped = await click("#popup");
  await page.bringToFront(); // the popup took focus; commands follow the focused tab
  await page.waitForTimeout(150);
  const popupEvent = nativeUi(popped).find((event) => event.kind === "popup");
  check("window.open recorded", Boolean(popupEvent), JSON.stringify(popupEvent));

  // 5. the file picker is swallowed in answer mode (it would freeze the page's JS thread).
  const picked = await click("#pick");
  const fileEvent = nativeUi(picked).find((event) => event.kind === "file-chooser");
  check("file chooser recorded and blocked", Boolean(fileEvent?.blocked), JSON.stringify(picked?.data));

  // 6. the policy expires, so a user's own dialog is untouched again.
  const expired = await command(sw, {
    id: "policy-2",
    method: "setDialogPolicy",
    args: { policy: { mode: "answer", confirm: true, expiresAt: Date.now() - 1_000 } },
  });
  dialogs.length = 0;
  const afterExpiry = await click("#confirm");
  await page.waitForTimeout(300);
  check(
    "an expired answer policy falls back to observing",
    dialogs.includes("Delete the thing?"),
    `dialogs=${dialogs.join(" | ")} policy=${JSON.stringify(expired?.data?.policy)} out=${await page.textContent("#out")} nativeUi=${JSON.stringify(nativeUi(afterExpiry))}`,
  );

  // 7. a strict CSP page: does the MAIN-world bundle still install?
  const strict = await context.newPage();
  check("shim installed on a script-src 'self' page", await waitForHook(strict, `${base}/csp.html`));

  // 8. state that the Agent reads alongside the dialogs.
  const state = await command(sw, { id: "read-2", method: "getNativeUi" });
  check(
    "getNativeUi reports visibility / policy",
    state?.ok === true && typeof state.data?.ui?.visibility === "string" && Boolean(state.data?.policy),
    JSON.stringify(state?.data?.ui),
  );
} finally {
  await context.close().catch(() => {});
  server.close();
  rmSync(profile, { recursive: true, force: true });
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
