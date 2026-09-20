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
//
// Session config options beyond mode/model (used by scripts/verify-agent-modes.mjs):
//   FAKE_OPTIONS=claude        `effort [thought_level]` select (default/low/medium/high/max)
//                              + `fast [model_config]` boolean — Claude 0.73.0's shape.
//   FAKE_OPTIONS=cursor        `fast [model_config]` select (false=Off / true=Fast) —
//                              Cursor's shape; no thought_level at all.
//   FAKE_OPTIONS=unknown       a category we do not render (`mystery`) — proves the host
//                              still forwards it and the panel quietly ignores it.
//   FAKE_OPTIONS=none | unset  Advertise nothing (Copilot / OpenCode today).
//
// Selection-toolbar prompts (used by scripts/verify-selection.mjs). The fake agent answers
// the two hidden-channel prompts deterministically so a test can assert the result text,
// and traces which session each one ran on (the whole point: it must NOT be the chat's):
//   - a prompt starting with "Translate the text below into" -> "[translated] <text>"
//   - a prompt starting with "Search the web for the query below" -> a small Markdown block
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const chunks = Number(process.env.FAKE_ACP_CHUNKS ?? 20);
const chunkMs = Number(process.env.FAKE_ACP_CHUNK_MS ?? 300);
const ignoreCancelMs = Number(process.env.FAKE_ACP_IGNORE_CANCEL_MS ?? 0);
const tracePath = process.env.FAKE_ACP_TRACE ?? "";
// 默认只 trace 前 200 字符（够看开头）；要断言整段提示词时设 FAKE_ACP_TRACE_FULL=1。
const traceFull = process.env.FAKE_ACP_TRACE_FULL === "1";
const modesShape = process.env.FAKE_MODES ?? "none";
const modeUrlIds = process.env.FAKE_MODE_URL_IDS === "1";
const modeSwitchOnPrompt = process.env.FAKE_MODE_SWITCH_ON_PROMPT ?? "";
const optionsShape = process.env.FAKE_OPTIONS ?? "none";

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
// 工具调用开始。搜索的真实形态是「先说一段我先去搜一下 → 调工具 → 才给结论」，Host 那边
// 就靠这条更新把前面的过程叙述作废（见 internal/host 的 absorbSelectionUpdate），所以
// 这里必须真的演出来，否则那条逻辑在测试里永远跑不到。
const toolCall = (title) =>
  write({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: `call-${turn}`,
        title,
        kind: "fetch",
        status: "in_progress",
      },
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

// 当前模式只有一个来源，两种广告形态都从它取值（both 形态下两边必须同步，否则真实
// 会话里会出现「configOptions 说 build、modes 说 plan」这种漂移）。
// config 形态的初值是 build（OpenCode 默认），其余形态是 agent（legacy 的初值）。
let currentMode = modesShape === "config" ? "build" : "agent";

// legacy `modes.availableModes`：Cursor 那一路。带 currentModeId + 每项 id/name/description。
let legacyModes =
  modesShape === "legacy" || modesShape === "both"
    ? {
        currentModeId: withUrlId("agent"),
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
      currentValue: currentMode,
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
  result.configOptions = configOptions();
  if (legacyModes) result.modes = legacyModes;
  return result;
}

// ------------------------------------------------------------------ config options
// mode / model 之外的会话配置项。初值取自真机 probe：Claude 的 effort 是 xhigh、fast 是
// false；Cursor 的 fast 是字符串 "false"（select，不是 boolean）。断言这些初值能让测试
// 发现「广告被吞掉了」这类问题。
let thoughtLevel = "xhigh";
let fastBoolean = false;
let fastSelect = "false";
let mysteryValue = "a";

// extraConfigOptions 只说真话：形态决定了这家广告什么，别家没有的项一律不出现。
function extraConfigOptions() {
  if (optionsShape === "claude") {
    return [
      {
        id: "effort",
        name: "Effort",
        category: "thought_level",
        type: "select",
        currentValue: thoughtLevel,
        options: [
          { value: "default", name: "Default" },
          { value: "low", name: "Low" },
          { value: "medium", name: "Medium" },
          { value: "high", name: "High" },
          { value: "xhigh", name: "Xhigh" },
          { value: "max", name: "Max" },
        ],
      },
      {
        id: "fast",
        name: "Fast mode",
        category: "model_config",
        type: "boolean",
        currentValue: fastBoolean,
      },
    ];
  }
  if (optionsShape === "cursor") {
    return [
      {
        id: "fast",
        name: "Fast",
        category: "model_config",
        type: "select",
        currentValue: fastSelect,
        options: [
          { value: "false", name: "Off" },
          { value: "true", name: "Fast" },
        ],
      },
    ];
  }
  if (optionsShape === "unknown") {
    return [
      {
        id: "mystery",
        name: "Mystery",
        category: "mystery",
        type: "select",
        currentValue: mysteryValue,
        options: [
          { value: "a", name: "A" },
          { value: "b", name: "B" },
        ],
      },
    ];
  }
  return [];
}

// 规范说设置成功后要回**完整**的 configOptions，这里照做（Host 就以它为准）。
function configOptions() {
  const option = modeConfigOption();
  return [...(option ? [option] : []), ...extraConfigOptions()];
}

// 设置必须真的改状态，否则「设了没生效」这种问题在测试里看不出来。
function setExtraOption(configId, value, type) {
  if (optionsShape === "claude" && configId === "effort") thoughtLevel = String(value);
  else if (optionsShape === "claude" && configId === "fast") fastBoolean = value === true || value === "true";
  else if (optionsShape === "cursor" && configId === "fast") fastSelect = String(value);
  else if (optionsShape === "unknown" && configId === "mystery") mysteryValue = String(value);
  else if (!extraConfigOptions().some((item) => item.id === configId)) return false;
  trace({ event: "set_extra_option", configId, value, type: type ?? "" });
  return true;
}

// current_mode_update 必须把两边（legacy currentModeId + config currentValue）一起改，
// 保证 both 形态下两个来源不会漂移。
function setCurrentMode(id) {
  currentMode = id;
  if (legacyModes) legacyModes.currentModeId = id;
}

// ------------------------------------------------------------- selection prompts
// 划词工具条的隐藏通道发来的两种提示词。识别前缀就够了：文案在 internal/selection 里
// 定稿，这里只需要能把「翻译 / 搜索」与普通聊天分开。
const TRANSLATE_PREFIX = "Translate the text below into";
const SEARCH_PREFIX = "Search the web for the query below";
// fixture 里那行触发「长回答」的标记（见 scripts/verify-selection-ui.mjs）。
const SEARCH_TALL_MARK = "长内容";

function selectionKind(text) {
  const trimmed = text.trimStart();
  if (trimmed.startsWith(TRANSLATE_PREFIX)) return "translate";
  if (trimmed.startsWith(SEARCH_PREFIX)) return "search";
  return "";
}

/** 提示词最后一段就是用户选中的原文（见 internal/selection 的拼装）。 */
function selectionInput(text) {
  const parts = text.split("\n\n");
  const tail = parts[parts.length - 1] ?? "";
  return tail.replace(/^Query:\s*/, "").trim();
}

function selectionReply(kind, input) {
  if (kind === "translate") return `[translated] ${input}`;
  // 专门用来把结果层撑高的长回答（fixture 里那行「长内容」），验高度上限与内部滚动。
  if (kind === "search" && input.includes(SEARCH_TALL_MARK)) {
    const sections = [];
    for (let index = 1; index <= 15; index += 1) {
      sections.push(`### 第 ${index} 节\n\n${"这一段用来把结果层撑高，看它能不能长到该有的高度。".repeat(4)}`);
    }
    return [
      "## Summary",
      `- searched for: ${input}`,
      "",
      sections.join("\n\n"),
      "",
      "**Sources**",
      "- [example](https://example.com/source)",
    ].join("\n");
  }
  return [
    "## Summary",
    `- searched for: ${input}`,
    "",
    "**Sources**",
    "- [example](https://example.com/source)",
  ].join("\n");
}

/** 按小块流式吐出固定回复，好让「增量、取消」这两条路都能被测到。 */
async function streamSelectionReply(id, kind, input) {
  if (kind === "search") {
    // 过程叙述：不该出现在结果层里（只该看到工具调用之后的结论）。
    for (const piece of ["I'll search the web for ", input, " and summarise it."]) {
      chunk(piece);
      await sleep(20);
    }
    toolCall(`search: ${input}`);
    await sleep(20);
  }
  const replyText = selectionReply(kind, input);
  const size = 12;
  for (let at = 0; at < replyText.length; at += size) {
    if (cancelledAt) {
      trace({ event: "end", turn, stopReason: "cancelled", sessionId });
      reply(id, { stopReason: "cancelled" });
      return;
    }
    chunk(replyText.slice(at, at + size));
    await sleep(30);
  }
  trace({ event: "end", turn, stopReason: "end_turn", sessionId });
  reply(id, { stopReason: "end_turn" });
}

async function runPrompt(id, text) {
  turn += 1;
  const label = turn;
  cancelledAt = 0;
	  const kind = selectionKind(text);
	  if (kind) {
	  	// 隐藏通道：记一笔它在哪个会话上跑（这条正是「不进当前会话」的判据）。
	  	// 隐藏通道：记一笔它在哪个会话上跑（这条正是「不进当前会话」的判据）。
	// text 是提取出来的查询尾段；prompt 是提示词开头——答案语言那句写在前面。
	trace({
		event: "selection_prompt",
		kind,
		sessionId,
		text: selectionInput(text).slice(0, 120),
		prompt: text.slice(0, 200),
	});
	  	await streamSelectionReply(id, kind, selectionInput(text));
	  	return;
	  }
	  trace({ event: "prompt", turn: label, text: traceFull ? text : text.slice(0, 200), sessionId });
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
    setExtraOption(params?.configId, params?.value, params?.type);
    // type 也 trace：布尔项必须带 "boolean"，那是规范要求、也是这条链上最容易漏的一环。
    trace({
      event: "set_config_option",
      configId: params?.configId,
      value: params?.value,
      type: params?.type ?? "",
    });
    reply(id, { configOptions: configOptions() });
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
