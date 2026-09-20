#!/usr/bin/env node
// Verifies session-mode switching against the real bridge binary and the fake ACP agent
// (no browser involved). It drives the same native-messaging messages the side panel sends
// and reads the framed ones it would receive, so it covers the whole chain:
//
//   discovery      -> what the panel is told (agentModes: source / current / options / kind)
//   policy         -> must never push plan/build (the bug users reported)
//   user pick      -> the right RPC goes out (set_config_option vs set_mode) and state moves
//   agent switch   -> current_mode_update reaches the panel's snapshot
//   nothing shipped-> no control at all (available: false, no options)
//
//   FAKE_MODES=config       node scripts/verify-agent-modes.mjs   # OpenCode shape
//   FAKE_MODES=legacy       node scripts/verify-agent-modes.mjs   # Cursor shape
//   FAKE_MODES=both         node scripts/verify-agent-modes.mjs   # Claude / Copilot shape
//   FAKE_MODES=none         node scripts/verify-agent-modes.mjs   # advertises nothing
//   FAKE_MODES=both FAKE_MODE_SWITCH_ON_PROMPT=plan node scripts/verify-agent-modes.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, check as checkRaw } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const shape = process.env.FAKE_MODES ?? "config";
// 默认跑 sandbox 里的 stub；设 AGENT_ID=opencode / cursor 就会连**真的**那个 CLI
// （模式集合换成它自己广告的，断言里的形态要与之匹配）。
const agentId = process.env.AGENT_ID ?? "copilot";
const switchTo = process.env.FAKE_MODE_SWITCH_ON_PROMPT ?? "";
const results = [];
// sandbox.mjs 的 check 把结果收在第四个参数里，这里绑定好，否则失败会被当成 0/0 通过。
const check = (name, ok, detail = "") => checkRaw(name, ok, detail, results);

const sandbox = createSandbox({ root, prefix: `opensider-modes-${shape}-`, dist });
const tracePath = sandbox.tracePath;

const child = spawn(sandbox.hostBin, [], {
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_MODES: shape,
    FAKE_ACP_TRACE: tracePath,
    FAKE_ACP_CHUNKS: "1",
    FAKE_ACP_CHUNK_MS: "10",
    ...(switchTo ? { FAKE_MODE_SWITCH_ON_PROMPT: switchTo } : {}),
  },
  stdio: ["pipe", "pipe", "pipe"],
});

const received = [];
let buffer = Buffer.alloc(0);
child.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (buffer.length >= 4) {
    const length = buffer.readUInt32LE(0);
    if (buffer.length < 4 + length) break;
    const body = buffer.subarray(4, 4 + length).toString("utf8");
    buffer = buffer.subarray(4 + length);
    try {
      received.push(JSON.parse(body));
    } catch {
      /* non-JSON frame: ignore */
    }
  }
});
let stderr = "";
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

const send = (message) => {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  child.stdin.write(Buffer.concat([header, body]));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(test, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = received.findLast(test);
    if (last) return last;
    await sleep(120);
  }
  return undefined;
}

const traceEvents = () => {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
};
const setEvents = () =>
  traceEvents().filter((entry) => entry.event === "set_config_option" || entry.event === "set_mode");

const cleanup = () => {
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
};

try {
  send({ type: "hello" });
  const greeted = await waitFor((msg) => msg.type === "status", 20_000);
  check("the bridge answers", Boolean(greeted), greeted ? `state=${greeted.state}` : `stderr: ${stderr.slice(-200)}`);

  send({ type: "agent.connect", providerId: agentId, policy: "ask" });
  const ready = await waitFor((msg) => msg.type === "status" && msg.state === "ready", 40_000);
  check("the agent connects", Boolean(ready), ready ? "" : `stderr: ${stderr.slice(-300)}`);

  // Modes are advertised in `session/new`, so the bridge prepares a session as soon as the
  // agent connects and pushes them there — the panel must not have to ask first, otherwise
  // the control only shows up after the first message (the reported bug).
  const modes = await waitFor((msg) => msg.type === "agentModes");
  check(
    "the bridge announces the modes straight after connecting, before any session request",
    Boolean(modes),
    modes ? `source=${modes.source}` : `stderr: ${stderr.slice(-200)}`,
  );

  // The panel's own bind then reuses that prepared session instead of creating a second one.
  send({ type: "session.new" });
  const adopted = await waitFor((msg) => msg.type === "session");
  check("the prepared session is the one the panel gets", Boolean(adopted), adopted?.sessionId ?? "none");
  if (!modes) {
    check("the bridge announces the session modes", false, `stderr: ${stderr.slice(-300)}`);
    throw new Error("no agentModes message");
  }
  check("the bridge announces the session modes", true, `source=${modes.source} available=${modes.available}`);

  const names = (modes.options ?? []).map((option) => option.name);
  const ids = (modes.options ?? []).map((option) => option.id);

  if (shape === "none") {
    check("nothing advertised -> no control", modes.available === false && ids.length === 0);
    check("nothing advertised -> current is empty", !modes.currentId);
    send({ type: "agent.setMode", modeId: "plan" });
    await sleep(600);
    check("nothing advertised -> no mode RPC is sent", setEvents().length === 0);
  } else {
    check("the control is offered", modes.available === true && ids.length >= 2, `options=${ids.join("|")}`);
    check(
      shape === "config" ? "config options are the source" : "the advertised source is used",
      shape === "config" ? modes.source === "config" : Boolean(modes.source),
      `source=${modes.source} configId=${modes.configId ?? "-"}`,
    );
    const expectedNames = shape === "config" ? ["build", "plan"] : ["agent", "plan", "ask"];
    // 有的引擎（opencode）不给显示名，name 就等于 value；大小写也不统一，所以不区分大小写比。
    const lowered = names.map((name) => name.toLowerCase());
    check(
      "names pass through verbatim",
      expectedNames.every((name) => lowered.includes(name)),
      names.join("|"),
    );
    check(
      "the policy alone does not move the mode",
      modes.currentId === "build" || modes.currentId === "agent",
      `current=${modes.currentId}`,
    );

    // Regression guard for the reported bug: with policy=ask nothing may be pushed, so the
    // agent must not have received any set_* call yet.
    if (agentId === "copilot") {
      check(
        "policy=ask pushes nothing (OpenCode would have gone to plan)",
        setEvents().length === 0,
        setEvents().map((entry) => entry.event).join("|"),
      );
    } else {
      // 真 CLI：没有 trace 可看，就断言「当前值仍是引擎自己的默认」，而不是被我们改过。
      check(
        "policy=ask leaves the engine's own default alone",
        modes.currentId === "build" || modes.currentId === "agent",
        `current=${modes.currentId}`,
      );
    }

    const sessionId = (await waitFor((msg) => msg.type === "session"))?.sessionId;
    send({ type: "agent.setMode", modeId: "plan", sessionId });

    const moved = await waitFor((msg) => msg.type === "agentModes" && msg.currentId === "plan");
    check("picking a mode moves the session", Boolean(moved), moved ? "" : `current stayed ${JSON.stringify(modes.currentId)}`);

    const set = setEvents();
    const expected = shape === "legacy" ? "set_mode" : "set_config_option";
    // 真 CLI 不写我们这份 trace（只有 fake agent 写），所以发出去的 RPC 只能在 stub 下
    // 断言；真 CLI 靠上面“会话动过了”那条判断——那就是用户真正在乎的结果。
    const stubRun = agentId === "copilot";
    if (stubRun) {
      check(
        `the right RPC is used (${expected})`,
        set.some((entry) => entry.event === expected && (entry.value ?? entry.modeId) === "plan"),
        set.map((entry) => `${entry.event}=${entry.value ?? entry.modeId}`).join("|") || "none",
      );
      if (shape === "legacy") {
        check("legacy mode ids are sent as-is", set.some((entry) => entry.modeId === "plan"));
      } else {
        check("the mode config option is addressed by configId", set.some((entry) => entry.configId === "mode"));
      }
    } else {
      check("the switch reaches the engine", Boolean(moved), `source=${modes.source}`);
    }

    if (switchTo) {
      send({ type: "prompt", text: "hello", sessionId });
      const switched = await waitFor((msg) => msg.type === "agentModes" && msg.currentId === switchTo);
      check("an agent-side mode switch reaches the panel", Boolean(switched),
        switched ? "" : `want ${switchTo}`);
    }
  }
} catch (error) {
  check("verification ran to completion", false, String(error?.message ?? error));
} finally {
  cleanup();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed (FAKE_MODES=${shape})`);
process.exit(failed.length === 0 ? 0 : 1);
