import type { Session } from "./persist";

export type SessionGroupId = "pinned" | "today" | "lastSevenDays" | "older";

export type SessionGroup = {
  id: SessionGroupId;
  sessions: Session[];
};

const DAY_MS = 86_400_000;

function startOfLocalDay(now: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * 列表顺序看**创建时间**，不看更新时间：多个会话同时跑时每一轮流式都会刷新
 * `updatedAt`，按它排会让卡片在列表里来回换位（用户报的「一直闪动」）。
 * 老数据没有 `createdAt` 时退回 `updatedAt`。
 */
function createdStamp(session: Session): string {
  return session.createdAt || session.updatedAt || "";
}

function byCreatedDesc(a: Session, b: Session): number {
  const order = createdStamp(b).localeCompare(createdStamp(a));
  if (order !== 0) return order;
  // 同一毫秒建出来的两个会话：用 id 兜底，顺序仍然稳定。
  return a.id.localeCompare(b.id);
}

export function groupSessions(sessions: Session[], now = Date.now()): SessionGroup[] {
  const todayStart = startOfLocalDay(now);
  const lastSevenStart = todayStart - 6 * DAY_MS;
  const buckets: Record<SessionGroupId, Session[]> = {
    pinned: [],
    today: [],
    lastSevenDays: [],
    older: [],
  };

  for (const session of sessions) {
    if (session.pinnedAt) {
      buckets.pinned.push(session);
      continue;
    }
    // 分组也看创建时间：一条老会话被回复后不该跳到「今天」，列表才稳定。
    const ts = Date.parse(createdStamp(session));
    if (!Number.isFinite(ts) || ts >= todayStart) buckets.today.push(session);
    else if (ts >= lastSevenStart) buckets.lastSevenDays.push(session);
    else buckets.older.push(session);
  }

  buckets.pinned.sort(
    (a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") || byCreatedDesc(a, b),
  );
  buckets.today.sort(byCreatedDesc);
  buckets.lastSevenDays.sort(byCreatedDesc);
  buckets.older.sort(byCreatedDesc);

  return (["pinned", "today", "lastSevenDays", "older"] as const)
    .map((id) => ({ id, sessions: buckets[id] }))
    .filter((group) => group.sessions.length > 0);
}
