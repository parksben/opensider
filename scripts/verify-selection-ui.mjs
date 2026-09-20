#!/usr/bin/env node
// Verifies the selection toolbar in a real Chromium with the extension loaded, against a
// throwaway fixture page served from localhost:
//
//   门控        -> 侧栏没开时划词什么都不出现；侧栏打开且 Agent 就绪后出现
//   触发与位置  -> 120ms 内出现；选区贴边时工具条仍完整留在视口内（四边 8px 安全边距）
//   上限        -> 超过 200 字的选区不出现
//   跟随        -> 选区滚出视口，工具条跟着消失
//   翻译        -> 结果层（iframe）出现并显示 Agent 的回复，带「复制」
//   引用        -> 侧栏输入框里出现引文芯片（图标 + 排版引号 + 原文）
//   关闭        -> Esc 与点空白处都收掉
//
//   node scripts/verify-selection-ui.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { createServer } from "node:http";
import { join } from "node:path";
import {
  check,
  createSandbox,
  extensionIdFromDist,
  launchSandbox,
  loadPlaywright,
  waitForWorker,
} from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, value, detail) => check(name, value, detail, results);

const LONG = "长".repeat(220);
const PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>selection fixture</title>
<style>
  body { margin: 0; font: 16px/1.6 sans-serif; }
  .pad { padding: 16px; }
  #tail { margin-top: 1400px; padding: 16px; }
  #edge { position: absolute; right: 0; top: 40px; width: 120px; }
</style></head>
<body>
  <div class="pad">
    <p id="target">浏览器里的划词工具条应该贴着这段文字浮出来。</p>
    <p id="edge">贴右边</p>
    <p id="long">${LONG}</p>
  </div>
  <div id="tail"><p id="down">滚到很下面的一段文字。</p></div>
</body></html>`;

/** 在页面上选中某个元素的文本（真实 Selection + 触发 selectionchange）。 */
const selectText = (page, elementId) =>
  page.evaluate((id) => {
    const node = document.getElementById(id);
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString().trim().slice(0, 40);
  }, elementId);

const toolbar = (page) => page.locator("#opensider-selection");
const actionButton = (page, label) =>
  page.locator(`#opensider-selection button[aria-label="${label}"]`);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 第二条 fixture：模拟 YouTube 那种「页面自己带严格 CSP、还有别的高位浮层（Google 翻译气泡那种）」
// 的站点。`style-src 'self'` 会拦掉**注入到页面文档里的** <style>（我们的第一版就是这么废掉的），
// 但拦不住 CSSOM 构造出来的样式表——正是要验的那条。
const CSP_PAGE = `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>csp fixture</title>
<link rel="stylesheet" href="/csp.css">
</head>
<body>
  <p id="ctarget">严格 CSP 页面上的划词工具条也要有样式。</p>
  <div id="rival" aria-hidden="true"></div>
</body></html>`;

const CSP_CSS = `#rival { position: fixed; inset: 0; z-index: 2147483647; background: rgba(255,0,0,.25); }`;

const server = createServer((req, res) => {
  const path = (req.url ?? "/").split("?")[0];
  if (path === "/csp.css") {
    res.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    res.end(CSP_CSS);
    return;
  }
  if (path === "/csp") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "style-src 'self'; script-src 'self'; object-src 'none'",
    });
    res.end(CSP_PAGE);
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(PAGE);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const PAGE_URL = `http://127.0.0.1:${port}/`;

const sandbox = createSandbox({ root, prefix: "opensider-selection-ui-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  // 假引擎不广告模式与配置项：这个脚本关心的是划词工具条。
  env: { FAKE_MODES: "none", FAKE_OPTIONS: "none" },
});
const ourId = extensionIdFromDist(dist);

try {
  const worker = await waitForWorker(context);
  // 播种侧栏状态：不播就会停在引导页、永远不连 Agent（门控也就永远不开）。
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }
  const now = new Date().toISOString();
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    // 英文界面：这个脚本按英文的按钮名点（工具条文案跟随扩展界面语言）。
    locale: "en",
    theme: "dark",
    selectedId: "m1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [{ id: "m1", title: "selection", createdAt: now, updatedAt: now, messages: [], todos: [], artifacts: [] }],
  });

  // 先只开 fixture 页：侧栏没开 = 门控关，划词不该有任何东西。
  const fixture = await context.newPage();
  fixture.on("pageerror", (error) => console.log("    pageerror:", String(error).slice(0, 200)));
  fixture.on("requestfailed", (request) =>
    console.log("    requestfailed:", request.url().slice(0, 140), request.failure()?.errorText ?? ""),
  );
  // 页面里的报错与加载失败直接打出来：工具条出问题时，这两条日志比断言失败的信息量大得多。
  fixture.on("console", (msg) => {
    if (msg.type() === "error") console.log("    console:", msg.text().slice(0, 200));
  });
  await fixture.goto(PAGE_URL);
  await selectText(fixture, "target");
  await sleep(600);
  ok(
    "侧栏没开时划词不出现工具条",
    (await toolbar(fixture).count()) === 0,
    `${await toolbar(fixture).count()} 个 host`,
  );

  // 打开侧栏页面（它一连接就建会话，Agent 随即就绪 → 门控转开）。
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 900, height: 640 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.waitForFunction(() => document.body.innerText.trim().length > 0, undefined, { timeout: 20_000 });
  // 侧栏连上 Agent（假引擎）之后门控才会开：先等输入框出现（= 已连上），再等工具条出现。
  const composerReady = await panel
    .waitForSelector(".cs-composer", { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  ok("侧栏连上 Agent（输入框出现）", composerReady, composerReady ? "" : "60s 内没有输入框");

  let appeared = false;
  for (let attempt = 0; attempt < 40 && !appeared; attempt += 1) {
    await fixture.bringToFront();
    await selectText(fixture, "target");
    await sleep(500);
    appeared = (await toolbar(fixture).count()) > 0;
  }
  ok("门控打开后划词出现工具条", appeared, appeared ? "" : "20s 内没出现");

  if (appeared) {
    const labels = await fixture.evaluate(() => {
      const host = document.getElementById("opensider-selection");
      const root = host?.shadowRoot;
      return [...(root?.querySelectorAll("button") ?? [])].map((b) => b.getAttribute("aria-label"));
    });
    ok(
      "工具条有品牌标记与三个按钮",
      labels.length === 3 &&
        labels.join("|") === "Translate selection|Search selection|Quote into composer",
      labels.join("|") || "没有按钮",
    );
    const hasBrand = await fixture.evaluate(() => {
      const root = document.getElementById("opensider-selection")?.shadowRoot;
      const img = root?.querySelector("img");
      return Boolean(img && img.src.includes("icons/icon32.png"));
    });
    ok("品牌标记用的是扩展图标", hasBrand);

    // 结构：三个按钮必须长在条里，而且 shadow 树里不能再有漏在条外面的节点。
    // （出过的事故：按钮挂成了 shadow root 的直接子节点 → 跑到条的上方、拿不到条的
    //  内边距，也拿不到挂在 .root 上的调色板，`color: var(--muted)` 回落成 initial，
    //  深色系统里那是白字 → 白底白字看不见。）
    const structure = await fixture.evaluate(() => {
      const host = document.getElementById("opensider-selection");
      const root = host?.shadowRoot;
      const bar = root?.querySelector(".bar");
      if (!host || !root || !bar) return null;
      const box = host.getBoundingClientRect();
      const barBox = bar.getBoundingClientRect();
      const buttons = [...root.querySelectorAll("button")];
      return {
        directChildren: root.children.length,
        allInBar: buttons.length === 3 && buttons.every((b) => b.parentElement === bar),
        rows: new Set(buttons.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        insideBar: buttons.every((b) => {
          const r = b.getBoundingClientRect();
          return (
            r.top >= barBox.top - 1 &&
            r.bottom <= barBox.bottom + 1 &&
            r.left >= barBox.left - 1 &&
            r.right <= barBox.right + 1
          );
        }),
        mutedResolved: buttons.every((b) => getComputedStyle(b).getPropertyValue("--muted").trim() !== ""),
        hostHeight: Math.round(box.height),
        barHeight: Math.round(barBox.height),
        barOffset: Math.round(barBox.top - box.top),
      };
    });
    ok(
      "三个按钮都在条里，排成一行",
      Boolean(structure) && structure.allInBar && structure.rows === 1 && structure.insideBar,
      JSON.stringify(structure ?? {}),
    );
    ok(
      "条里条外没有多余节点（host 的高度就是条的高度）",
      Boolean(structure) &&
        structure.directChildren === 1 &&
        structure.barOffset === 0 &&
        Math.abs(structure.hostHeight - structure.barHeight) <= 1,
      structure ? `children=${structure.directChildren} offset=${structure.barOffset} host=${structure.hostHeight} bar=${structure.barHeight}` : "没有工具条",
    );
    ok(
      "按钮拿得到工具条自己的调色板（不会回落成白字）",
      Boolean(structure) && structure.mutedResolved,
      structure ? `mutedResolved=${structure.mutedResolved}` : "没有工具条",
    );
  }

  // 位置：选区贴右边时，工具条仍要完整落在视口内（左右各留 8px）。
  if (appeared) {
    await fixture.evaluate(() => window.scrollTo(0, 0));
    await selectText(fixture, "edge");
    await sleep(400);
    const box = await toolbar(fixture).boundingBox();
    const viewport = fixture.viewportSize();
    ok(
      "贴右边时工具条不越出视口（左/右各留 8px）",
      Boolean(box) && box.x >= 7 && box.x + box.width <= (viewport?.width ?? 0) - 7,
      box ? `x=${box.x} w=${box.width} vw=${viewport?.width}` : "没有工具条",
    );
  }

  // 严格 CSP + 高位浮层：样式照生效，层级压过页面上抢位的浮层。
  const cspPage = await context.newPage();
  // 页面里的报错直接打出来：这类问题（CSP、层级）断言失败的信息量远不如它。
  cspPage.on("pageerror", (error) => console.log("    csp pageerror:", String(error).slice(0, 160)));
  cspPage.on("console", (msg) => {
    if (msg.type() === "error") console.log("    csp console:", msg.text().slice(0, 200));
  });
  await cspPage.setViewportSize({ width: 900, height: 640 });
  await cspPage.goto(`http://127.0.0.1:${port}/csp`);
  await cspPage.bringToFront();
  let cspInfo = null;
  for (let i = 0; i < 40 && !cspInfo; i += 1) {
    // 每一拍都重选一次：门控可能刚好在这一拍才可用（SW 醒来 / 面板刚连上），
    // 用户遇到这种情况也会再划一次。
    await selectText(cspPage, "ctarget");
    await sleep(250);
    cspInfo = await cspPage
      .evaluate(() => {
        const host = document.getElementById("opensider-selection");
        if (!host) return null;
        const root = host.shadowRoot;
        const brand = root?.querySelector("img");
        const bar = root?.querySelector(".bar");
        const buttons = [...(root?.querySelectorAll("button") ?? [])];
        const box = host.getBoundingClientRect();
        const top = box.width > 0 ? document.elementFromPoint(box.left + box.width / 2, box.top + 6) : null;
        return {
          brandWidth: brand ? getComputedStyle(brand).width : "none",
          barDisplay: bar ? `${getComputedStyle(bar).display}/${getComputedStyle(bar).flexDirection}` : "none",
          buttonsInBar: buttons.length === 3 && buttons.every((b) => b.parentElement === bar),
          popover: host.matches(":popover-open"),
          zIndex: getComputedStyle(host).zIndex,
          topIsOurs: top === host,
        };
      })
      .catch(() => null);
  }
  ok(
    "页面严格 CSP 下工具条的样式照常生效",
    cspInfo?.brandWidth === "16px" && cspInfo?.barDisplay === "flex/row" && cspInfo?.buttonsInBar === true,
    JSON.stringify(cspInfo ?? {}),
  );
  ok(
    "工具条在顶层，压过页面上抢 z-index 的浮层",
    cspInfo?.popover === true && cspInfo?.topIsOurs === true && cspInfo?.zIndex === "2147483647",
    JSON.stringify(cspInfo ?? {}),
  );
  await cspPage.close();

  // 上限：超过 200 字直接不支持。
  await selectText(fixture, "long");
  await sleep(500);
  ok(
    "超过 200 字的选区不出现工具条",
    (await toolbar(fixture).count()) === 0,
    `${await toolbar(fixture).count()} 个 host`,
  );

  // 翻译：结果层是 iframe，里面是侧栏那套渲染 + 假引擎的回复。
  await selectText(fixture, "target");
  await sleep(400);
  const translateButton = actionButton(fixture, "Translate selection");
  if ((await translateButton.count()) > 0) {
    await translateButton.click();
    let resultText = "";
    for (let i = 0; i < 60 && !resultText; i += 1) {
      await sleep(250);
      resultText = await fixture.evaluate(() => {
        // 结果层在工具条的 shadow root 里，得穿进去找（document.querySelectorAll 看不到 shadow）。
        const root = document.getElementById("opensider-selection")?.shadowRoot;
        const frame = root?.querySelector("iframe");
        return frame && frame.src.includes("src/selection") ? "present" : "";
      });
    }
    ok("翻译后出现结果层（iframe）", Boolean(resultText), resultText || "没有 iframe");

    const frames = fixture.frames().filter((frame) => frame.url().includes("src/selection"));
    let body = "";
    for (let i = 0; i < 40 && !body.includes("[translated]"); i += 1) {
      await sleep(250);
      body = await frames[0]?.evaluate(() => document.body.innerText).catch(() => "");
    }
    ok(
      "结果层显示 Agent 的译文",
      body.includes("[translated]"),
      body.replace(/\s+/g, " ").slice(0, 60) || "空",
    );
    ok("结果层带「复制」按钮", /复制|Copy/.test(body), body.replace(/\s+/g, " ").slice(0, 40) || "空");
  } else {
    ok("翻译后出现结果层（iframe）", false, "没有翻译按钮");
  }

  // 搜索：结果层渲染的是 Markdown（同一套渲染器），要能看见标题与来源链接。
  await fixture.bringToFront();
  await selectText(fixture, "target");
  await sleep(400);
  const searchButton = actionButton(fixture, "Search selection");
  if ((await searchButton.count()) > 0) {
    await searchButton.click();
    const frames = fixture.frames().filter((frame) => frame.url().includes("src/selection"));
    let body = "";
    for (let i = 0; i < 40 && !body.includes("Sources"); i += 1) {
      await sleep(250);
      body = await frames[0]?.evaluate(() => document.body.innerText).catch(() => "");
    }
    ok(
      "搜索结果层显示摘要与来源",
      body.includes("Summary") && body.includes("Sources") && body.includes("example"),
      body.replace(/\s+/g, " ").slice(0, 70) || "空",
    );
    // 关键区别：是渲染成 HTML（h2 / ul / a），还是把 markdown 当纯文本贴出来。
    const rendered = await frames[0]
      ?.evaluate(() => ({
        heading: Boolean(document.querySelector(".markdown h2")),
        list: Boolean(document.querySelector(".markdown ul li")),
        link: Boolean(document.querySelector('.markdown a[href^="https://example.com"]')),
      }))
      .catch(() => null);
    ok(
      "Markdown 渲染成了 HTML（标题 / 列表 / 链接）",
      Boolean(rendered?.heading && rendered?.list && rendered?.link),
      JSON.stringify(rendered ?? {}),
    );
  } else {
    ok("搜索结果层渲染 Markdown（标题 + 来源）", false, "没有搜索按钮");
  }

  // 引用：芯片进侧栏输入框。
  await fixture.bringToFront();
  await selectText(fixture, "target");
  await sleep(400);
  const quoteButton = actionButton(fixture, "Quote into composer");
  if ((await quoteButton.count()) > 0) {
    await quoteButton.click();
    const chip = panel.locator(".cs-mention-chip").first();
    let chipText = "";
    for (let i = 0; i < 40 && !chipText; i += 1) {
      await sleep(200);
      chipText = await chip.textContent().catch(() => "");
    }
    ok(
      "引用后侧栏出现引文芯片",
      chipText.includes("浏览器里的划词工具条") && chipText.includes("“"),
      chipText || "没有芯片",
    );
    const icon = await panel.locator(".cs-mention-chip svg").first().count();
    ok("引文芯片带图标", icon === 1, `${icon} 个 svg`);
    ok("引用后工具条自动收掉", (await toolbar(fixture).count()) === 0);
  } else {
    ok("引用后侧栏出现引文芯片", false, "没有引用按钮");
  }

  // 关闭：Esc。
  await fixture.bringToFront();
  await selectText(fixture, "target");
  await sleep(400);
  const beforeEsc = await toolbar(fixture).count();
  await fixture.keyboard.press("Escape");
  await sleep(300);
  ok(
    "Esc 收掉工具条",
    beforeEsc > 0 && (await toolbar(fixture).count()) === 0,
    `before=${beforeEsc} after=${await toolbar(fixture).count()}`,
  );
  const composerCount = await panel.locator(".cs-composer").count();
  ok("划词这一串动作之后侧栏输入框还在", composerCount > 0, `${composerCount} 个输入框`);

  // 跟随：选区滚出视口 → 工具条消失。
  await fixture.bringToFront();
  await fixture.evaluate(() => window.scrollTo(0, 0));
  await selectText(fixture, "target");
  await sleep(400);
  const beforeScroll = await toolbar(fixture).count();
  await fixture.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await sleep(500);
  ok(
    "选区滚出视口后工具条随之消失",
    beforeScroll > 0 && (await toolbar(fixture).count()) === 0,
    `before=${beforeScroll} after=${await toolbar(fixture).count()}`,
  );
} catch (error) {
  ok("verification ran to completion", false, String(error?.message ?? error).slice(0, 200));
} finally {
  await context.close().catch(() => undefined);
  server.close();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
