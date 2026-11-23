import type { ChatMessage } from "./chat-types";

export type StageState = {
  sessionId: string;
  id?: string;
};

/**
 * Advance the live "stage" below the last user message for the current thread.
 *
 * The id is captured only while the turn is actually streaming (the last assistant has no
 * `durationMs`) and then sticks after it ends, so the stage does not collapse under the
 * message that started it. A different session resets it: forked threads copy message ids,
 * and a copied finished answer must not inherit a stage. A panel opened on history never
 * stages an old turn, even if that turn is missing its duration stamp.
 *
 * `pending` user messages (held in steer mode, not delivered yet) are skipped everywhere:
 * they sit at the end of the list but the running turn before them is still live.
 */
export function nextStage(
  state: StageState | undefined,
  sessionId: string,
  messages: ChatMessage[],
  isRunning: boolean,
): StageState {
  const base = state && state.sessionId === sessionId ? state : { sessionId };
  const last = lastSettled(messages);
  if (isRunning && last?.role === "assistant" && last.durationMs == null) {
    return { sessionId, id: last.id };
  }
  return base;
}

/** Whether the staged message still has no newer user message after it. */
export function stageVisible(messages: ChatMessage[], id?: string): boolean {
  if (!id) return false;
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return false;
  return !messages.slice(index + 1).some((message) => message.role === "user" && !message.pending);
}

/** The last message that has actually been sent (held steer messages do not count). */
export function lastSettled(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message.pending) return message;
  }
  return undefined;
}

export function shouldShowAwaitingStage(isRunning: boolean, last: ChatMessage | undefined): boolean {
  return isRunning && last?.role === "user" && !last.awaitingSteer;
}
