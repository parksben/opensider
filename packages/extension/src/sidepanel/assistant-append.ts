import type { ChatMessage } from "./chat-types";

/**
 * Find (or create) the assistant message that the next streamed part belongs to.
 *
 * Steer mode puts a user message on screen the moment it is typed, but the Agent may not
 * have read it yet: everything that arrives before the Agent picks it up still belongs to
 * the answer above it, so trailing `pending` / `awaitingSteer` messages are skipped.
 * Once the Agent accepts the steer (`awaitingSteer` cleared) the next part starts a fresh
 * bubble below it — the "my message, then the reply about it" order Copilot shows.
 *
 * A settled answer (`durationMs` set) is never grown: if the turn is already over, the
 * part gets its own bubble at the end.
 */
export function lastAssistant(
  messages: ChatMessage[],
  model?: { modelId?: string; modelName?: string },
): { messages: ChatMessage[]; index: number } {
  let end = messages.length;
  while (end > 0) {
    const candidate = messages[end - 1];
    if (candidate.role !== "user" || !(candidate.pending || candidate.awaitingSteer)) break;
    end -= 1;
  }
  const last = messages[end - 1];
  if (last?.role === "assistant" && last.durationMs == null) {
    const hasOwn = Boolean(last.modelId || last.modelName);
    const hasIncoming = Boolean(model?.modelId || model?.modelName);
    const stamped = hasOwn || !hasIncoming ? last : { ...last, modelId: model?.modelId, modelName: model?.modelName };
    const copy = [...messages];
    copy[end - 1] = stamped;
    return { messages: copy, index: end - 1 };
  }
  const created: ChatMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    content: [],
    createdAt: new Date(),
    modelId: model?.modelId,
    modelName: model?.modelName,
  };
  return { messages: [...messages, created], index: messages.length };
}
