#!/usr/bin/env node
// Verifies the ui-state mirror protocol end to end, at the raw Native Messaging frame level:
//
//   the mirror (`~/.opensider/ui-state.json`) is the copy that survives an extension
//   reinstall, and it is routinely bigger than 1MB — the per-frame limit of Native
//   Messaging. 2026-09-18 an oversized state made both directions drop silently (and the
//   read side then lost frame alignment entirely), so the mirror stopped updating and a
//   reinstall looked like "all sessions are gone". This script drives a real host binary
//   with real frames and checks that:
//
//     1. a >1MB state is pushed as <1MB `ui.state` chunks that rejoin losslessly;
//     2. a rogue >1MB frame from the extension is skipped without breaking the stream
//        (the frames after it still parse and answer);
//     3. a >1MB `ui.state.set` upload in chunks reaches the mirror file;
//     4. the "empty state must not overwrite history" guard still holds.
//
//   node scripts/verify-state-mirror.mjs
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAX_FRAME = 1024 * 1024;

const results = [];
function check(name, value, detail) {
  results.push({ name, ok: Boolean(value), detail });
  console.log(`${value ? "ok  " : "FAIL"} ${name}${value || !detail ? "" : ` — ${detail}`}`);
}

// ---------------------------------------------------------------- sandbox + fixtures
const sandbox = mkdtempSync(join(tmpdir(), "opensider-mirror-"));
const home = join(sandbox, ".opensider");
mkdirSync(home, { recursive: true });
const mirror = join(home, "ui-state.json");

function makeState(sessionCount, savedAt, marker) {
  const sessions = [];
  for (let i = 0; i < sessionCount; i += 1) {
    sessions.push({
      id: `s${marker}-${i}`,
      title: `会话 ${i} 🙂 ${marker}`,
      acpSessionId: `acp-${marker}-${i}`,
      updatedAt: savedAt,
      messages: [
        { id: `m${i}`, role: "user", content: [{ type: "text", text: `问题 ${i} ${"x".repeat(2400)}` }], createdAt: savedAt },
        { id: `m${i}b`, role: "assistant", content: [{ type: "text", text: `回答 ${i} ${"y".repeat(2400)}` }], createdAt: savedAt },
      ],
    });
  }
  return { version: 1, savedAt, sessions };
}

// OPENSIDER_MIRROR_FIXTURE=<path> 时用真实镜像文件当输入（排查用户现场用），否则生成合成数据。
const fixturePath = process.env.OPENSIDER_MIRROR_FIXTURE;
let original;
if (fixturePath) {
  original = JSON.parse(readFileSync(fixturePath, "utf8"));
  writeFileSync(mirror, `${JSON.stringify(original, null, 2)}\n`);
} else {
  original = makeState(160, "2026-09-15T09:42:48.472Z", "old");
  writeFileSync(mirror, `${JSON.stringify(original, null, 2)}\n`);
}
const originalCompact = JSON.stringify(original);
check(
  "fixture state is over the single-frame limit",
  originalCompact.length > 700 * 1024,
  `${originalCompact.length} bytes`,
);

const hostBinary = join(sandbox, "opensider");
execFileSync("go", ["build", "-o", hostBinary, "./cmd/opensider"], { cwd: root });

// ---------------------------------------------------------------- frame plumbing
const host = spawn(hostBinary, [], {
  env: { ...process.env, HOME: sandbox },
  stdio: ["pipe", "pipe", "pipe"],
});
let stdout = Buffer.alloc(0);
const messages = [];
host.stdout.on("data", (chunk) => {
  stdout = Buffer.concat([stdout, chunk]);
  for (;;) {
    if (stdout.length < 4) return;
    const length = stdout.readUInt32LE(0);
    if (stdout.length < 4 + length) return;
    const payload = stdout.subarray(4, 4 + length);
    stdout = stdout.subarray(4 + length);
    messages.push({ length, msg: JSON.parse(payload.toString("utf8")) });
  }
});
host.stderr.on("data", (chunk) => process.stderr.write(`[host] ${chunk}`));

function send(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  host.stdin.write(frame);
}

function sendRaw(payload) {
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  host.stdin.write(frame);
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const started = Date.now();
  for (;;) {
    const hit = predicate();
    if (hit) return hit;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function uiStateMessages(from = 0) {
  return messages.filter((entry) => entry.msg.type === "ui.state").slice(from);
}

function joinChunks(chunks) {
  const total = chunks[0].msg.total;
  const parts = new Array(total).fill("");
  for (const entry of chunks) {
    if (entry.msg.total !== total) throw new Error("chunk totals disagree");
    parts[entry.msg.index] = entry.msg.data;
  }
  return parts.join("");
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}
const canonical = (value) => JSON.stringify(sortValue(value));

// ---------------------------------------------------------------- 1. chunked push
send({ type: "hello" });
try {
  await waitFor(() => uiStateMessages().length >= 2, "the chunked ui.state transfer");
} catch (error) {
  check("host pushes a chunked ui.state for a >1MB mirror", false, String(error));
}

const pushed = uiStateMessages();
const total = pushed[0]?.msg.total ?? 0;
const chunks = pushed.filter((entry) => entry.msg.total === total);
check(
  "host pushes a chunked ui.state for a >1MB mirror",
  total > 1 && chunks.length === total,
  `got ${chunks.length}/${total || "?"} chunk(s)`,
);
if (chunks.length === total && total > 1) {
  const everyFrameSmall = chunks.every((entry) => entry.length < MAX_FRAME);
  check("every pushed frame stays under the 1MB native-messaging limit", everyFrameSmall);
  const joined = joinChunks(chunks);
  check("pushed chunks rejoin into the mirror state", canonical(JSON.parse(joined)) === canonical(original));
}

// ---------------------------------------------------------------- 2. rogue oversized frame
const before = uiStateMessages().length;
// 超过读取侧单帧上限（16MB）的帧头：必须按声明长度跳过，后面的帧仍要能解析。
sendRaw(Buffer.alloc(16 * 1024 * 1024 + 64 * 1024, 0x78));
send({ type: "hello" }); // must still be read, despite the rogue frame before it
let afterSecondHello = false;
try {
  await waitFor(
    () => uiStateMessages().length > before && uiStateMessages().length - before >= 2,
    "the second ui.state transfer",
  );
  afterSecondHello = true;
} catch {
  afterSecondHello = false;
}
check("a frame over the incoming cap is skipped without breaking the stream", afterSecondHello);

// ---------------------------------------------------------------- 3. chunked upload
const next = makeState(160, "2026-09-18T10:00:00.000Z", "new");
const text = JSON.stringify(next);
// 扩展侧按 256KB **字节**预算切片（中文约 3 字节/码元）：这里用 65536 码元近似，并守住代理对边界。
const size = 65536;
const parts = [];
for (let start = 0; start < text.length; ) {
  let end = Math.min(start + size, text.length);
  const code = text.charCodeAt(end - 1);
  if (end < text.length && code >= 0xd800 && code <= 0xdbff) end -= 1;
  parts.push(text.slice(start, end));
  start = end;
}
parts.forEach((data, index) => {
  send({ type: "ui.state.set", index, total: parts.length, data });
});
let saved = false;
try {
  await waitFor(() => {
    if (!existsSync(mirror)) return false;
    try {
      return JSON.parse(readFileSync(mirror, "utf8")).savedAt === next.savedAt;
    } catch {
      return false;
    }
  }, "the chunked upload to hit the mirror");
  saved = true;
} catch {
  saved = false;
}
check("a chunked ui.state.set upload reaches the mirror file", saved);

// ---------------------------------------------------------------- 4. empty-state guard
send({ type: "ui.state.set", state: { version: 1, savedAt: "2026-09-18T11:00:00.000Z", sessions: [] } });
await new Promise((resolve) => setTimeout(resolve, 300));
const guarded = JSON.parse(readFileSync(mirror, "utf8"));
check("an empty state does not overwrite the mirror", guarded.savedAt === next.savedAt);

host.kill("SIGTERM");
const failed = results.filter((entry) => !entry.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
