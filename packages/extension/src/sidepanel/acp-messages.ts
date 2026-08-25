import type { ChatMessage, ChatPart, ToolPart, ToolStatus } from "./chat-types";

function id(): string {
  return crypto.randomUUID();
}

function lastAssistant(messages: ChatMessage[]): { messages: ChatMessage[]; index: number } {
  const index = [...messages].reverse().findIndex((item) => item.role === "assistant");
  if (index === -1) {
    const created: ChatMessage = {
      id: id(),
      role: "assistant",
      content: [],
      createdAt: new Date(),
    };
    return { messages: [...messages, created], index: messages.length };
  }
  return { messages: [...messages], index: messages.length - 1 - index };
}

function replacePart(message: ChatMessage, index: number, part: ChatPart): ChatMessage {
  const content = message.content.slice();
  content[index] = part;
  return { ...message, content };
}

function appendText(parts: ChatPart[], type: "text" | "reasoning", text: string): ChatPart[] {
  const last = parts[parts.length - 1];
  if (last && last.type === type) {
    return [...parts.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...parts, { type, text }];
}

function findTool(messages: ChatMessage[], toolCallId: string): { messageIndex: number; partIndex: number } | undefined {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex];
    const partIndex = message.content.findIndex(
      (part) => part.type === "tool-call" && part.toolCallId === toolCallId,
    );
    if (partIndex >= 0) return { messageIndex, partIndex };
  }
  return undefined;
}

export function applyAcpUpdate(messages: ChatMessage[], update: Record<string, unknown>): ChatMessage[] {
  const kind = String(update.sessionUpdate ?? "");

  if (kind === "user_message_chunk") {
    const text = String((update.content as { text?: string } | undefined)?.text ?? "");
    const last = messages[messages.length - 1];
    if (last?.role === "user") {
      const part = last.content[0];
      if (part?.type === "text") {
        return [...messages.slice(0, -1), { ...last, content: [{ type: "text", text: part.text + text }] }];
      }
    }
    return [
      ...messages,
      { id: id(), role: "user", content: [{ type: "text", text }], createdAt: new Date() },
    ];
  }

  if (kind === "agent_message_chunk") {
    const text = String((update.content as { text?: string } | undefined)?.text ?? "");
    const next = lastAssistant(messages);
    const message = next.messages[next.index];
    const updated = { ...message, content: appendText(message.content, "text", text) };
    next.messages[next.index] = updated;
    return next.messages;
  }

  if (kind === "agent_thought_chunk") {
    const text = String((update.content as { text?: string } | undefined)?.text ?? "");
    const next = lastAssistant(messages);
    const message = next.messages[next.index];
    const updated = { ...message, content: appendText(message.content, "reasoning", text) };
    next.messages[next.index] = updated;
    return next.messages;
  }

  if (kind === "tool_call") {
    const tool: ToolPart = {
      type: "tool-call",
      toolCallId: String(update.toolCallId ?? id()),
      toolName: String(update.title ?? update.kind ?? "tool"),
      args: update.rawInput ?? update.input ?? {},
      result: update.rawOutput,
      status: (update.status as ToolStatus | undefined) ?? "pending",
      kind: update.kind ? String(update.kind) : undefined,
    };
    const next = lastAssistant(messages);
    const message = next.messages[next.index];
    next.messages[next.index] = { ...message, content: [...message.content, tool] };
    return next.messages;
  }

  if (kind === "tool_call_update") {
    const toolCallId = String(update.toolCallId ?? "");
    const found = findTool(messages, toolCallId);
    if (!found) {
      return applyAcpUpdate(messages, { ...update, sessionUpdate: "tool_call" });
    }
    const message = messages[found.messageIndex];
    const current = message.content[found.partIndex] as ToolPart;
    const patched: ToolPart = {
      ...current,
      toolName: update.title ? String(update.title) : current.toolName,
      args: update.rawInput ?? update.input ?? current.args,
      result: update.rawOutput ?? update.content ?? current.result,
      status: (update.status as ToolStatus | undefined) ?? current.status,
      kind: update.kind ? String(update.kind) : current.kind,
    };
    const copy = messages.slice();
    copy[found.messageIndex] = replacePart(message, found.partIndex, patched);
    return copy;
  }

  return messages;
}

export function createUserMessage(text: string): ChatMessage {
  return {
    id: id(),
    role: "user",
    content: [{ type: "text", text }],
    createdAt: new Date(),
  };
}
