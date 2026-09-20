#!/usr/bin/env node
// A minimal fake ACP agent, used by the queue "send now" end-to-end check
// (scripts/verify-queue-send-now.mjs). It speaks ACP over stdio (one JSON object
// per line) and streams a predictable amount of text so a test can tell turns
// apart and see an interrupt take effect.
//
// Env:
//   FAKE_ACP_CHUNKS            chunks streamed per turn (default 20)
//   FAKE_ACP_CHUNK_MS          delay between chunks in ms (default 300)
//   FAKE_ACP_IGNORE_CANCEL_MS  keep running this long after session/cancel (default 0)
//   FAKE_ACP_TRACE             append a JSON line per prompt/cancel/end to this file
//
// Agent-mode advertising (used by scripts/verify-agent-modes.mjs). These decide what
// `session/new|load|fork` advertises so one fake agent can stand in for the three real
// CLI shapes we measured. Field names are copied verbatim from those CLIs — do not rename.
//   FAKE_MODES=config          OpenCode 1.18.31: no `modes`, only a `configOptions` mode
//                              select (currentValue "build", options build/plan).
//   FAKE_MODES=legacy          Cursor: `modes.availableModes` (agent/plan/ask), no mode
//                              config option.
//   FAKE_MODES=both            Claude / Copilot: `modes` and the mode `configOptions` item
//                              are both present and kept in sync.
//   FAKE_MODES=none | unset    Advertise nothing (the pre-modes behaviour).
//   FAKE_MODE_URL_IDS=1        With FAKE_MODES=both, use Copilot-style URL ids for the
//                              modes (e.g. "https://…/mode/plan") to prove URL ids work.
//   FAKE_MODE_SWITCH_ON_PROMPT=<id>
//                              On the next prompt, push a `current_mode_update` moving
//                              `currentModeId` to <id> (the "Agent switched its own mode"
//                              path). Only fires once per prompt that carries text.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const chunks = Number(process.env.FAKE_ACP_CHUNKS ?? 20);
const chunkMs = Number(process.env.FAKE_ACP_CHUNK_MS ?? 300);
const ignoreCancelMs = Number(process.env.FAKE_ACP_IGNORE_CANCEL_MS ?? 0);
const tracePath = process.env.FAKE_ACP_TRACE ?? "";
const modesShape = process.env.FAKE_MODES ?? "none";
const modeUrlIds = process.env.FAKE_MODE_URL_IDS === "1";
const modeSwitchOnPrompt = process.env.FAKE_MODE_SWITCH_ON_PROMPT ?? "";

// The bridge also runs the CLI once as `<cli> models` before opening a session (see
// internal/models). Answering that here matters: without it the bridge waits out its own
// 20s timeout and only then falls back, which made every panel handshake in these tests
// take ~28s - right at the edge of the scripts' waits, so they failed at random.
if (process.argv.includes("models")) {
  process.stdout.write(
    ["auto - Auto (current)", "claude-sonnet-4 - Claude Sonnet 4", "gpt-5 - GPT-5"].join("\n") + "\n",
  );
  process.exit(0);
}

let sessionId = "";
let turn = 0;
let cancelledAt = 0;

const write = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const reply = (id, result) => write({ jsonrpc: "2.0", id, result });
const chunk = (text) =>
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
    },
  });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const trace = (entry) => {
  if (!tracePath) return;
  try {
    appendFileSync(tracePath, `${JSON.stringify({ at: Date.now(), ...entry })}\n`);
  } catch {
    // Tracing is best effort; never break the agent over it.
  }
};

// -------------------------------------------------------------------- agent modes
// modeConfigId 是 mode 配置项的 configId：既真实（OpenCode 用 "mode"），也让
// session/set_config_option 能按它命中并改状态。
const modeConfigId = "mode";
// URL 形式的 id 用来演 Copilot 那种把 mode 命名成一个 URL 的情况；只在 FAKE_MODE_URL_IDS 时用。
const withUrlId = (id) => (modeUrlIds ? `https://opensider.test/mode/${id}` : id);

// legacy `modes.availableModes`：Cursor 那一路。带 currentModeId + 每项 id/name/description。
let legacyModes =
  modesShape === "legacy" || modesShape === "both"
    ? {
        currentModeId: modesShape === "both" ? withUrlId("agent") : "agent",
        availableModes: [
          { id: withUrlId("agent"), name: "Agent", description: "Full agent, edits and runs freely." },
          { id: withUrlId("plan"), name: "Plan", description: "Read-only; drafts a plan before acting." },
          { id: withUrlId("ask"), name: "Ask", description: "Answers questions without touching files." },
        ],
      }
    : null;

// `configOptions` mode select：OpenCode（config）与 Claude/Copilot（both）那一路。
// currentValue 是当前选中值，options[].value 是可选值 —— Host 的 modeConfigID/advertisedModeIDs
// 就是读这些字段（见 internal/acp/mode.go），字段名务必逐字对齐。
function modeConfigOption() {
  if (modesShape === "config") {
    return {
      id: modeConfigId,
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: "build",
      options: [
        { value: "build", name: "Build", description: "Edits and runs freely." },
        { value: "plan", name: "Plan", description: "Read-only; drafts a plan first." },
      ],
    };
  }
  if (modesShape === "both") {
    // both：configOptions 的可选值必须与 legacy.availableModes 同步。
    return {
      id: modeConfigId,
      name: "Mode",
      category: "mode",
      type: "select",
      currentValue: legacyModes.currentModeId,
      options: legacyModes.availableModes.map((m) => ({
        value: m.id,
        name: m.name,
        description: m.description,
      })),
    };
  }
  return null;
}

// 组装一次 session/new|load|fork 的返回：按形态决定广告什么。
function sessionResult(sid) {
  const result = { sessionId: sid, models: null };
  const option = modeConfigOption();
  result.configOptions = option ? [option] : [];
  if (legacyModes) result.modes = legacyModes;
  return result;
}

// current_mode_update 需要把两边（legacy currentModeId + config currentValue）一起改，
// 保证 both 形态下两个来源不会漂移。
function setCurrentMode(id) {
  if (legacyModes) legacyModes.currentModeId = id;
}

async function runPrompt(id, text) {
  turn += 1;
  const label = turn;
  cancelledAt = 0;
  trace({ event: "prompt", turn: label, text: text.slice(0, 200), sessionId });
  // 「Agent 自己换模式」：收到带文本的 prompt 时主动推一条 current_mode_update。
  if (modeSwitchOnPrompt && text.trim()) {
    const target = modeUrlIds ? withUrlId(modeSwitchOnPrompt) : modeSwitchOnPrompt;
    setCurrentMode(target);
    write({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "current_mode_update", currentModeId: target },
      },
    });
    trace({ event: "current_mode_update", turn: label, currentModeId: target });
  }
  for (let i = 0; i < chunks; i += 1) {
    if (cancelledAt && Date.now() - cancelledAt >= ignoreCancelMs) {
      trace({ event: "end", turn: label, stopReason: "cancelled" });
      reply(id, { stopReason: "cancelled" });
      return;
    }
    chunk(`T${label}.${i} `);
    await sleep(chunkMs);
  }
  trace({ event: "end", turn: label, stopReason: "end_turn" });
  reply(id, { stopReason: "end_turn" });
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    reply(id, { protocolVersion: 1, agentCapabilities: {} });
    return;
  }
  if (method === "session/new") {
    sessionId = `fake-${Date.now().toString(36)}`;
    reply(id, sessionResult(sessionId));
    return;
  }
  if (method === "session/load" || method === "session/fork") {
    sessionId = params?.sessionId || sessionId || `fake-${Date.now().toString(36)}`;
    reply(id, sessionResult(sessionId));
    return;
  }
  if (method === "session/prompt") {
    const text = (params?.prompt ?? [])
      .map((block) => block?.text ?? "")
      .join("\n");
    // Reply later on purpose: the host must be able to cancel a turn that is in flight.
    void runPrompt(id, text);
    return;
  }
  if (method === "session/set_config_option") {
    // 真的改状态：configId=mode 时把当前值写进去，再按规范回完整的 configOptions 数组。
    if (params?.configId === modeConfigId && typeof params?.value === "string") {
      setCurrentMode(params.value);
    }
    const option = modeConfigOption();
    trace({ event: "set_config_option", configId: params?.configId, value: params?.value });
    reply(id, { configOptions: option ? [option] : [] });
    return;
  }
  if (method === "session/set_mode") {
    // 真的改 currentModeId，成功回 {}。
    if (typeof params?.modeId === "string") setCurrentMode(params.modeId);
    trace({ event: "set_mode", modeId: params?.modeId });
    reply(id, {});
    return;
  }
  if (method === "session/cancel") {
    if (!cancelledAt) cancelledAt = Date.now();
    trace({ event: "cancel", sessionId });
    return;
  }
  if (id !== undefined) reply(id, {});
}

createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      process.stderr.write(`fake-acp-agent: unparsable line\n`);
      return;
    }
    void handle(msg);
  })
  .on("close", () => process.exit(0));
