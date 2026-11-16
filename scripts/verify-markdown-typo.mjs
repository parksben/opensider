#!/usr/bin/env node
// Verifies the Markdown rendering of a transcript message, end to end:
//
//   1. a single `~` used as "roughly" (「约 2~3 个工作日 … 再 2~3 个工作日」) must stay
//      literal — GFM only strikes on `~~`, and the old `singleTilde` default turned those
//      two tildes into one long `<del>` across the sentence
//   2. `~~…~~` still renders a real strikethrough
//   3. the heading ladder is visible: h1 > h2 > h3 > body, h1 at semibold with a hairline
//   4. blockquotes / hr / inline code keep the house style (no backticks around code)
//
//   node scripts/verify-markdown-typo.mjs          # expects packages/extension/dist
//
// It prints one line per check and exits non-zero on the first failure.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");

const DOC = [
  "# Web 前端监控大盘：分位（P95）口径 + Vitals 细分 + 全卡片二级页 方案",
  "",
  "状态：待评审（未改代码）。批次 A（分位口径 + 9 张卡 + 概览表 + 外跳）约 2~3 个工作日可提测，批次 B（四类二级页 + 联调）再 2~3 个工作日。",
  "",
  "## 一、结论先行",
  "",
  "四件事全部可落地：",
  "",
  "- 第一件：指标口径",
  "- 第二件：~~这句应该被划掉~~ 的删除线",
  "",
  "### 1.1 卡片清单",
  "",
  "> 引用一段约束说明。",
  "",
  "行内代码 `reportArtifacts` 不应带反引号。",
  "",
  "---",
  "",
  "| 需求 | 可行性 |",
  "| --- | --- |",
  "| 指标口径 | 是 |",
].join("\n");

const { chromium } = loadPlaywright();
const sandbox = createSandbox({ root, prefix: "opensider-markdown-", dist });
const context = await launchSandbox(chromium, { dist, sandbox, env: { FAKE_MODES: "both", FAKE_OPTIONS: "claude" } });

const results = [];
try {
  const worker = await waitForWorker(context, 60_000);
  for (let i = 0; i < 40; i += 1) {
    if (await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false)) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const now = Date.now();
  const state = {
    version: 1,
    savedAt: new Date(now).toISOString(),
    locale: "zh",
    theme: "light",
    selectedId: "s1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [
      {
        id: "s1",
        title: "markdown",
        createdAt: new Date(now - 2000).toISOString(),
        updatedAt: new Date(now).toISOString(),
        todos: [],
        artifacts: [],
        messages: [
          { id: "s1-u", role: "user", createdAt: new Date(now - 2000).toISOString(), content: [{ type: "text", text: "把方案发我" }] },
          { id: "s1-a", role: "assistant", createdAt: new Date(now - 1000).toISOString(), durationMs: 1000, content: [{ type: "text", text: DOC }] },
        ],
      },
    ],
  };
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), state);

  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 900 });
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  await panel.locator(".markdown h1").first().waitFor({ timeout: 60_000 });

  const rendered = await panel.evaluate(() => {
    const root = document.querySelector(".markdown");
    const px = (el, prop = "fontSize") => Number.parseFloat(getComputedStyle(el)[prop]);
    const h1 = root.querySelector("h1");
    const h2 = root.querySelector("h2");
    const h3 = root.querySelector("h3");
    const body = root.querySelector("p");
    const dels = [...root.querySelectorAll("del")].map((node) => node.textContent ?? "");
    const quote = root.querySelector("blockquote");
    const code = root.querySelector("p code");
    return {
      text: root.textContent ?? "",
      dels,
      sizes: { h1: px(h1), h2: px(h2), h3: px(h3), body: px(body) },
      h1Weight: px(h1, "fontWeight"),
      h1Border: getComputedStyle(h1).borderBottomWidth,
      quoteBorder: quote ? getComputedStyle(quote).borderLeftWidth : "0px",
      codeBefore: code ? getComputedStyle(code, "::before").content : "none",
      hr: Boolean(root.querySelector("hr")),
      table: Boolean(root.querySelector("th")),
    };
  });

  check(
    "a single tilde stays literal (2~3 个工作日 twice is not one big strike)",
    rendered.dels.length === 1 && rendered.dels[0].includes("这句应该被划掉"),
    `del=${JSON.stringify(rendered.dels)}`,
    results,
  );
  check(
    "the tildes are printed as written",
    rendered.text.includes("约 2~3 个工作日可提测") && rendered.text.includes("再 2~3 个工作日"),
    rendered.text.includes("约 2~3 个工作日可提测") ? "found" : "missing",
    results,
  );
  check("a real ~~pair~~ still strikes", rendered.dels.some((text) => text.includes("这句应该被划掉")), JSON.stringify(rendered.dels), results);
  check(
    "the heading ladder descends: h1 > h2 > h3 > body",
    rendered.sizes.h1 > rendered.sizes.h2 && rendered.sizes.h2 > rendered.sizes.h3 && rendered.sizes.h3 > rendered.sizes.body,
    JSON.stringify(rendered.sizes),
    results,
  );
  check("the document title is clearly bigger than body copy", rendered.sizes.h1 >= 18, `h1=${rendered.sizes.h1} body=${rendered.sizes.body}`, results);
  check("headings are semibold", rendered.h1Weight >= 600, `weight=${rendered.h1Weight}`, results);
  check("the document title carries a hairline", rendered.h1Border !== "0px", `border=${rendered.h1Border}`, results);
  check("blockquotes keep their left rule", rendered.quoteBorder !== "0px", `border=${rendered.quoteBorder}`, results);
  check("inline code renders without backticks", rendered.codeBefore === "none" || rendered.codeBefore === '""', `content=${rendered.codeBefore}`, results);
  check("hr and tables still render", rendered.hr && rendered.table, `hr=${rendered.hr} th=${rendered.table}`, results);
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((result) => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
