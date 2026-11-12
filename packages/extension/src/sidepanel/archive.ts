import type { Session } from "./persist";

const encoder = new TextEncoder();

function utf8Length(text: string): number {
  return encoder.encode(text).byteLength;
}

/** 30 天没动过的会话自动归档。 */
export const ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
/** 估算的整份状态超过它就按体积归档最老的会话。 */
export const ARCHIVE_BUDGET_BYTES = 16 * 1024 * 1024;
/** 体积归档的目标：回落到这里就停。 */
export const ARCHIVE_TARGET_BYTES = 12 * 1024 * 1024;
/** 自动检查的间隔。 */
export const ARCHIVE_CHECK_MS = 30 * 60 * 1000;
/** 归档请求的等待上限：Host 没回就作废这一轮，过一会儿再试。 */
export const ARCHIVE_REQUEST_TIMEOUT_MS = 20 * 1000;
/** 归档请求超时 / 失败后的重试间隔。 */
export const ARCHIVE_RETRY_MS = 60 * 1000;

/**
 * 估算一条会话在状态 JSON 里占的字节数。正文与工具结果是大头；只为了让归档判断
 * 有个数量级正确的依据，不追求和 `JSON.stringify` 逐字节一致（那会把整份状态
 * 再序列化一遍，正是我们想避免的开销）。
 */
export function estimateSessionBytes(session: Session): number {
  let bytes = 256;
  for (const message of session.messages) {
    bytes += 128;
    for (const part of message.content) {
      if (part.type === "text" || part.type === "reasoning") {
        bytes += utf8Length(part.text) + 32;
      } else if (part.type === "tool-call") {
        bytes += utf8Length(JSON.stringify(part.args ?? {})) + 32;
        if (part.result !== undefined) bytes += utf8Length(JSON.stringify(part.result)) + 32;
      }
    }
  }
  if (session.pendingForkContext) bytes += utf8Length(session.pendingForkContext);
  if (session.todos?.length) bytes += utf8Length(JSON.stringify(session.todos));
  if (session.artifacts?.length) bytes += utf8Length(JSON.stringify(session.artifacts));
  return bytes;
}

export function estimateActiveBytes(sessions: Session[]): number {
  let bytes = 0;
  for (const session of sessions) {
    if (session.archivedAt) bytes += 512;
    else bytes += estimateSessionBytes(session);
  }
  return bytes;
}

/**
 * 选出本轮要归档的会话 id（从老到新）。两条规则：
 *
 *  1. `updatedAt` 超过 30 天的，无条件归档；
 *  2. 整份状态估算超过 16MB 时，继续归档最老的，直到回落到 12MB。
 *
 * 当前选中、正在跑、置顶、已归档、没有正文的会话都不动。至少会保留当前选中的
 * 那条，所以永远不会把会话列表清空。
 */
export function pickSessionsToArchive(input: {
  sessions: Session[];
  now?: number;
  selectedId?: string;
  runningIds?: ReadonlySet<string> | string[];
  afterMs?: number;
  budgetBytes?: number;
  targetBytes?: number;
}): string[] {
  const now = input.now ?? Date.now();
  const running =
    input.runningIds instanceof Set ? input.runningIds : new Set(input.runningIds ?? []);
  const after = input.afterMs ?? ARCHIVE_AFTER_MS;
  const candidates = input.sessions
    .filter(
      (session) =>
        !session.archivedAt &&
        !session.pinnedAt &&
        session.id !== input.selectedId &&
        !running.has(session.id) &&
        session.messages.length > 0,
    )
    .sort((a, b) => {
      const ta = Date.parse(a.updatedAt);
      const tb = Date.parse(b.updatedAt);
      const delta = (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    });

  const picked = new Set<string>();
  for (const session of candidates) {
    const t = Date.parse(session.updatedAt);
    if (Number.isFinite(t) && now - t >= after) picked.add(session.id);
  }

  let bytes = estimateActiveBytes(input.sessions.filter((session) => !picked.has(session.id)));
  if (bytes > (input.budgetBytes ?? ARCHIVE_BUDGET_BYTES)) {
    const target = input.targetBytes ?? ARCHIVE_TARGET_BYTES;
    for (const session of candidates) {
      if (bytes <= target) break;
      if (picked.has(session.id)) continue;
      picked.add(session.id);
      bytes -= estimateSessionBytes(session);
    }
  }
  return [...picked];
}
