#!/usr/bin/env node
// The composer owns the Agent switch now: it sits in the input toolbar, left of the model
// and reasoning pickers, and the connecting progress replaces the row under the input.
//
// What this guards:
//   - the Agent pill is inside the composer (the header no longer carries it)
//   - Agent / model / effort all sit on the left, the send button stays on the right
//   - the footer row is the same height while connecting and when ready, so switching
//     Agents never nudges the input box up or down
//   - the Agent menu opens upward near the viewport bottom instead of off-screen
//
//   node scripts/verify-composer-layout.mjs
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { check, createSandbox, extensionIdFromDist, loadPlaywright, cachedChromium } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail = "") => check(name, value, detail, results);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { chromium } = loadPlaywright();
const sandbox = createSandbox({ root, prefix: "opensider-composer-", dist });
// 选 Hermes（profile 里 steer: true），这样跑起来时底部右侧的「引导」胶囊也在场。
// 入口仍然指向假 Agent，测的只是布局。
const hermesStub = join(sandbox.home, ".opensider", "runtime", "claude-acp", "node_modules", ".bin", "hermes-acp");
mkdirSync(dirname(hermesStub), { recursive: true });
writeFileSync(hermesStub, `#!/bin/sh\nexec node "${join(root, "scripts", "fake-acp-agent.mjs")}" "$@"\n`);
chmodSync(hermesStub, 0o755);
const context = await chromium.launchPersistentContext(sandbox.profile, {
  headless: process.env.HEADED !== "1",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_MODES: "both",
    FAKE_OPTIONS: "claude",
    // Hold the panel in "connecting" long enough to measure the composer there.
    FAKE_ACP_INIT_MS: "5000",
  },
});

const rect = (el) => {
  const box = el.getBoundingClientRect();
  return {
    left: Number(box.left.toFixed(1)),
    right: Number(box.right.toFixed(1)),
    top: Number(box.top.toFixed(1)),
    bottom: Number(box.bottom.toFixed(1)),
    width: Number(box.width.toFixed(1)),
    height: Number(box.height.toFixed(1)),
  };
};

try {
  const id = extensionIdFromDist(dist);
  let worker;
  for (let i = 0; !worker && i < 80; i += 1) {
    worker = context.serviceWorkers().find((item) => item.url().includes(id));
    if (!worker) await sleep(250);
  }
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await sleep(250);
  }

  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1, savedAt: now, locale: "en", theme: "light", selectedId: "c1",
    selectedModelId: "", selectedModelByProvider: {}, agentMode: "ask",
    selectedProviderId: "copilot", onboardingCompleted: true, sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{
      id: "c1",
      title: "前端监控大盘与实时告警配置的完整回归验证记录",
      createdAt: now,
      updatedAt: now,
      todos: [],
      artifacts: [],
      messages: [],
    }],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 620 });
  await panel.goto(`chrome-extension://${id}/src/sidepanel/index.html`);
  await panel.locator('[contenteditable="true"]').waitFor({ timeout: 60_000 });

  const snapshot = () =>
    panel.evaluate(() => {
      const composer = document.querySelector(".cs-composer");
      const box = composer.getBoundingClientRect();
      const footer = composer.nextElementSibling;
      const footerBox = footer.getBoundingClientRect();
      return {
        composerTop: Number(box.top.toFixed(1)),
        composerBottom: Number(box.bottom.toFixed(1)),
        footerHeight: Number(footerBox.height.toFixed(1)),
        footerText: (footer.textContent || "").replace(/\s+/g, " ").trim(),
      };
    });

  // 1. Still connecting (the fake agent's initialize is delayed): the footer carries the
  //    progress and the cancel action, and none of the mode pills.
  let connecting;
  for (let i = 0; i < 60; i += 1) {
    const text = (await snapshot()).footerText;
    if (/\d+\/\d+/.test(text)) {
      connecting = await snapshot();
      break;
    }
    await sleep(200);
  }
  ok("connecting replaces the footer with the progress row", Boolean(connecting), connecting?.footerText ?? "not seen");
  ok(
    "connecting hides the mode and permission pills",
    Boolean(connecting) && !/Agent|Ask every time|Allow/.test(connecting.footerText),
    connecting?.footerText ?? "",
  );

  // 2. Ready: the pills come back.
  await panel.getByText(/Xhigh|Effort/).first().waitFor({ timeout: 60_000 });
  await panel.waitForTimeout(400);
  const ready = await snapshot();
  ok("ready restores the mode pills", /Agent/.test(ready.footerText), ready.footerText);
  ok(
    "the footer keeps its height across connect, so the input does not move",
    Boolean(connecting) &&
      Math.abs(ready.footerHeight - connecting.footerHeight) <= 0.5 &&
      Math.abs(ready.composerTop - connecting.composerTop) <= 0.5 &&
      Math.abs(ready.composerBottom - connecting.composerBottom) <= 0.5,
    connecting
      ? `connecting top=${connecting.composerTop} h=${connecting.footerHeight}; ready top=${ready.composerTop} h=${ready.footerHeight}`
      : "no connecting sample",
  );

  // 3. The Agent switch lives in the composer, left of the model and effort pills; the
  //    header keeps only the title and the drawer button.
  const layout = await panel.evaluate(() => {
    const measure = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: Number(box.left.toFixed(1)),
        right: Number(box.right.toFixed(1)),
        top: Number(box.top.toFixed(1)),
        width: Number(box.width.toFixed(1)),
      };
    };
    const composer = document.querySelector(".cs-composer");
    const buttons = [...composer.querySelectorAll("button")];
    const agent = buttons.find((button) => button.getAttribute("aria-label") === "Switch agent");
    const model = buttons.find((button) => button.getAttribute("aria-label") === "Model");
    const send = buttons.find((button) => button.getAttribute("aria-label") === "Send");
    const effort = buttons.find((button) => (button.getAttribute("title") || "").startsWith("Effort"));
    const header = document.querySelector("header");
    return {
      agent: agent ? measure(agent) : null,
      model: model ? measure(model) : null,
      effort: effort ? measure(effort) : null,
      send: send ? measure(send) : null,
      composer: measure(composer),
      headerHasAgentSwitch: Boolean(header?.querySelector('button[aria-label="Switch agent"]')),
    };
  });
  ok("the Agent switch sits inside the composer", Boolean(layout.agent));
  ok("the header no longer carries the Agent switch", !layout.headerHasAgentSwitch);
  ok(
    "the toolbar pills sit flush (no gap beyond their own padding)",
    Boolean(layout.agent && layout.model && layout.effort) &&
      layout.model.left - layout.agent.right <= 1 &&
      layout.effort.left - layout.model.right <= 1,
    layout.agent && layout.model && layout.effort
      ? `agent.right=${layout.agent.right} model.left=${layout.model.left} model.right=${layout.model.right} effort.left=${layout.effort.left}`
      : "a pill is missing",
  );
  ok(
    "Agent, model and effort line up on the left in that order",
    Boolean(layout.agent && layout.model && layout.effort) &&
      layout.agent.right <= layout.model.left + 1 &&
      layout.model.right <= layout.effort.left + 1 &&
      Math.abs(layout.agent.top - layout.effort.top) <= 1 &&
      layout.effort.right < layout.composer.right - 80,
    layout.agent && layout.model && layout.effort
      ? `agent=${layout.agent.left}..${layout.agent.right} model=${layout.model.left}..${layout.model.right} effort=${layout.effort.left}..${layout.effort.right} composer.right=${layout.composer.right}`
      : "a pill is missing",
  );
  ok(
    "only the send button stays on the right",
    Boolean(layout.send) && layout.composer.right - layout.send.right <= 16,
    layout.send ? `send.right=${layout.send.right} composer.right=${layout.composer.right}` : "no send button",
  );

  // 4. The Agent menu has to open upward here: the pill lives a few pixels above the
  //    viewport bottom, so a downward menu would land off-screen.
  await panel.locator('button[aria-label="Switch agent"]').click();
  const menu = panel.locator("div.fixed.z-\\[70\\]");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  const menuBox = await menu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      top: Number(box.top.toFixed(1)),
      bottom: Number(box.bottom.toFixed(1)),
      left: Number(box.left.toFixed(1)),
      right: Number(box.right.toFixed(1)),
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  });
  ok(
    "the Agent menu opens above the pill and stays on screen",
    Boolean(layout.agent) &&
      menuBox.bottom <= layout.agent.top + 1 &&
      menuBox.top >= 0 &&
      menuBox.left >= 0 &&
      menuBox.right <= menuBox.viewport.width,
    `menu=${menuBox.top}..${menuBox.bottom} pill.top=${layout.agent?.top} left=${menuBox.left}..${menuBox.right} viewport=${menuBox.viewport.width}x${menuBox.viewport.height}`,
  );

  // 5. Narrow panel: the three pills have to give ground (truncate) instead of pushing
  //    the send button out of the composer.
  await panel.keyboard.press("Escape");
  await panel.setViewportSize({ width: 360, height: 620 });
  await panel.waitForTimeout(500);
  const narrow = await panel.evaluate(() => {
    const composer = document.querySelector(".cs-composer");
    const row = composer.querySelector('[contenteditable="true"]').nextElementSibling;
    const send = composer.querySelector('button[aria-label="Send"]');
    const box = composer.getBoundingClientRect();
    return {
      rowOverflow: row.scrollWidth - row.clientWidth,
      composerOverflow: composer.scrollWidth - composer.clientWidth,
      sendRight: Number(send.getBoundingClientRect().right.toFixed(1)),
      composerRight: Number(box.right.toFixed(1)),
      sendVisible: send.getBoundingClientRect().width > 0,
    };
  });
  ok(
    "at 360px the toolbar truncates instead of overflowing",
    narrow.rowOverflow <= 1 && narrow.composerOverflow <= 1 && narrow.sendVisible,
    `row=${narrow.rowOverflow} composer=${narrow.composerOverflow} send=${narrow.sendVisible}`,
  );
  ok(
    "the send button stays inside the narrow composer",
    narrow.composerRight - narrow.sendRight <= 16,
    `send.right=${narrow.sendRight} composer.right=${narrow.composerRight}`,
  );

  // 6. Header: the session title is left-aligned behind a chat bubble, and a long title
  //    truncates instead of pushing the action buttons off the edge.
  const headerAt = (width) =>
    panel.evaluate((viewport) => {
      const header = document.querySelector("header");
      const title = header.querySelector("[title]");
      const icon = header.querySelector("svg.lucide-message-square");
      const buttons = [...header.querySelectorAll(":scope > div > div:last-child button")];
      const box = header.getBoundingClientRect();
      const titleBox = title.getBoundingClientRect();
      return {
        viewport,
        headerLeft: Number(box.left.toFixed(1)),
        headerRight: Number(box.right.toFixed(1)),
        titleLeft: Number(titleBox.left.toFixed(1)),
        titleRight: Number(titleBox.right.toFixed(1)),
        titleTruncated: title.scrollWidth > title.clientWidth + 1,
        titleAlign: getComputedStyle(title).textAlign,
        iconLeft: icon ? Number(icon.getBoundingClientRect().left.toFixed(1)) : null,
        firstButtonLeft: buttons.length ? Number(Math.min(...buttons.map((b) => b.getBoundingClientRect().left)).toFixed(1)) : null,
        lastButtonRight: buttons.length ? Number(Math.max(...buttons.map((b) => b.getBoundingClientRect().right)).toFixed(1)) : null,
      };
    }, width);

  await panel.setViewportSize({ width: 900, height: 620 });
  await panel.waitForTimeout(400);
  const wide = await headerAt(900);
  ok("the header shows a chat bubble before the title", wide.iconLeft !== null && wide.iconLeft < wide.titleLeft, `icon=${wide.iconLeft} title=${wide.titleLeft}`);
  ok(
    "the title is left-aligned right after the icon",
    wide.titleAlign === "left" && wide.titleLeft - wide.iconLeft <= 20 && wide.titleLeft - wide.headerLeft < 48,
    `align=${wide.titleAlign} icon=${wide.iconLeft} title=${wide.titleLeft} header.left=${wide.headerLeft}`,
  );
  ok(
    "the title never overlaps the header actions",
    wide.firstButtonLeft !== null && wide.titleRight <= wide.firstButtonLeft + 1,
    `title.right=${wide.titleRight} buttons.left=${wide.firstButtonLeft}`,
  );

  for (const width of [360, 320]) {
    await panel.setViewportSize({ width, height: 620 });
    await panel.waitForTimeout(400);
    const narrow = await headerAt(width);
    ok(
      `at ${width}px the long title truncates and the actions stay inside the header`,
      narrow.titleTruncated &&
        narrow.lastButtonRight !== null &&
        narrow.lastButtonRight <= narrow.headerRight + 0.5 &&
        narrow.titleRight <= (narrow.firstButtonLeft ?? 0) + 1,
      `truncated=${narrow.titleTruncated} title.right=${narrow.titleRight} buttons=${narrow.firstButtonLeft}..${narrow.lastButtonRight} header.right=${narrow.headerRight}`,
    );
  }

  // 7. Hermes 支持 steering：运行中「引导」胶囊必须待在右下角（上下文环左侧），
  //    而不是跟模式 / 权限挤在左边。这里不种 selectedProviderId——宿主镜像里的
  //    历史会话会把本地状态抢回去，直接从 Agent 菜单切，跟真实用户路径一致。
  await panel.setViewportSize({ width: 900, height: 620 });
  const hermesComposer = panel.locator('[contenteditable="true"]');
  await hermesComposer.waitFor({ state: "visible", timeout: 60_000 });
  await panel.getByText(/Ask every time|默认权限/).first().waitFor({ timeout: 90_000 });
  await panel.locator('button[title^="Switch agent"]').click();
  await panel.getByRole("button", { name: "Hermes", exact: true }).click();
  const cancelConnect = panel.getByRole("button", { name: /^Cancel$|^取消$/ });
  await cancelConnect.waitFor({ state: "visible", timeout: 30_000 });
  await cancelConnect.waitFor({ state: "hidden", timeout: 90_000 });
  await hermesComposer.click();
  await panel.keyboard.type("hold the turn open");
  await panel.keyboard.press("Enter");
  const steerPill = panel.locator('button[title^="While a turn is running"]');
  const steerShown = await steerPill
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  ok("the steer pill appears while a steerable turn runs", steerShown);
  if (steerShown) {
    const right = await panel.evaluate(() => {
      const composer = document.querySelector(".cs-composer");
      const footer = composer.nextElementSibling;
      const steer = footer.querySelector('button[title^="While a turn is running"]');
      const ring = [...footer.querySelectorAll("button")].find((button) => button.getAttribute("title")?.includes("context used"));
      const mode = footer.querySelector("button[aria-expanded]");
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: Number(r.left.toFixed(1)), right: Number(r.right.toFixed(1)), top: Number(r.top.toFixed(1)) }; };
      return {
        steer: steer ? box(steer) : null,
        ring: ring ? box(ring) : null,
        mode: mode ? box(mode) : null,
        footerRight: Number(footer.getBoundingClientRect().right.toFixed(1)),
        footerMid: Number((footer.getBoundingClientRect().left + footer.getBoundingClientRect().right) / 2),
      };
    });
    // 假 Agent 不报 usage，所以上下文环可能不在；在的话「引导」必须让开它。
    ok(
      "the steer pill sits on the right, left of the context ring",
      Boolean(right.steer && right.mode) &&
        right.steer.left > right.footerMid &&
        (right.ring ? right.steer.right <= right.ring.left + 1 : true) &&
        right.mode.right < right.steer.left,
      JSON.stringify(right),
    );
  }
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
