#!/usr/bin/env node
// The `/` skill probe menu: does it list the skills installed on this machine, filter on
// name / alias / description, show the full description in the panel beside (or below) the
// list, and put the picked skill at the very front of the draft?
//
// Everything runs in a sandbox HOME (scripts/lib/sandbox.mjs), so the six global skill roots
// are seeded here instead of being read off the developer's machine.
//
//   node scripts/verify-skill-menu.mjs
//
// The one thing this script cannot check is whether a real CLI reacts to the `/name` prefix
// in the prompt — that is a per-CLI question, not a UI one; the appendix (with the SKILL.md
// path) is the fallback this script does cover.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, extensionIdFromDist, loadPlaywright, cachedChromium } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const { chromium } = loadPlaywright();

const sandbox = createSandbox({ root, prefix: "opensider-skill-menu-", dist });

/** Drop one skill into the sandbox HOME the way a CLI would have installed it. */
const seed = (dir, body) => {
  mkdirSync(join(sandbox.home, dir), { recursive: true });
  writeFileSync(join(sandbox.home, dir, "SKILL.md"), body);
};

seed(".claude/skills/coding-plan", `---
name: coding-plan
description: User's universal coding workflow — docs first, then code.
---

# Coding Plan
`);
seed(".claude/skills/openclawmp", `---
name: openclawmp
display_name: 水产市场
description: >-
  Browse the market, read every entry
  before installing it.
---
`);
seed(".claude/skills/cli-model-alias-mapper", `---
name: cli-model-alias-mapper
description: Discover locally installed Agent CLIs.
---
`);
// 同一个 skill 也在 Cursor 目录里：列表只该出现一条，且来源是 Claude。
seed(".cursor/skills/cli-model-alias-mapper", `---
name: cli-model-alias-mapper
description: Duplicate copy that should lose to the Claude one.
---
`);
seed(".cursor/skills-cursor/canvas", `---
name: canvas
description: Cursor's own canvas skill.
---
`);
seed(".stepclaw/skills/pptx", `---
name: pptx
description: Build slides from an outline.
---
`);
// 目录里没有 SKILL.md：不是一个 skill，不该出现在列表里。
mkdirSync(join(sandbox.home, ".codex", "skills", "not-a-skill"), { recursive: true });

const context = await chromium.launchPersistentContext(sandbox.profile, {
  headless: process.env.HEADLESS !== "0",
  executablePath: cachedChromium(),
  args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_ACP_TRACE: sandbox.tracePath,
    // 要断言整段提示词（含附注），不能只看前 200 字符。
    FAKE_ACP_TRACE_FULL: "1",
  },
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

try {
  const ourId = extensionIdFromDist(dist);
  let sw;
  for (let i = 0; !sw && i < 80; i += 1) {
    sw = context.serviceWorkers().find((worker) => worker.url().includes(ourId));
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
  await sw.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "dark",
    selectedId: "s1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{ id: "s1", title: "skills", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
  });

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 640 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 20_000 });

  const composer = () => panel.locator(".cs-composer-input");
  const slashButton = () => panel.getByRole("button", { name: "Use a skill" });
  const menu = () => panel.locator("[data-skill-menu]");
  const items = () => panel.locator("[data-skill-index]");
  const itemNames = () => panel.locator("[data-skill-alias]").allInnerTexts();
  const openMenu = async () => {
    if (!(await menu().count())) await slashButton().click({ timeout: 10_000 });
    await menu().first().waitFor({ timeout: 10_000 });
    // 列表来自 Host 的 `skills` 消息，弹层的空态可能先到一步。
    await items().first().waitFor({ timeout: 10_000 });
  };

  // 发出去的那条要落到假引擎的 trace 里，所以得先真的连上沙箱里的 stub agent。
  await panel.getByRole("button", { name: "Switch agent" }).first().waitFor({ timeout: 60_000 });

  // ---------------------------------------------------------------- 列表内容
  await openMenu();
  const names = await itemNames();
  check(
    "the menu lists the installed skills by alias, name-sorted",
    JSON.stringify(names) === JSON.stringify(["canvas", "cli-model-alias-mapper", "coding-plan", "水产市场", "pptx"]),
    names.join(" | "),
  );
  const dupes = names.filter((name) => name === "cli-model-alias-mapper").length;
  check("the same skill in two roots is listed once", dupes === 1, `${dupes} rows`);
  check("a directory without SKILL.md is skipped", !names.includes("not-a-skill"));

  const tags = await panel.locator("[data-skill-source]").allInnerTexts();
  check(
    "each row carries its source tag, and the dedupe kept Claude",
    tags.join("|") === "Cursor built-in|Claude|Claude|Claude|StepClaw",
    tags.join(" | "),
  );

  // ---------------------------------------------------------------- 搜索
  const search = panel.locator("[data-skill-search]");
  const focused = await search.evaluate((node) => node === document.activeElement);
  check("the search box sits in the menu and opens focused", (await search.count()) === 1 && focused);

  const typeQuery = async (value) => {
    await search.fill("");
    if (value) {
      await search.type(value);
      await new Promise((r) => setTimeout(r, 150));
    }
    return itemNames();
  };
  check("a Chinese alias finds its skill", JSON.stringify(await typeQuery("水产")) === JSON.stringify(["水产市场"]));
  check(
    "search ignores case",
    JSON.stringify(await typeQuery("ALIAS-MAPPER")) === JSON.stringify(["cli-model-alias-mapper"]),
  );
  check(
    "the description is searchable too",
    JSON.stringify(await typeQuery("slides")) === JSON.stringify(["pptx"]),
  );
  check("no match shows the empty state", (await typeQuery("zzz")).length === 0);
  await typeQuery("");

  // ---------------------------------------------------------------- 详情面板
  const geometry = () =>
    panel.evaluate(() => {
      const list = document.querySelector("[data-skill-list]");
      const detail = document.querySelector("[data-skill-detail]");
      if (!list || !detail) return null;
      const l = list.getBoundingClientRect();
      const d = detail.getBoundingClientRect();
      return {
        beside: d.left >= l.right - 1,
        // 折到下方时详情自带内边距，左边缘不会和列表完全重合。
        below: d.top >= l.bottom - 1 && Math.abs(d.left - l.left) < 16,
        text: detail.innerText,
      };
    });

  const first = await geometry();
  check(
    "a wide panel shows the detail beside the list",
    Boolean(first?.beside),
    first ? `beside=${first.beside}` : "no detail panel",
  );
  check(
    "the detail panel carries the alias, the path and the full description",
    Boolean(first?.text.includes("canvas")) &&
      Boolean(first?.text.includes(join("canvas", "SKILL.md"))) &&
      Boolean(first?.text.includes("Cursor's own canvas skill.")),
    first?.text.replace(/\n/g, " / ").slice(0, 120),
  );

  // 鼠标 hover 到别的一项：详情跟着换（后发生的覆盖）。
  await panel.locator('[data-skill-index="2"]').hover();
  await new Promise((r) => setTimeout(r, 200));
  const hovered = await geometry();
  check(
    "hovering another row switches the detail panel",
    Boolean(hovered?.text.includes("docs first, then code")),
    hovered?.text.split("\n")[0],
  );

  // ---------------------------------------------------------------- 选中 → 芯片
  await panel.locator('[data-skill-index="0"]').click();
  await new Promise((r) => setTimeout(r, 200));
  const draft = () =>
    composer().evaluate((node) =>
      [...node.childNodes]
        .map((child) => {
          if (child.nodeType === 3) return child.textContent || "";
          if (child instanceof HTMLElement && child.classList.contains("cs-mention-wrap")) {
            return child.textContent || "";
          }
          return "";
        })
        .join("")
        .replace(/\u200b/g, "")
        .replace(/\s+/g, " ")
        .trim(),
    );
  check("picking a skill writes a /name chip", (await draft()).startsWith("/canvas"), await draft());
  check("the menu closes after picking", (await menu().count()) === 0);

  // 第二个 skill 要接在第一个后面（最左侧依次累积），不是反着插到最前。
  await openMenu();
  await panel.locator('[data-skill-index="2"]').click();
  await new Promise((r) => setTimeout(r, 200));
  check(
    "a second pick accumulates to the right of the first",
    (await draft()).startsWith("/canvas /coding-plan"),
    await draft(),
  );

  // 同一个 skill 再选一次只留一个。
  await openMenu();
  await panel.locator('[data-skill-index="2"]').click();
  await new Promise((r) => setTimeout(r, 200));
  const chips = await composer().evaluate(
    (node) => [...node.querySelectorAll(".cs-mention-wrap")].map((wrap) => wrap.textContent || ""),
  );
  check("picking the same skill twice keeps one chip", chips.filter((text) => text === "/coding-plan").length === 1, chips.join(" | "));

  // 在正文中间敲 `/` 唤起：芯片仍然必须落在最前面。
  await composer().click();
  await panel.keyboard.press("End");
  await panel.keyboard.type(" hi there");
  // 光标停到 "hi " 之后（斜杠前面是空白，才算触发）。
  for (let i = 0; i < 5; i += 1) await panel.keyboard.press("ArrowLeft");
  await panel.keyboard.type("/");
  await new Promise((r) => setTimeout(r, 200));
  check("typing / after a space opens the menu wherever the caret is", (await menu().count()) === 1);
  await panel.locator('[data-skill-index="1"]').click();
  await new Promise((r) => setTimeout(r, 200));
  const midDraft = await draft();
  check(
    "a chip picked mid-text still lands at the very front, and the trigger / is gone",
    midDraft.startsWith("/canvas /coding-plan /cli-model-alias-mapper") && midDraft.endsWith("hi there"),
    midDraft,
  );

  // 中文说明匹配 + 键盘回车：只插入、不发送。
  await composer().click();
  await panel.keyboard.press("End");
  await panel.keyboard.type(" /");
  await new Promise((r) => setTimeout(r, 200));
  await panel.locator("[data-skill-search]").fill("水产");
  await new Promise((r) => setTimeout(r, 200));
  await panel.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 250));
  const aliasDraft = await draft();
  check(
    "keyboard Enter inserts the alias match without sending",
    aliasDraft.startsWith("/canvas /coding-plan /cli-model-alias-mapper /openclawmp") && aliasDraft.includes("hi there"),
    aliasDraft,
  );

  // ---------------------------------------------------------------- 发出去
  await panel.getByRole("button", { name: "Send" }).click();
  const traceOf = () => {
    if (!existsSync(sandbox.tracePath)) return [];
    return readFileSync(sandbox.tracePath, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  };
  // 连上引擎到收到 prompt 之间有几步握手，边等边看。
  let sent = "";
  for (let i = 0; i < 60 && !sent; i += 1) {
    const prompts = traceOf().filter((event) => event.event === "prompt");
    sent = prompts[prompts.length - 1]?.text ?? "";
    if (!sent) await new Promise((r) => setTimeout(r, 500));
  }
  check(
    "the /name prefix is the very first thing the CLI reads",
    sent.startsWith("/canvas /coding-plan /cli-model-alias-mapper /openclawmp\n\n[Current tab]"),
    sent.split("\n")[0] || "no prompt reached the agent",
  );
  check(
    "the appendix names the skills and their SKILL.md paths",
    sent.includes("[Skills requested by the user]") &&
      sent.includes("- coding-plan — ") &&
      sent.includes(join("coding-plan", "SKILL.md")),
    sent.slice(sent.indexOf("[Skills"), sent.indexOf("[Skills") + 120),
  );

  // ---------------------------------------------------------------- 窄侧栏
  await panel.setViewportSize({ width: 420, height: 640 });
  await new Promise((r) => setTimeout(r, 400));
  // <600px 时四个功能钮已收进加号菜单，探测菜单要从那里进。
  await panel.getByRole("button", { name: "More actions" }).click();
  await panel.locator('[role="menuitem"]', { hasText: "Use a skill" }).click();
  await menu().first().waitFor({ timeout: 10_000 });
  const narrow = await geometry();
  check(
    "a narrow panel folds the detail under the list",
    Boolean(narrow?.below),
    narrow ? `below=${narrow.below} beside=${narrow.beside}` : "no detail panel",
  );
  const width = await menu().evaluate((node) => Number(node.getBoundingClientRect().width.toFixed(0)));
  check("the folded menu keeps the single-column width", width <= 288, `${width}px`);
  await panel.keyboard.press("Escape");

  // ---------------------------------------------------------------- 工具栏收起
  const plus = panel.getByRole("button", { name: "More actions" });
  check("a narrow row collapses the four action buttons into one plus button", (await plus.count()) === 1);
  check("the flat buttons are gone while collapsed", (await slashButton().count()) === 0);
  await plus.hover();
  await new Promise((r) => setTimeout(r, 300));
  const actions = await panel.locator('[role="menuitem"]').allInnerTexts();
  // macOS：附件一条 + 拾取 + 提及 + 指定 skill。
  check(
    "the plus button opens the four actions",
    actions.length === 4 && actions.join("|") === "Add attachments|Pick element|Mention|Use a skill",
    actions.join(" | "),
  );
  await panel.locator('[role="menuitem"]', { hasText: "Use a skill" }).click();
  await new Promise((r) => setTimeout(r, 300));
  check("the plus menu can open the skill probe", (await menu().count()) === 1);
  await panel.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 200));

  await panel.setViewportSize({ width: 900, height: 640 });
  await new Promise((r) => setTimeout(r, 400));
  check("a wide row shows the four buttons instead", (await slashButton().count()) === 1 && (await plus.count()) === 0);
} finally {
  await context.close();
  console.log(`\nsandbox: ${sandbox.dir}`);
  const failed = results.filter((ok) => !ok).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  if (failed > 0) process.exitCode = 1;
}
