#!/usr/bin/env node
// Verifies the queue "send now" flow end to end, in a real Chromium:
//
//   send a long-running message -> queue a second one -> click "send now"
//
// The queued message has to show up and a NEW turn has to start (that is the bug
// this guards: the interrupt worked but the queued message never got sent).
//
// It runs everything in a throwaway sandbox: a temp HOME, a freshly built host
// binary registered as the native messaging host, and a fake ACP agent installed
// as the `copilot` CLI, so no real agent or user state is touched.
//
//   node scripts/verify-queue-send-now.mjs            # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const CHUNKS = 60;
const CHUNK_MS = 200;

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

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const trace = (path) => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
};

// ---- sandbox ---------------------------------------------------------------

const sandbox = mkdtempSync(join(tmpdir(), "opensider-e2e-"));
const home = join(sandbox, "home");
const hostBin = join(sandbox, "runtime", "opensider");
const tracePath = join(sandbox, "agent-trace.jsonl");
// The agent search order starts with the OpenSider-owned ACP bin dirs and only then
// walks the version managers and PATH, so the stub has to live there to win over a
// real copilot install. Nothing outside the sandbox home is involved.
const stubDir = join(home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin");
mkdirSync(stubDir, { recursive: true });
mkdirSync(home, { recursive: true });

console.log(`Building the host into ${hostBin}`);
execFileSync("go", ["build", "-o", hostBin, "./cmd/opensider"], { cwd: root, stdio: "inherit" });

// The fake agent has to answer to the name the copilot profile looks for.
const stub = join(stubDir, "copilot");
writeFileSync(stub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
chmodSync(stub, 0o755);

// The host runs with a sandbox home so none of the user's OpenSider state is touched.
const launcher = join(sandbox, "launch-host.sh");
writeFileSync(launcher, `#!/bin/sh\nexport HOME="${home}"\nexec "${hostBin}"\n`);
chmodSync(launcher, 0o755);

// Chromium's own build keeps native messaging manifests inside the profile directory
// (a sandboxed HOME is ignored), which is exactly what this check wants: everything
// stays in the temp profile, nothing of the user's browser setup is rewritten.
const extensionId = (() => {
  const key = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")).key;
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].map((byte) => "abcdefghijklmnop"[byte >> 4] + "abcdefghijklmnop"[byte & 15]).join("");
})();
const profile = mkdtempSync(join(tmpdir(), "opensider-e2e-profile-"));
const manifestDir = join(profile, "NativeMessagingHosts");
mkdirSync(manifestDir, { recursive: true });
writeFileSync(
  join(manifestDir, "com.opensider.host.json"),
  JSON.stringify(
    {
      name: "com.opensider.host",
      description: "OpenSider native host (queue send-now verification)",
      path: launcher,
      type: "stdio",
      allowed_origins: [`chrome-extension://${extensionId}/`],
    },
    null,
    2,
  ),
);

const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html><head><title>fixture</title></head><body><h1>fixture page</h1></body></html>`);
});
const port = await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

const { chromium } = loadPlaywright();
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: {
    ...process.env,
    FAKE_ACP_CHUNKS: String(CHUNKS),
    FAKE_ACP_CHUNK_MS: String(CHUNK_MS),
    FAKE_ACP_TRACE: tracePath,
    // Lets a run exercise an agent that keeps going for a while after session/cancel:
    //   FAKE_ACP_IGNORE_CANCEL_MS=1500 node scripts/verify-queue-send-now.mjs
    ...(process.env.FAKE_ACP_IGNORE_CANCEL_MS
      ? { FAKE_ACP_IGNORE_CANCEL_MS: process.env.FAKE_ACP_IGNORE_CANCEL_MS }
      : {}),
  },
});

let panel;
try {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extensionId = new URL(sw.url()).host;
  check("extension service worker started", Boolean(extensionId));

  const fixture = await context.newPage();
  await fixture.goto(`http://127.0.0.1:${port}/`);
  await fixture.bringToFront();

  panel = await context.newPage();
  if (process.env.E2E_DEBUG) {
    panel.on("console", (msg) => console.log(`[panel] ${msg.type()}: ${msg.text()}`));
    panel.on("pageerror", (error) => console.log(`[panel] error: ${error.message}`));
    sw.on("console", (msg) => console.log(`[sw] ${msg.type()}: ${msg.text()}`));
  }
  await panel.goto(`chrome-extension://${extensionId}/src/sidepanel/index.html`);
  await panel.bringToFront();

  const composer = panel.locator('[contenteditable="true"]');
  const bodyText = () => panel.evaluate(() => document.body.innerText);
  const waitForText = (needle, timeout = 30_000) =>
    panel.waitForFunction((value) => document.body.innerText.includes(value), needle, { timeout });

  // 1. Connect to the fake agent through the onboarding screen.
  const agentButton = panel.getByRole("button", { name: "GitHub Copilot" });
  try {
    await agentButton.click({ timeout: 20_000 });
  } catch {
    console.log(`--- panel text ---\n${await bodyText()}\n------------------`);
    throw new Error("could not find the agent button; see the panel text above");
  }
  await composer.waitFor({ state: "visible", timeout: 30_000 });
  check("the sidepanel connected to the fake agent", true);

  const send = async (text) => {
    await composer.click();
    await panel.keyboard.type(text);
    await panel.keyboard.press("Enter");
  };

  // 2. Start a long turn, then queue a second message while it runs.
  const first = "first message";
  const second = "second message";
  await send(first);
  await waitForText("T1.3");
  check("the first turn is streaming", true);

  await send(second);
  const queued = panel.locator("ol li", { hasText: second });
  await queued.waitFor({ state: "visible", timeout: 15_000 });
  check("the second message was queued while the first turn ran", true);

  // 3. Send it now: this is the reported flow (interrupt + send the new message).
  await queued.locator("button").first().click();

  let started = true;
  try {
    await waitForText("T2.3", 30_000);
  } catch {
    started = false;
  }
  check("a new turn started for the queued message", started, started ? "" : "no T2.* chunk was streamed");

  let cleared = true;
  try {
    await queued.waitFor({ state: "detached", timeout: 15_000 });
  } catch {
    cleared = false;
  }
  check("the queue entry was consumed", cleared);

  // The transcript has to still carry the message the user sent.
  const text = await bodyText();
  check("the sent message is still on screen", text.includes(second));

  // 4. The agent's own view: two prompts, the second one carrying the queued text.
  const events = trace(tracePath);
  const prompts = events.filter((event) => event.event === "prompt");
  check("the agent received exactly two prompts", prompts.length === 2, `saw ${prompts.length}`);
  check(
    "the second prompt carried the queued message",
    Boolean(prompts[1]?.text?.includes(second)),
    prompts[1]?.text ? `got ${JSON.stringify(prompts[1].text.slice(0, 80))}` : "no second prompt",
  );
  check(
    "the first turn was cancelled by the host",
    events.some((event) => event.event === "cancel") &&
      events.some((event) => event.event === "end" && event.turn === 1 && event.stopReason === "cancelled"),
  );

  // The interrupt has to actually cut the running turn short.
  const streamed = (text.match(/T1\.\d+/g) ?? []).length;
  check("the interrupted turn stopped early", streamed < CHUNKS, `${streamed}/${CHUNKS} chunks`);

  // 5. The host really took the interrupt path (not the "prompt ignored" one).
  let logged = false;
  try {
    logged = execFileSync("grep", ["-r", "prompt interrupt requested", join(home, ".opensider")], {
      encoding: "utf8",
    }).includes("prompt interrupt requested");
  } catch {
    logged = false;
  }
  check("the host logged the interrupt", logged);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log(`--- panel text ---\n${await bodyText()}\n------------------`);
  }
  process.exitCode = failed.length > 0 ? 1 : 0;
} catch (error) {
  console.log(`--- panel text ---\n${panel ? await panel.evaluate(() => document.body.innerText) : ""}\n------------------`);
  throw error;
} finally {
  await context.close();
  server.close();
}
