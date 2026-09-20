#!/usr/bin/env node
// Does the session-mode control show up as soon as the agent is connected — without the
// user having to send a message first?
//
// Mode data is advertised in the `session/new|load` response, so the panel has to bind the
// session the moment the host reports ready. It used to bind one render late (the handler
// read a `statusRef` that is only written during render), so the control only appeared
// after the first message created the session. This script is the guard for that.
//
//   node scripts/verify-agent-modes-ui.mjs
//   SWITCH_TO=opencode SWITCH_LABEL=OpenCode node scripts/verify-agent-modes-ui.mjs
//
// Two rules, both learned the hard way:
//   1. Never poke `__opensiderStatus` — that seam re-broadcasts "ready" and cures the very
//      race under test, so the check would pass against the broken build.
//   2. The seeded agent must be one that really connects here: the sandbox stub (`copilot`),
//      not a real CLI that may be signed out.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSandbox,
  extensionIdFromDist,
  loadPlaywright,
  cachedChromium,
} from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const { chromium } = loadPlaywright();
const seedProvider = process.env.SEED_PROVIDER ?? "copilot";
const switchTo = process.env.SWITCH_TO ?? "";
const switchLabel = process.env.SWITCH_LABEL ?? "OpenCode";

const sandbox = createSandbox({ root, prefix: "opensider-modes-ui-", dist });
const context = await chromium.launchPersistentContext(sandbox.profile, {
  headless: process.env.HEADLESS !== "0",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: { ...process.env, HOME: sandbox.home, FAKE_MODES: process.env.FAKE_MODES ?? "both" },
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const ourId = extensionIdFromDist(dist);
  const findSw = () => context.serviceWorkers().find((worker) => worker.url().includes(ourId));
  let sw;
  for (let i = 0; !sw && i < 80; i += 1) {
    sw = findSw();
    if (!sw) await new Promise((r) => setTimeout(r, 250));
  }
  if (!sw) throw new Error("extension service worker never started");
  // The worker gets its chrome.* bindings a moment after it starts.
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await sw.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await new Promise((r) => setTimeout(r, 250));
  }
  check("the sandboxed extension is up", storageReady);

  const now = new Date().toISOString();
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
      selectedProviderId: seedProvider,
      onboardingCompleted: true,
      sessionsOpen: false,
      sessionDrawerWidth: 248,
      sessions: [{ id: "m1", title: "modes", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
    },
  );

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 620 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 20_000 });

  // The mode pill sits immediately left of the permission pill; locate it by geometry so the
  // check does not depend on which engine is connected.
  const modePill = () =>
    panel.evaluate(() => {
      const buttons = [...document.querySelectorAll("button")];
      const perm = buttons.find((b) => /Ask every time|默认权限|Allow all|允许一切操作/.test(b.textContent || ""));
      if (!perm) return { label: null };
      const permRect = perm.getBoundingClientRect();
      const left = buttons
        .map((b) => ({ text: (b.textContent || "").trim(), rect: b.getBoundingClientRect() }))
        .filter((entry) => entry.text && Math.abs(entry.rect.top - permRect.top) < 6 && entry.rect.right <= permRect.left + 1)
        .pop();
      return {
        label: left ? left.text : null,
        gap: left ? Number((permRect.left - left.rect.right).toFixed(1)) : null,
      };
    });

  const waitForPill = async (timeoutMs, exclude) => {
    const started = Date.now();
    let pill = { label: null };
    while (Date.now() - started < timeoutMs) {
      pill = await modePill().catch(() => ({ label: null }));
      if (pill.label && pill.label !== exclude) {
        return { ...pill, seconds: ((Date.now() - started) / 1000).toFixed(1) };
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return { ...pill, seconds: ((Date.now() - started) / 1000).toFixed(1) };
  };

  const first = await waitForPill(60_000, null);
  check(
    "connecting shows the mode control with no message sent",
    Boolean(first.label),
    first.label ? `label=${first.label} gap=${first.gap}px after ${first.seconds}s` : `nothing after ${first.seconds}s`,
  );

  if (switchTo) {
    await panel.getByRole("button", { name: "Switch agent" }).click({ timeout: 10_000 });
    await panel.getByText(switchLabel, { exact: true }).last().click({ timeout: 10_000 });
    const after = await waitForPill(60_000, first.label);
    check(
      "switching agent brings the control back for the new one",
      Boolean(after.label),
      after.label ? `label=${after.label} after ${after.seconds}s` : `nothing after ${after.seconds}s`,
    );
  } else {
    console.log("skip  the switch-agent case (set SWITCH_TO=<provider> SWITCH_LABEL=<name>)");
  }
} catch (error) {
  check("the verification ran to completion", false, String(error?.message ?? error).slice(0, 160));
}

await context.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
