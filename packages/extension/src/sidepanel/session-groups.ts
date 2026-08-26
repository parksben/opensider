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

function byUpdatedDesc(a: Session, b: Session): number {
  return b.updatedAt.localeCompare(a.updatedAt);
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
    const ts = Date.parse(session.updatedAt);
    if (!Number.isFinite(ts) || ts >= todayStart) buckets.today.push(session);
    else if (ts >= lastSevenStart) buckets.lastSevenDays.push(session);
    else buckets.older.push(session);
  }

  buckets.pinned.sort((a, b) => (b.pinnedAt ?? "").localeCompare(a.pinnedAt ?? "") || byUpdatedDesc(a, b));
  buckets.today.sort(byUpdatedDesc);
  buckets.lastSevenDays.sort(byUpdatedDesc);
  buckets.older.sort(byUpdatedDesc);

  return (["pinned", "today", "lastSevenDays", "older"] as const)
    .map((id) => ({ id, sessions: buckets[id] }))
    .filter((group) => group.sessions.length > 0);
}
