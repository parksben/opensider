// Shared scaffolding for the verification scripts that need a real Chromium with the
// extension loaded, the native host registered, and an agent to talk to.
//
// Everything lives in a throwaway sandbox: a temp home for the host (its `~/.opensider`
// state never touches the user's), a temp Chromium profile, and a fake ACP agent posing as
// the `copilot` CLI. Chromium's own build reads native messaging manifests from inside the
// profile directory (a sandboxed HOME is ignored), which keeps the user's browser setup
// untouched.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function loadPlaywright() {
  try {
    return createRequire(import.meta.url)("playwright");
  } catch {
    const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim();
    return createRequire(pathToFileURL(join(globalRoot, "playwright", "index.js")))("playwright");
  }
}

/** Playwright's already-cached Chromium build, if there is one. */
export function cachedChromium() {
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

/** The unpacked extension's id, derived from the key in its manifest. */
export function extensionIdFromDist(dist) {
  const key = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8")).key;
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest].map((byte) => "abcdefghijklmnop"[byte >> 4] + "abcdefghijklmnop"[byte & 15]).join("");
}

/**
 * Sets up a sandbox: builds the host binary, installs the fake agent where detection looks
 * first, and writes the native messaging manifest into a fresh Chromium profile.
 *
 *   const sandbox = createSandbox({ root, prefix: "opensider-queue-" });
 *   const context = await chromium.launchPersistentContext(sandbox.profile, {
 *     args: [--disable-extensions-except=${dist}, --load-extension=${dist}], env: {...},
 *   });
 */
export function createSandbox({ root, prefix, dist }) {
  const sandbox = mkdtempSync(join(tmpdir(), prefix));
  const home = join(sandbox, "home");
  const hostBin = join(sandbox, "runtime", "opensider");
  const tracePath = join(sandbox, "agent-trace.jsonl");
  // The agent search order starts with the OpenSider-owned ACP bin dirs and only then walks
  // the version managers and PATH, so the stub has to live there to win over a real copilot.
  const stubDir = join(home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin");
  mkdirSync(stubDir, { recursive: true });
  mkdirSync(home, { recursive: true });

  execFileSync("go", ["build", "-o", hostBin, "./cmd/opensider"], { cwd: root, stdio: "inherit" });

  const stub = join(stubDir, "copilot");
  writeFileSync(stub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
  chmodSync(stub, 0o755);

  // The host runs with the sandbox home so none of the user's OpenSider state is touched.
  const launcher = join(sandbox, "launch-host.sh");
  writeFileSync(launcher, `#!/bin/sh\nexport HOME="${home}"\nexec "${hostBin}"\n`);
  chmodSync(launcher, 0o755);

  const extensionId = extensionIdFromDist(dist);
  const profile = mkdtempSync(join(tmpdir(), `${prefix}profile-`));
  const manifestDir = join(profile, "NativeMessagingHosts");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(
    join(manifestDir, "com.opensider.host.json"),
    JSON.stringify(
      {
        name: "com.opensider.host",
        description: "OpenSider native host (verification)",
        path: launcher,
        type: "stdio",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2,
    ),
  );

  return {
    dir: sandbox,
    home,
    hostBin,
    profile,
    tracePath,
    extensionId,
    workspace: join(home, ".opensider", "workspace"),
    uploads: join(home, ".opensider", "workspace", "browser", "uploads"),
  };
}

/** Launches the sandboxed browser with the extension loaded. */
export async function launchSandbox(chromium, { dist, sandbox, env = {} }) {
  return chromium.launchPersistentContext(sandbox.profile, {
    headless: true,
    executablePath: cachedChromium(),
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    env: { ...process.env, ...env },
  });
}

/** The service worker, waiting for it if this is the first launch. */
export async function waitForWorker(context, timeout = 30_000) {
  const [worker] = context.serviceWorkers();
  if (worker) return worker;
  return context.waitForEvent("serviceworker", { timeout });
}

export function check(name, ok, detail = "", results = []) {
  results.push({ name, ok });
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}
