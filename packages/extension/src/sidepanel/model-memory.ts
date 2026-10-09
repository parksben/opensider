import type { Session } from "./persist";

/**
 * Which model one conversation should use under one agent.
 *
 * The memory is per **session × agent** (2026-10-09: picking a model used to be a single
 * panel-wide value, so switching conversations kept the last pick instead of returning to
 * the conversation's own). The chain: this session's choice → the agent's remembered
 * default (what a new conversation starts from) → whatever is on screen now.
 */
export function modelForSession(
  session: Pick<Session, "modelByProvider"> | undefined,
  providerId: string,
  byProvider: Record<string, string>,
  fallback = "",
): string {
  if (providerId) {
    const own = session?.modelByProvider?.[providerId];
    if (own) return own;
    const remembered = byProvider[providerId];
    if (remembered) return remembered;
  }
  return fallback;
}

/** Records one pick on the conversation it was made in (immutable update). */
export function withSessionModel(session: Session, providerId: string, modelId: string): Session {
  if (!providerId) return session;
  return { ...session, modelByProvider: { ...session.modelByProvider, [providerId]: modelId } };
}

/**
 * The engine's current model is only a trustworthy selection when the current agent's list
 * actually advertises it: after an agent switch (or a stale session open) it can still be
 * the previous agent's id, and adopting it is exactly how "the last agent's pick leaks in".
 */
export function adoptableCurrentId(currentId: string | undefined, ids: string[]): string {
  const value = currentId ?? "";
  return value && ids.includes(value) ? value : "";
}
