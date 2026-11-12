import type { Session } from "./persist";

/** Every ACP id this conversation has been bound to (current and per-agent memories). */
export function sessionAcpIds(session: Pick<Session, "acpSessionId" | "acpByProvider">): string[] {
  const ids = new Set<string>();
  if (session.acpSessionId) ids.add(session.acpSessionId);
  for (const id of Object.values(session.acpByProvider ?? {})) {
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * A takeover / form card belongs to one ACP session. It may only be shown (or resolved by
 * sending a message) in the conversation bound to that session; old cards without a
 * session id fall back to whichever conversation is open.
 */
export function cardBelongsToSession(
  session: Pick<Session, "acpSessionId" | "acpByProvider">,
  sessionId?: string,
): boolean {
  if (!sessionId) return true;
  return sessionAcpIds(session).includes(sessionId);
}
