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
// Turn N streams "T<N>.<i> " for i = 0..chunks-1 and then ends with stopReason
// end_turn, or with cancelled when the host asked us to stop.
import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const chunks = Number(process.env.FAKE_ACP_CHUNKS ?? 20);
const chunkMs = Number(process.env.FAKE_ACP_CHUNK_MS ?? 300);
const ignoreCancelMs = Number(process.env.FAKE_ACP_IGNORE_CANCEL_MS ?? 0);
const tracePath = process.env.FAKE_ACP_TRACE ?? "";

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

async function runPrompt(id, text) {
  turn += 1;
  const label = turn;
  cancelledAt = 0;
  trace({ event: "prompt", turn: label, text: text.slice(0, 200), sessionId });
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
    reply(id, { sessionId, configOptions: [], models: null });
    return;
  }
  if (method === "session/load" || method === "session/fork") {
    sessionId = params?.sessionId || sessionId || `fake-${Date.now().toString(36)}`;
    reply(id, { sessionId, configOptions: [], models: null });
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
