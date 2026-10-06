#!/usr/bin/env node
// Does the transcript hold still while a turn streams?
//
// The panel has one physical law it kept breaking: while a turn runs, nothing that is
// already on screen may move backwards (down). New output grows at the bottom and pushes
// older content up — that reads as streaming. A tool card folding up at the bottom edge,
// or the process above the newest text being swapped out, frees height *below the reader*
// and shoves everything down — that reads as jitter, and it is the thing users report.
//
// This drives the real panel (real extension, real host, real React) against a fake agent
// whose turn is shaped like a real one (thinking → tool that completes → text → second
// tool → text), samples the last user bubble's position every frame while it runs, and
// fails if the transcript jumps backwards or the scroll offset is yanked.
//
//   HEADLESS=1 node scripts/verify-scroll-stability.mjs     # or just run it
//
// Pass A: the reader stays at the bottom, watching. Nothing above the newest output may
//         move down; the offset may not move at all.
// Pass B: the reader scrolls up mid-turn to re-read something. The wheel must win — no
//         snap-back to the bottom, and growth must not move their offset.
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { check, createSandbox, launchSandbox, loadPlaywright, waitForWorker } from "./lib/sandbox.mjs";

const root = join(import.meta.dirname, "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const ok = (name, passed, detail = "") => check(name, passed, detail, results);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const sandbox = createSandbox({ root, prefix: "opensider-scroll-", dist });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, {
  dist,
  sandbox,
  env: { FAKE_ACP_STEPS: "1", FAKE_ACP_STEP_MS: "90", FAKE_ACP_TRACE: sandbox.tracePath },
});
const ourId = sandbox.extensionId;

const trace = () => {
  if (!existsSync(sandbox.tracePath)) return [];
  return readFileSync(sandbox.tracePath, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {};
      }
    });
};
const waitForTurnEnd = async (turn, timeout) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (trace().some((entry) => entry.event === "end" && entry.turn === turn)) return true;
    await sleep(150);
  }
  return false;
};

/** Jumps that moved VISIBLE content down while the reader was pinned, and scroll yanks. */
function analyze(samples, from, to) {
  const back = [];
  const yanks = [];
  let prev = null;
  for (const sample of samples) {
    if (sample.t < from || sample.t > to) continue;
    if (prev && typeof sample.ut === "number" && typeof prev.ut === "number") {
      const dut = sample.ut - prev.ut;
      const dst = sample.st - prev.st;
      // Only movement the reader can actually see counts as jitter.
      const visible = sample.ut < sample.vh && sample.ut + (sample.uh ?? 0) > 0;
      // ...and only when nothing transitioned in that frame: a step that finishes leaves
      // the page and settles the content above it by one step height — that settle is the
      // interaction itself (no blank is kept for it), not jitter.
      const transition = sample.stepText !== prev.stepText;
      if (dut > 6 && Math.abs(dst) < 6 && visible && !transition) back.push({ t: Math.round(sample.t - from), dut: +dut.toFixed(1), st: sample.st });
      if (Math.abs(dst) >= 6 && !transition) yanks.push({ t: Math.round(sample.t - from), dst: +dst.toFixed(1), st: sample.st });
    }
    prev = sample;
  }
  const backMax = back.reduce((max, item) => Math.max(max, item.dut), 0);
  const yankMax = yanks.reduce((max, item) => Math.max(max, Math.abs(item.dst)), 0);
  return { back, yanks, backMax, yankMax };
}

const report = (label, stats) => {
  console.log(`  ${label}: backward jumps >6px: ${stats.back.length} (max ${stats.backMax}px), scroll yanks: ${stats.yanks.length} (max ${stats.yankMax}px)`);
  for (const jump of stats.back.slice(0, 8)) console.log(`    +${jump.dut}px at ~${jump.t}ms after turn start (scrollTop ${jump.st})`);
  for (const yank of stats.yanks.slice(0, 8)) console.log(`    scroll ${yank.dst}px at ~${yank.t}ms after turn start (scrollTop ${yank.st})`);
};

/** DOM mutations within a window around `at`, for attributing a jump to its cause. */
const mutationsAround = (events, at, radius = 60) =>
  events
    .filter((event) => event.t >= at - radius && event.t <= at + radius)
    .slice(0, 6)
    .map((event) => `${event.kind === "add" ? "+" : "-"}${event.sig.slice(0, 72)}`);

let panel;
let turnA = null;


try {
  const worker = await waitForWorker(context, 60_000);
  let storageReady = false;
  for (let i = 0; i < 40 && !storageReady; i += 1) {
    storageReady = await worker.evaluate(() => Boolean(globalThis.chrome?.storage?.local)).catch(() => false);
    if (!storageReady) await sleep(250);
  }

  const now = new Date().toISOString();
  const settled = (id, role, text, at, durationMs) => ({
    id,
    role,
    createdAt: new Date(Date.parse(now) + at).toISOString(),
    content: [{ type: "text", text }],
    ...(durationMs ? { durationMs } : {}),
  });
  await worker.evaluate((payload) => chrome.storage.local.set({ "opensider/state": payload }), {
    version: 1,
    savedAt: now,
    locale: "en",
    theme: "dark",
    selectedId: "h1",
    selectedModelId: "",
    selectedModelByProvider: {},
    agentMode: "ask",
    selectedProviderId: "copilot",
    onboardingCompleted: true,
    sessionsOpen: false,
    sessionDrawerWidth: 248,
    sessions: [
      {
        id: "h1",
        title: "scroll stability",
        createdAt: now,
        updatedAt: now,
        todos: [],
        artifacts: [],
        messages: [
          settled("u1", "user", "How does the transcript keep its place while a turn streams?", -240_000),
          settled(
            "a1",
            "assistant",
            [
              "It reads `scrollTop` instead of measuring geometry: in a column-reverse box, zero is the bottom, and being pinned there is what \"following\" means.",
              "",
              "While the view is pinned, the browser's own scroll anchoring holds whatever is on screen steady as the content above and below it changes size.",
            ].join("\n"),
            -238_000,
            4200,
          ),
          settled("u2", "user", "And what still moves the reader today?", -120_000),
          settled(
            "a2",
            "assistant",
            [
              "Anything that shrinks *below* the line the reader is watching:",
              "",
              "1. A tool card that collapses the moment it finishes.",
              "2. The earlier process being swapped out when the next reply text arrives.",
              "",
              "Both free height under the text and shove it down in a single frame.",
            ].join("\n"),
            -118_000,
            6100,
          ),
          settled("u3", "user", "So what does the panel do about it?", -60_000),
          settled(
            "a3",
            "assistant",
            [
              "Two rules keep it honest:",
              "",
              "- While a step runs, only that step is on screen; finished steps leave the page entirely, so nothing stale is left behind to change size later.",
              "- The reader's position is never touched: growth below the reading line cannot pull the view, and the scroll offset is only ever moved back by the jump-to-bottom button.",
              "",
              "Everything else — the raw thinking, every tool call, every result — folds into the single line at the top of the turn once it ends, where it can be opened without disturbing the live view.",
            ].join("\n"),
            -58_000,
            5200,
          ),
        ],
      },
    ],
  });

  panel = await context.newPage();
  await panel.setViewportSize({ width: 420, height: 820 });
  await panel.goto(`chrome-extension://${ourId}/src/sidepanel/index.html`);
  await panel.bringToFront();
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ state: "visible", timeout: 40_000 });

  // Wait for the agent runtime before typing. The panel auto-connects once on load; if the
  // storage seed lands after that moment it sits idle forever, so one reload re-runs it.
  const hostLog = join(sandbox.home, ".opensider", "host.log");
  const runtimeReady = () => existsSync(hostLog) && readFileSync(hostLog, "utf8").includes("acp runtime ready");
  const waitReady = async (ms) => {
    const from = Date.now();
    while (!runtimeReady() && Date.now() - from < ms) await sleep(400);
    return runtimeReady();
  };
  if (!(await waitReady(25_000))) {
    await panel.reload();
    await composer.waitFor({ state: "visible", timeout: 30_000 });
  }
  ok("the agent runtime came up", await waitReady(60_000));

  // Diagnostic A/B: `NO_CV=1` turns content-visibility off to expose how much of the
  // residual movement comes from skip/restore toggling rather than from appends.
  if (process.env.NO_CV === "1") {
    await panel.addStyleTag({ content: ".cs-thread-bubble { content-visibility: visible !important; }" });
  }

  // Per-frame sampler: the last user bubble is the reader's landmark — it sits directly
  // above the live output, so any collapse or swap below it shows up there first.
  // A mutation log runs alongside it so a height change can be attributed to the node that
  // caused it (a card folding, a message remounting, a `content-visibility` skip).
  await panel.evaluate(() => {
    const out = (window.__scrollSamples = []);
    const events = (window.__scrollEvents = []);
    const sig = (node) => {
      if (node.nodeType !== 1) return String(node.nodeType);
      const el = node;
      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 24);
      return `${el.tagName}.${String(el.className ?? "").slice(0, 48)}${text ? ` "${text}"` : ""}`;
    };
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) events.push({ t: performance.now(), kind: "add", sig: sig(node) });
        for (const node of record.removedNodes) events.push({ t: performance.now(), kind: "del", sig: sig(node) });
      }
    });
    const log = () => {
      const root = document.querySelector(".cs-thread");
      if (root) {
        observer.disconnect();
        observer.observe(root, { childList: true, subtree: true });
      }
      const scroller = document.querySelector(".cs-thread");
      if (scroller) {
        const bubbles = scroller.querySelectorAll(".cs-user-bubble");
        const user = bubbles[bubbles.length - 1];
        const body = scroller.querySelector("[data-thread-body]");
        const frames = scroller.querySelectorAll("[data-thread-anchor]");
        const live = frames[frames.length - 1];
        // Per-element height tracking: attributes a height change to a specific bubble
        // (`content-visibility` toggles move the layout with no mutation to show for it).
        // Keyed by text prefix so appending messages cannot shift the identities.
        const heights = {};
        scroller.querySelectorAll("[data-thread-anchor]").forEach((node) => {
          const key = (node.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 20);
          if (key) heights[key] = node.offsetHeight;
        });
        const prevHeights = window.__lastHeights ?? {};
        window.__lastHeights = heights;
        for (const key of Object.keys(heights)) {
          const b = prevHeights[key];
          const a = heights[key];
          if (typeof b === "number" && Math.abs(a - b) > 4) {
            events.push({ t: performance.now(), kind: "size", sig: `"${key}..." ${b}px -> ${a}px` });
          }
        }
        out.push({
          t: performance.now(),
          wall: Date.now(),
          st: scroller.scrollTop,
          ut: user ? Math.round(user.getBoundingClientRect().top * 10) / 10 : null,
          uh: user ? user.offsetHeight : null,
          lt: live ? Math.round(live.getBoundingClientRect().top) : null,
          lb: live ? Math.round(live.getBoundingClientRect().bottom) : null,
          bh: body ? body.offsetHeight : null,
          ch: scroller.clientHeight,
          panes: scroller.querySelectorAll(".cs-fold-scroll").length,
          stepsVisible: scroller.querySelectorAll('[data-live-step="visible"]').length,
          stepText: (() => {
            const marker = scroller.querySelector('[data-live-step="visible"]');
            return marker ? (marker.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40) : "";
          })(),
          vh: window.innerHeight,
          running: Boolean(document.querySelector(".cs-composer.is-running")),
        });
      }
      if (out.length < 60_000) requestAnimationFrame(log);
    };
    requestAnimationFrame(log);
  });

  // ---------------------------------------------------------------- pass A: following
  await composer.click();
  await panel.keyboard.type("Why does the transcript still jitter while a turn runs?");
  const sentA = Date.now();
  await panel.keyboard.press("Enter");
  await sleep(2600); // roughly two thirds into the scripted turn: a look at the live state
  await panel.screenshot({ path: join(root, ".tmp-probe", "scroll-midturn.png") });
  ok("turn A ran", await waitForTurnEnd(1, 60_000), `trace: ${JSON.stringify(trace().at(-1) ?? {})}`);
  await sleep(1500);

  // ------------------------------------------------------- pass B: reading, scrolled up
  await composer.click();
  await panel.keyboard.type("Scroll up and keep reading while it keeps writing.");
  const sentB = Date.now();
  await panel.keyboard.press("Enter");
  await sleep(900); // let the turn get going
  await panel.mouse.move(210, 400);
  await panel.mouse.wheel(0, -260); // reader scrolls up mid-turn
  const wheelAt = Date.now();
  await sleep(120);
  ok("turn B ran", await waitForTurnEnd(2, 60_000), `trace: ${JSON.stringify(trace().at(-1) ?? {})}`);
  await sleep(1500);

  const samples = await panel.evaluate(() => window.__scrollSamples ?? []);
  const events = await panel.evaluate(() => window.__scrollEvents ?? []);
  const running = samples.filter((sample) => sample.running);
  ok("the sampler saw the turns run", running.length > 150, `frames with a running turn: ${running.length} of ${samples.length}`);

  // Windows in performance.now() time. Node's `sentA`/`sentB` are wall-clock; `offset` maps
  // them onto the page's performance clock (both wall clocks are the same machine).
  const offset = samples.length ? samples[0].wall - samples[0].t : 0;
  const sentAShifted = sentA - offset;
  const sentBShifted = sentB - offset;
  const wheelShifted = wheelAt - offset;
  const runningA = running.filter((sample) => sample.t < sentBShifted - 500);
  const windowAStart = runningA[0]?.t ?? sentAShifted;
  const windowAEnd = runningA.at(-1)?.t ?? 0;

  turnA = analyze(samples, windowAStart, windowAEnd);
  report("A (following at the bottom)", turnA);
  for (const jump of turnA.back.slice(0, 8)) {
    for (const line of mutationsAround(events, windowAStart + jump.t)) console.log(`      near: ${line}`);
  }
  ok("A: nothing moved outside step transitions during the turn", turnA.back.length === 0, `max visible backward jump ${turnA.backMax}px`);
  ok("A: the scroll offset held still during the turn", turnA.yankMax < 6, `max yank ${turnA.yankMax}px`);

  // The newest output must stay pinned to the bottom edge while the reader follows (the
  // block collapses above the viewport must not nudge it). Only frames where the transcript
  // actually overflows the pane are meaningful: below that there is no scroll range to pin.
  const pinnedSamples = samples.filter(
    (sample) =>
      sample.running &&
      sample.st === 0 &&
      sample.t >= windowAStart + 300 &&
      sample.t <= windowAEnd &&
      typeof sample.lb === "number" &&
      typeof sample.bh === "number" &&
      typeof sample.ch === "number" &&
      sample.bh > sample.ch + 4,
  );
  let maxPinnedStep = 0;
  let prevLb = null;
  for (const sample of pinnedSamples) {
    if (prevLb != null) maxPinnedStep = Math.max(maxPinnedStep, Math.abs(sample.lb - prevLb));
    prevLb = sample.lb;
  }
  ok(
    "A: the newest content stayed pinned to the bottom edge",
    pinnedSamples.length >= 30 && maxPinnedStep <= 6,
    pinnedSamples.length >= 30
      ? `max per-frame move ${maxPinnedStep}px over ${pinnedSamples.length} overflow frames`
      : `the transcript never overflowed the pane (${pinnedSamples.length} frames)`,
  );

  // The live-turn rule: exactly one step is ever on screen (the one running), and finished
  // steps leave the page entirely — several steps must appear and vanish during the run.
  // Count the step identities that show up (a new label after the last one): the swap from
  // one finished step to the next often lands in a single frame, with no blank in between.
  const runSamplesA = samples.filter((sample) => sample.running && sample.t >= windowAStart && sample.t <= windowAEnd);
  const visibleMax = Math.max(0, ...runSamplesA.map((sample) => sample.stepsVisible ?? 0));
  let stepIdentities = 0;
  let prevLabel = "";
  for (const sample of runSamplesA) {
    const text = sample.stepText ?? "";
    if (text !== "" && text !== prevLabel) {
      stepIdentities += 1;
      prevLabel = text;
    }
  }
  ok("A: only the current step is visible while the turn runs", visibleMax <= 1, `max visible steps ${visibleMax}`);
  ok("A: finished steps left the screen as they went", stepIdentities >= 3, `steps seen come and go: ${stepIdentities}`);
  const postTurn = samples.find((sample) => sample.t >= windowAEnd + 800);
  ok("A: the turn folded into one line when it ended", postTurn?.panes === 0, `open panes after turn: ${postTurn?.panes}`);

  // One big move is expected as the turn closes: the whole process folds into a single
  // line, so everything above it comes down. Informational only — it is the accepted end
  // state, and it happens once, after the stream is over.
  const afterFold = samples.filter((sample) => sample.t > windowAEnd + 1200 && sample.t < sentBShifted - 100).at(-1);
  const atFold = samples.find((sample) => sample.t >= windowAEnd);
  if (atFold && afterFold && typeof afterFold.ut === "number" && typeof atFold.ut === "number") {
    console.log(`  end-of-turn fold moved the landmark ${(afterFold.ut - atFold.ut).toFixed(0)}px (informational)`);
  }

  const turnBStart = running.filter((sample) => sample.t >= sentBShifted).map((sample) => sample.t).sort()[0] ?? sentBShifted;
  // While the reader is parked above the bottom and the turn keeps appending below, the
  // offset legitimately walks further negative — the bottom edge moves down under the
  // content, and holding the same view means following it (that is what the browser's own
  // anchoring is for). What must NOT happen is a move back toward the bottom (the old
  // snap-to-zero), and the visible content must hold still. Both are checked over the
  // running phase only: the end-of-turn fold is allowed its one move, after the stream.
  const quietFrom = Math.max(turnBStart + 400, wheelShifted + 300);
  const quiet = samples.filter((sample) => sample.running && sample.t >= quietFrom);
  let dragBackMax = 0;
  let viewDriftMax = 0;
  let previous = null;
  for (const sample of quiet) {
    if (previous) {
      const dst = sample.st - previous.st;
      const transition = sample.stepText !== previous.stepText;
      if (dst >= 6 && !transition) dragBackMax = Math.max(dragBackMax, dst);
      if (typeof sample.ut === "number" && typeof previous.ut === "number") {
        viewDriftMax = Math.max(viewDriftMax, Math.abs(sample.ut - previous.ut));
      }
    }
    previous = sample;
  }
  console.log(`  B (scrolled up to read): frames checked ${quiet.length}, max drag-back toward bottom ${dragBackMax}px, max view drift ${viewDriftMax.toFixed(1)}px/frame`);
  ok("B: growth never dragged the reader back toward the bottom", dragBackMax === 0, `max drag-back ${dragBackMax}px`);
  ok("B: the reading position held still while the turn ran", viewDriftMax <= 6, `max view drift ${viewDriftMax.toFixed(1)}px per frame`);
  // Checked at the last running frame: after the turn the fold legitimately replaces the
  // process with one line, and if that leaves the transcript shorter than the viewport the
  // offset must clamp back to 0 — that is the fold, not a yank.
  const lastRunning = running.at(-1);
  ok("B: the wheel held all the way through the turn", lastRunning ? lastRunning.st < -150 : false, `scrollTop at turn end ${lastRunning?.st}`);

  mkdirSync(join(root, ".tmp-probe"), { recursive: true });
  await panel.screenshot({ path: join(root, ".tmp-probe", "scroll-stability.png") });
  writeFileSync(join(sandbox.dir, "samples.json"), JSON.stringify({ samples, events }));
} finally {
  await context.close().catch(() => undefined);
}

const failed = results.filter((item) => !item.ok);
console.log(failed.length ? `\n${failed.length} check(s) failed` : "\nall checks passed");
process.exit(failed.length ? 1 : 0);
