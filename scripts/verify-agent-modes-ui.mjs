#!/usr/bin/env node
// Does the session-mode control show up as soon as the agent is connected — without the
// user having to send a message first?
//
// Mode data is advertised in the `session/new|load` response, so the panel has to bind the
// session the moment the host reports ready. It used to bind one render late (the handler
// read a `statusRef` that is only written during render), so the control only appeared
// after the first message created the session. This script is the guard for that.
//
// It also covers the session config options that ride next to the model picker: the
// reasoning-effort pill (engine's own name/value names, 48px cap below 396px) and the
// model_config switch inside the model menu. Set FAKE_OPTIONS=none to skip them.
//
//   node scripts/verify-agent-modes-ui.mjs
//   SWITCH_TO=opencode SWITCH_LABEL=OpenCode node scripts/verify-agent-modes-ui.mjs
//   FAKE_OPTIONS=cursor node scripts/verify-agent-modes-ui.mjs   # model_config select only
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
// 默认让假引擎广告 Claude 那一套（effort + fast），这样配置项那条链也一起被验到。
const optionShape = process.env.FAKE_OPTIONS ?? "claude";

const sandbox = createSandbox({ root, prefix: "opensider-modes-ui-", dist });
const context = await chromium.launchPersistentContext(sandbox.profile, {
  headless: process.env.HEADLESS !== "0",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_MODES: process.env.FAKE_MODES ?? "both",
    FAKE_OPTIONS: optionShape,
  },
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/** Poll an async getter until it returns the wanted value (or the deadline passes). */
const waitFor = async (getter, timeoutMs, wanted) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await getter().catch(() => null);
    if (last === wanted) return last;
    if (wanted === null && last) return last;
    await new Promise((r) => setTimeout(r, 250));
  }
  return last;
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

  // -------------------------------------------------- 推理档位 pill 与模型菜单里的开关
  const effortPill = () => panel.locator('button[title^="Effort"]').first();
  const waitForEffort = async (predicate, timeoutMs = 30_000) => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const title = await effortPill().getAttribute("title").catch(() => null);
      if (predicate(title ?? "")) return title;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  if (optionShape === "claude") {
    const title = await waitForEffort((value) => value.length > 0);
    check(
      "the reasoning-effort pill shows the engine's own name and value name",
      title === "Effort — Xhigh",
      `title=${title ?? "none"}`,
    );

    const geometry = await panel.evaluate(() => {
      const model = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Model");
      const effort = document.querySelector('button[title^="Effort"]');
      if (!model || !effort) return null;
      const m = model.getBoundingClientRect();
      const e = effort.getBoundingClientRect();
      return { modelRight: Number(m.right.toFixed(1)), effortLeft: Number(e.left.toFixed(1)), width: Number(e.width.toFixed(1)) };
    });
    check(
      "it sits immediately right of the model picker",
      Boolean(geometry) && geometry.effortLeft >= geometry.modelRight - 1,
      geometry ? `model.right=${geometry.modelRight} effort.left=${geometry.effortLeft}` : "not found",
    );

    // 点一下最宽的那一档：引擎真的接受了，推回来的当前值才会变。
    await effortPill().click({ timeout: 10_000 });
    await panel.getByRole("button", { name: /^Max$/ }).first().click({ timeout: 10_000 });
    const raised = await waitForEffort((value) => value === "Effort — Max");
    check("picking a level moves the session", Boolean(raised), `title=${raised ?? "unchanged"}`);

    // 模型菜单底部的 model_config：布尔项画成开关（引擎没给值名，开关正好不需要文案）。
    await panel.locator('button[aria-label="Model"]').first().click({ timeout: 10_000 });
    const toggle = panel.locator('button[aria-pressed]').filter({ hasText: "Fast mode" }).first();
    const before = await toggle.getAttribute("aria-pressed").catch(() => null);
    check("the model menu carries the model_config switch", before !== null, `aria-pressed=${before}`);
    if (before !== null && before !== "true") {
      await toggle.click({ timeout: 10_000 });
      const after = await waitFor(() => toggle.getAttribute("aria-pressed"), 10_000, "true");
      check("the model_config switch flips on", after === "true", `aria-pressed=${after ?? "unchanged"}`);
    }
    await panel.keyboard.press("Escape");

    // 窄宽度下这个钮**不设人为上限**：档位名要完整看得见，而且它不带图标（见过的问题：
    // 48px 上限 + 图标把标签挤到 14px，连一个省略号都排不下，看着像硬切）。
    await panel.setViewportSize({ width: 390, height: 620 });
    await new Promise((r) => setTimeout(r, 600));
    const narrow = await panel.evaluate(() => {
      const effort = document.querySelector('button[title^="Effort"]');
      if (!effort) return null;
      const rect = effort.getBoundingClientRect();
      const style = getComputedStyle(effort);
      // 省略发生在内层 span 上（它才是 truncate 的那一层），所以要量它。
      const label = effort.querySelector("span");
      const row = effort.parentElement?.parentElement;
      return {
        width: Number(rect.width.toFixed(1)),
        height: Number(rect.height.toFixed(1)),
        whiteSpace: style.whiteSpace,
        icons: effort.querySelectorAll("svg").length,
        clipped: label ? label.scrollWidth > label.clientWidth : false,
        text: (effort.textContent || "").trim(),
        labelWidth: label ? Number(label.getBoundingClientRect().width.toFixed(1)) : null,
        rowOverflow: row ? row.scrollWidth > row.clientWidth + 1 : false,
      };
    });
    check(
      "the effort pill carries no icon",
      Boolean(narrow) && narrow.icons === 0,
      narrow ? `icons=${narrow.icons}` : "not found",
    );
    check(
      "below 396px the value name still fits on one line, not clipped to a stub",
      Boolean(narrow) && narrow.height <= 30 && narrow.whiteSpace === "nowrap"
        && narrow.text.length > 0 && !narrow.clipped && !narrow.rowOverflow,
      narrow
        ? `width=${narrow.width} label=${narrow.labelWidth} height=${narrow.height} clipped=${narrow.clipped} row-overflow=${narrow.rowOverflow} text=${JSON.stringify(narrow.text)}`
        : "not found",
    );
    // 收起态（只画图标）的两个下拉钮必须是**正圆**：宽高相等 + 圆角至少半个高度。
    // 出过的事：宽 30 高 28 的「圆」，hover 背景是个椭圆。
    const round = await panel.evaluate(() => {
      const buttons = [...document.querySelectorAll("button[aria-expanded]")];
      const picked = buttons.filter(
        (button) => (button.textContent || "").trim() === "" && button.getAttribute("title"),
      );
      return picked.map((button) => {
        const rect = button.getBoundingClientRect();
        const radius = parseFloat(getComputedStyle(button).borderTopLeftRadius) || 0;
        return {
          width: Number(rect.width.toFixed(1)),
          height: Number(rect.height.toFixed(1)),
          radius: Number(radius.toFixed(1)),
          title: (button.getAttribute("title") || "").slice(0, 12),
        };
      });
    });
    check(
      "the icon-only dropdowns are perfect circles",
      round.length === 2 &&
        round.every((item) => Math.abs(item.width - item.height) <= 1 && item.radius >= item.height / 2 - 1),
      JSON.stringify(round),
    );
    await panel.setViewportSize({ width: 900, height: 620 });
  } else if (optionShape === "cursor") {
    await panel.locator('button[aria-label="Model"]').first().click({ timeout: 10_000 });
    const row = panel.locator('button').filter({ hasText: /^Off$|^Fast$/ }).first();
    check("cursor's model_config select is listed inside the model menu", Boolean(await row.count().catch(() => 0)));
    await panel.keyboard.press("Escape");
  } else {
    check(
      "no thought_level advertised -> no effort pill",
      (await panel.locator('button[title^="Effort"]').count()) === 0,
      optionShape,
    );
  }
} catch (error) {
  check("the verification ran to completion", false, String(error?.message ?? error).slice(0, 160));
}

await context.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length && results.length > 0 ? 0 : 1);
