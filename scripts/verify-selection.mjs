#!/usr/bin/env node
// Verifies the hidden channel behind the selection toolbar against the real bridge binary
// and the fake ACP agent (no browser involved). It drives the same native-messaging frames
// the extension sends and reads the framed ones it would receive, so it covers:
//
//   translate/search -> a result comes back on the selection.* messages only
//   isolation        -> the utility prompt runs on its OWN ACP session, and nothing from it
//                       is broadcast to the extension (no `update`, no `turn.end`)
//   the chat is fine  -> chatting before and after a selection request still works, and the
//                       chat's own session never sees the selection prompt
//   guards           -> empty / oversized / unknown-mode requests never reach the CLI
//   cancel           -> cancelling stops that turn and the channel recovers
//
//   node scripts/verify-selection.mjs
//
// Prints one line per check and exits non-zero if any of them fails.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSandbox, check as checkRaw } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "packages", "extension", "dist");
const results = [];
const check = (name, ok, detail = "") => checkRaw(name, ok, detail, results);

const sandbox = createSandbox({ root, prefix: "opensider-selection-", dist });
const tracePath = sandbox.tracePath;

// 假引擎不广告模式与配置项：这个脚本关心的是隐藏通道，不是那两块。
const child = spawn(sandbox.hostBin, [], {
  env: {
    ...process.env,
    HOME: sandbox.home,
    FAKE_MODES: "none",
    FAKE_OPTIONS: "none",
    FAKE_ACP_TRACE: tracePath,
    FAKE_ACP_CHUNKS: "1",
    FAKE_ACP_CHUNK_MS: "10",
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
    await sleep(100);
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
const selectionPrompts = () => traceEvents().filter((entry) => entry.event === "selection_prompt");

/** 一次划词请求：发出去，等到终态，把期间扩展收到的东西都交出来。 */
async function runSelection({ mode, text, targetLang = "zh-CN", uiLocale = "zh", action = "wait", cancelAfterMs = 0 }) {
  const requestId = `sel-${Math.random().toString(36).slice(2, 8)}`;
  const from = received.length;
  send({ type: "selection.run", requestId, mode, text, targetLang, uiLocale, tabId: 42 });
  if (action === "cancel") {
    await sleep(cancelAfterMs);
    send({ type: "selection.cancel", requestId });
  }
  const terminal = await waitFor(
    (msg) => msg.requestId === requestId && (msg.type === "selection.done" || msg.type === "selection.failed"),
    action === "cancel" ? 4_000 : 25_000,
  );
  // 给迟到的那几条消息一点时间（取消后不该再有终态）。
  await sleep(400);
  return { requestId, terminal, messages: received.slice(from) };
}

const isolation = (messages, requestId) => {
  const leaks = messages.filter(
    (msg) => msg.type === "update" || msg.type === "turn.end" || msg.type === "session",
  );
  const selectionMessages = messages.filter((msg) => String(msg.type).startsWith("selection."));
  return {
    leaks: leaks.map((msg) => msg.type).join("|") || "none",
    kinds: selectionMessages.map((msg) => msg.type).join("|"),
    deltas: selectionMessages.filter((msg) => msg.type === "selection.delta").length,
    translated: selectionMessages.some((msg) => String(msg.text ?? "").includes("[translated]")),
    requestIdOk: selectionMessages.every((msg) => msg.requestId === requestId),
    tabIdOk: selectionMessages.every((msg) => msg.tabId === 42),
  };
};

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

  send({ type: "agent.connect", providerId: "copilot", policy: "ask" });
  const ready = await waitFor((msg) => msg.type === "status" && msg.state === "ready", 40_000);
  check("the agent connects", Boolean(ready), ready ? "" : `stderr: ${stderr.slice(-300)}`);

  // 先把聊天会话建起来：后面所有「没串到聊天里」的断言都以它的 id 为准。
  send({ type: "session.new" });
  const chat = await waitFor((msg) => msg.type === "session");
  const chatSessionId = chat?.sessionId ?? "";
  check("the chat session exists", Boolean(chatSessionId), chatSessionId || "none");

  // ---------------------------------------------------------------- 翻译
  const translate = await runSelection({ mode: "translate", text: "Hello world" });
  check(
    "translate comes back on the selection channel",
    translate.terminal?.type === "selection.done" && String(translate.terminal.text).includes("[translated] Hello world"),
    `${translate.terminal?.type ?? "none"}: ${String(translate.terminal?.text ?? translate.terminal?.error ?? "").slice(0, 60)}`,
  );
  const translateFlow = isolation(translate.messages, translate.requestId);
  check(
    "nothing from the hidden turn is broadcast to the extension",
    translateFlow.leaks === "none",
    `saw ${translateFlow.leaks}`,
  );
  check(
    "the result streams as deltas first",
    translateFlow.deltas > 0,
    `${translateFlow.deltas} delta(s)`,
  );
  check(
    "delta and done carry the requesting tab and requestId",
    translateFlow.requestIdOk && translateFlow.tabIdOk,
    `${translateFlow.kinds}`,
  );

  const hiddenSession = selectionPrompts()[0]?.sessionId ?? "";
  check(
    "the hidden turn runs on its own ACP session",
    Boolean(hiddenSession) && hiddenSession !== chatSessionId,
    `hidden=${hiddenSession || "none"} chat=${chatSessionId}`,
  );

  // ---------------------------------------------------------------- 超长 / 空 / 未知
  const before = selectionPrompts().length;
  const tooLong = await runSelection({ mode: "translate", text: "字".repeat(501) });
  check(
    "a selection over the CJK budget is refused",
    tooLong.terminal?.type === "selection.failed" &&
      /at most 500 CJK characters or 200 words/.test(String(tooLong.terminal.error)),
    String(tooLong.terminal?.error ?? "none"),
  );
  const empty = await runSelection({ mode: "search", text: "   " });
  check(
    "an empty selection is refused",
    empty.terminal?.type === "selection.failed" && /empty/.test(String(empty.terminal.error)),
    String(empty.terminal?.error ?? "none"),
  );
  const unknown = await runSelection({ mode: "quote", text: "hello" });
  check(
    "an unknown mode is refused",
    unknown.terminal?.type === "selection.failed" && /unknown mode/.test(String(unknown.terminal.error)),
    String(unknown.terminal?.error ?? "none"),
  );
  check(
    "refused requests never reach the CLI",
    selectionPrompts().length === before,
    `prompts=${selectionPrompts().length} before=${before}`,
  );
  // 额度本身也是契约：中日韩按字符 500、其它语言按单词 200，正好用满都得放行
  // （扩展侧与 Host 两侧按同一套口径拦，见 internal/selection 与
  // packages/extension/src/selection-limit.ts）。
  const atLimit = await runSelection({ mode: "translate", text: "字".repeat(500) });
  check(
    "a selection of exactly 500 CJK characters is accepted",
    atLimit.terminal?.type === "selection.done",
    String(atLimit.terminal?.type ?? atLimit.terminal?.error ?? "none"),
  );
  const english = (count) => Array.from({ length: count }, () => "word").join(" ");
  const wordsAtLimit = await runSelection({ mode: "translate", text: english(200) });
  check(
    "a selection of exactly 200 words is accepted",
    wordsAtLimit.terminal?.type === "selection.done",
    String(wordsAtLimit.terminal?.type ?? wordsAtLimit.terminal?.error ?? "none"),
  );
  const tooManyWords = await runSelection({ mode: "translate", text: english(201) });
  check(
    "one word over the budget is refused",
    tooManyWords.terminal?.type === "selection.failed",
    String(tooManyWords.terminal?.type ?? "none"),
  );

  // ---------------------------------------------------------------- 搜索
  const search = await runSelection({ mode: "search", text: "opensider release" });
  check(
    "search returns markdown with sources",
    search.terminal?.type === "selection.done" &&
      String(search.terminal.text).includes("Sources") &&
      String(search.terminal.text).includes("example.com"),
    String(search.terminal?.text ?? search.terminal?.error ?? "none").slice(0, 60),
  );
  const searchFlow = isolation(search.messages, search.requestId);
  check("search does not leak into the extension either", searchFlow.leaks === "none", `saw ${searchFlow.leaks}`);
  // 搜索只给最后那一条正文：过程叙述与中间正文都不许流出去（用户报过「先出现、再被刷掉」）。
  check("search streams no intermediate text", searchFlow.deltas === 0, `${searchFlow.deltas} delta(s)`);
  const searchPrompt = selectionPrompts().findLast((entry) => entry.kind === "search");
  check(
    "the search prompt carries the selected text",
    searchPrompt?.text === "opensider release",
    searchPrompt?.text ?? "none",
  );
  // 答案语言看**界面语言**（界面设成中文，结果就得要中文），跟翻译的目标语言不是一回事。
  const lastSearchPrompt = () => String(selectionPrompts().findLast((entry) => entry.kind === "search")?.prompt ?? "");
  check(
    "the search prompt asks for the UI language",
    /written in Simplified Chinese/.test(lastSearchPrompt()),
    lastSearchPrompt().slice(0, 80),
  );
  const englishUi = await runSelection({ mode: "search", text: "opensider release", uiLocale: "en" });
  check(
    "an English UI asks for an English answer",
    /written in English/.test(lastSearchPrompt()) && englishUi.terminal?.type === "selection.done",
    lastSearchPrompt().slice(0, 80),
  );

  // ---------------------------------------------------------------- 取消
  const cancelled = await runSelection({ mode: "search", text: "something long", action: "cancel", cancelAfterMs: 120 });
  check(
    "a cancelled request sends no result",
    cancelled.terminal === undefined,
    `${cancelled.terminal?.type ?? "none"}`,
  );
  const cancels = traceEvents().filter((entry) => entry.event === "cancel").length;
  check("the cancel reaches the CLI", cancels > 0, `${cancels} cancel(s) traced`);

  // 取消之后通道还能用（这是「单飞 + 取消」最容易坏的地方）。
  const recovered = await runSelection({ mode: "translate", text: "again" });
  check(
    "the channel recovers after a cancel",
    recovered.terminal?.type === "selection.done" && String(recovered.terminal.text).includes("[translated] again"),
    `${recovered.terminal?.type ?? "none"}`,
  );

  // ---------------------------------------------------------------- 聊天没被影响
  // 划词用的是另一个进程、另一个会话：聊天的会话里不该出现隐藏通道的提示词。
  const chatPrompts = traceEvents().filter((entry) => entry.event === "prompt");
  check(
    "the chat's own session never saw the utility prompts",
    chatPrompts.every((entry) => !/Translate the text below into|Search the web for the query below/.test(entry.text ?? "")),
    chatPrompts.map((entry) => entry.sessionId).join("|") || "no chat prompt yet",
  );

  send({ type: "prompt", text: "hello chat", sessionId: chatSessionId });
  const chatReply = await waitFor((msg) => msg.type === "update" && msg.sessionId === chatSessionId, 15_000);
  check("the chat still works after selection requests", Boolean(chatReply), chatReply ? "" : "no chat update");
  const chatEnd = await waitFor((msg) => msg.type === "turn.end" && msg.sessionId === chatSessionId, 15_000);
  check("the chat turn ends normally", Boolean(chatEnd), chatEnd?.stopReason ?? "none");
} catch (error) {
  check("verification ran to completion", false, String(error?.message ?? error));
} finally {
  cleanup();
}

const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
