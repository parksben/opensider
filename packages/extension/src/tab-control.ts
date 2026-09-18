/**
 * Who may work in which tab, per session — the state behind "Agent tab control"
 * (borrow / take-back). Pure state and transitions; the service worker owns
 * persistence (`chrome.storage.session`) and the side effects (title badge,
 * `autoDiscardable`, banner broadcasts).
 *
 * Rules encoded here (see docs/TECH_DESIGN.md «Agent 标签接管»):
 *   - a tab belongs to at most one session at a time (`entries`)
 *   - a session's *anchor* is the tab the user was looking at when they sent the
 *     message; writing there takes the tab over automatically
 *   - entering any other user tab needs an explicit grant; a denied or taken-back
 *     pair stays blocked for a cooldown so the Agent cannot re-ask in a loop
 *   - everything expires: entries after `CONTROL_TTL_MS` without a command,
 *     pending requests after `PENDING_TTL_MS`, blocks after `BLOCK_MS`
 */

export type ControlEntry = {
  sessionId: string;
  tabId: number;
  startedAt: number;
  lastUsedAt: number;
};

export type PendingBorrow = {
  requestId: string;
  sessionId: string;
  tabId: number;
  at: number;
};

export type ControlSnapshot = {
  entries: ControlEntry[];
  /** sessionId -> tabId the user was on when the session's message was sent. */
  anchors: Record<string, number>;
  /** sessionId -> tabId commands with no `tabId` route to (anchor on a new prompt, then follows writes). */
  targets: Record<string, number>;
  /** `sessionId:tabId` -> blockedAt (take-back / explicit deny). */
  blocked: Record<string, number>;
  pending: PendingBorrow | null;
};

export const CONTROL_TTL_MS = 30 * 60_000;
export const BLOCK_MS = 10 * 60_000;
export const PENDING_TTL_MS = 120_000;

export function emptyControl(): ControlSnapshot {
  return { entries: [], anchors: {}, targets: {}, blocked: {}, pending: null };
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Tolerant parse: storage may hold a partial shape left by an older build. */
export function parseControl(raw: unknown): ControlSnapshot {
  const state = emptyControl();
  if (!raw || typeof raw !== "object") return state;
  const data = raw as Record<string, unknown>;
  if (Array.isArray(data.entries)) {
    for (const item of data.entries) {
      if (!item || typeof item !== "object") continue;
      const entry = item as Record<string, unknown>;
      const tabId = asNumber(entry.tabId);
      if (tabId == null || typeof entry.sessionId !== "string") continue;
      const lastUsedAt = asNumber(entry.lastUsedAt) ?? Date.now();
      state.entries.push({
        sessionId: entry.sessionId,
        tabId,
        startedAt: asNumber(entry.startedAt) ?? lastUsedAt,
        lastUsedAt,
      });
    }
  }
  if (data.anchors && typeof data.anchors === "object") {
    for (const [sessionId, tabId] of Object.entries(data.anchors as Record<string, unknown>)) {
      const id = asNumber(tabId);
      if (id != null) state.anchors[sessionId] = id;
    }
  }
  if (data.targets && typeof data.targets === "object") {
    for (const [sessionId, tabId] of Object.entries(data.targets as Record<string, unknown>)) {
      const id = asNumber(tabId);
      if (id != null) state.targets[sessionId] = id;
    }
  }
  if (data.blocked && typeof data.blocked === "object") {
    for (const [key, at] of Object.entries(data.blocked as Record<string, unknown>)) {
      const stamp = asNumber(at);
      if (stamp != null) state.blocked[key] = stamp;
    }
  }
  if (data.pending && typeof data.pending === "object") {
    const pending = data.pending as Record<string, unknown>;
    const tabId = asNumber(pending.tabId);
    if (tabId != null && typeof pending.sessionId === "string" && typeof pending.requestId === "string") {
      state.pending = {
        requestId: pending.requestId,
        sessionId: pending.sessionId,
        tabId,
        at: asNumber(pending.at) ?? Date.now(),
      };
    }
  }
  return state;
}

/** Drop what has expired. `released` lists tabs whose entry went away (badge off). */
export function pruneControl(
  state: ControlSnapshot,
  now: number,
): { changed: boolean; released: number[] } {
  let changed = false;
  const released: number[] = [];
  const alive = state.entries.filter((entry) => now - entry.lastUsedAt < CONTROL_TTL_MS);
  if (alive.length !== state.entries.length) {
    for (const gone of state.entries) {
      if (!alive.includes(gone)) released.push(gone.tabId);
    }
    state.entries = alive;
    changed = true;
  }
  for (const [key, at] of Object.entries(state.blocked)) {
    if (now - at >= BLOCK_MS) {
      delete state.blocked[key];
      changed = true;
    }
  }
  if (state.pending && now - state.pending.at >= PENDING_TTL_MS) {
    state.pending = null;
    changed = true;
  }
  return { changed, released };
}

export function blockKey(sessionId: string, tabId: number): string {
  return `${sessionId}:${tabId}`;
}

export function entryForTab(state: ControlSnapshot, tabId: number): ControlEntry | undefined {
  return state.entries.find((entry) => entry.tabId === tabId);
}

/** Entries of one session, most recently used first. */
export function tabsForSession(state: ControlSnapshot, sessionId: string): ControlEntry[] {
  return state.entries
    .filter((entry) => entry.sessionId === sessionId)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function primaryTabFor(state: ControlSnapshot, sessionId: string): number | undefined {
  return tabsForSession(state, sessionId)[0]?.tabId;
}

export function isBlocked(state: ControlSnapshot, sessionId: string, tabId: number, now: number): boolean {
  const at = state.blocked[blockKey(sessionId, tabId)];
  return at != null && now - at < BLOCK_MS;
}

export function clearBlock(state: ControlSnapshot, sessionId: string, tabId: number): void {
  delete state.blocked[blockKey(sessionId, tabId)];
}

/** Take-back / explicit deny: the pair may not be taken over again until the cooldown ends. */
export function blockPair(state: ControlSnapshot, sessionId: string, tabId: number, now: number): void {
  state.blocked[blockKey(sessionId, tabId)] = now;
}

/** Hand a tab to a session (creation, auto-takeover of the anchor, or an approved grant). */
export function takeover(state: ControlSnapshot, sessionId: string, tabId: number, now: number): ControlEntry {
  const existing = entryForTab(state, tabId);
  if (existing) {
    existing.sessionId = sessionId;
    existing.startedAt = now;
    existing.lastUsedAt = now;
    return existing;
  }
  const entry: ControlEntry = { sessionId, tabId, startedAt: now, lastUsedAt: now };
  state.entries.push(entry);
  return entry;
}

export function touch(state: ControlSnapshot, tabId: number, now: number): void {
  const entry = entryForTab(state, tabId);
  if (entry) entry.lastUsedAt = now;
}

/** Returns the session that used to own the tab, if any. */
export function releaseTab(state: ControlSnapshot, tabId: number): string | undefined {
  const entry = entryForTab(state, tabId);
  for (const [sessionId, target] of Object.entries(state.targets)) {
    if (target === tabId) delete state.targets[sessionId];
  }
  if (!entry) return undefined;
  state.entries = state.entries.filter((item) => item.tabId !== tabId);
  if (state.pending?.tabId === tabId) state.pending = null;
  return entry.sessionId;
}

/** Release everything a session holds; returns the tab ids that were released. */
export function releaseSession(state: ControlSnapshot, sessionId: string): number[] {
  const mine = state.entries.filter((entry) => entry.sessionId === sessionId).map((entry) => entry.tabId);
  state.entries = state.entries.filter((entry) => entry.sessionId !== sessionId);
  delete state.anchors[sessionId];
  delete state.targets[sessionId];
  if (state.pending?.sessionId === sessionId) state.pending = null;
  return mine;
}

export function setAnchor(state: ControlSnapshot, sessionId: string, tabId: number): void {
  state.anchors[sessionId] = tabId;
}

export function anchorFor(state: ControlSnapshot, sessionId: string): number | undefined {
  return state.anchors[sessionId];
}

export function setTarget(state: ControlSnapshot, sessionId: string, tabId: number): void {
  state.targets[sessionId] = tabId;
}

export function targetFor(state: ControlSnapshot, sessionId: string): number | undefined {
  return state.targets[sessionId];
}

export function clearTarget(state: ControlSnapshot, sessionId: string): void {
  delete state.targets[sessionId];
}

export function setPending(state: ControlSnapshot, pending: PendingBorrow): void {
  state.pending = pending;
}

export function clearPending(state: ControlSnapshot, requestId?: string): PendingBorrow | null {
  if (!state.pending) return null;
  if (requestId != null && state.pending.requestId !== requestId) return null;
  const gone = state.pending;
  state.pending = null;
  return gone;
}
