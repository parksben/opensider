import type { BrowserCommand, BrowserResult } from "@shared";
import type { ChatMessage, ChatPart, ToolPart, ToolStatus } from "./chat-types";
import { isBenignStreamCloseText, stripBenignStreamClose } from "./stream-close";
import { withPrimaryArg } from "./tool-label";

function id(): string {
  return crypto.randomUUID();
}

function lastAssistant(
  messages: ChatMessage[],
  model?: { modelId?: string; modelName?: string },
): { messages: ChatMessage[]; index: number } {
  const last = messages[messages.length - 1];
  if (last?.role === "assistant" && last.durationMs == null) {
    const hasOwn = Boolean(last.modelId || last.modelName);
    const hasIncoming = Boolean(model?.modelId || model?.modelName);
    const stamped = hasOwn || !hasIncoming ? last : { ...last, modelId: model?.modelId, modelName: model?.modelName };
    const copy = [...messages];
    copy[copy.length - 1] = stamped;
    return { messages: copy, index: copy.length - 1 };
  }
  const created: ChatMessage = {
    id: id(),
    role: "assistant",
    content: [],
    createdAt: new Date(),
    modelId: model?.modelId,
    modelName: model?.modelName,
  };
  return { messages: [...messages, created], index: messages.length };
}

function replacePart(message: ChatMessage, index: number, part: ChatPart): ChatMessage {
  const content = message.content.slice();
  content[index] = part;
  return { ...message, content };
}

function visibleAcpText(update: Record<string, unknown>): string {
  const raw = String((update.content as { text?: string } | undefined)?.text ?? "");
  return isBenignStreamCloseText(raw) ? stripBenignStreamClose(raw) : raw;
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

export function applyAcpUpdate(
  messages: ChatMessage[],
  update: Record<string, unknown>,
  model?: { modelId?: string; modelName?: string },
): ChatMessage[] {
  const kind = String(update.sessionUpdate ?? "");

  if (kind === "user_message_chunk") {
    return messages;
  }

  if (kind === "agent_message_chunk") {
    const text = visibleAcpText(update);
    if (!text) return messages;
    const next = lastAssistant(messages, model);
    const message = next.messages[next.index];
    const updated = { ...message, content: appendText(message.content, "text", text) };
    next.messages[next.index] = updated;
    return next.messages;
  }

  if (kind === "agent_thought_chunk") {
    const text = visibleAcpText(update);
    if (!text) return messages;
    const next = lastAssistant(messages, model);
    const message = next.messages[next.index];
    const updated = { ...message, content: appendText(message.content, "reasoning", text) };
    next.messages[next.index] = updated;
    return next.messages;
  }

  if (kind === "tool_call") {
    const tool = withPrimaryArg({
      type: "tool-call",
      toolCallId: String(update.toolCallId ?? id()),
      toolName: String(update.title ?? update.kind ?? "tool"),
      args: update.rawInput ?? update.input ?? {},
      result: update.rawOutput,
      status: (update.status as ToolStatus | undefined) ?? "pending",
      kind: update.kind ? String(update.kind) : undefined,
    });
    const next = lastAssistant(messages, model);
    const message = next.messages[next.index];
    next.messages[next.index] = { ...message, content: [...message.content, tool] };
    return next.messages;
  }

  if (kind === "tool_call_update") {
    const toolCallId = String(update.toolCallId ?? "");
    const found = findTool(messages, toolCallId);
    if (!found) {
      return applyAcpUpdate(messages, { ...update, sessionUpdate: "tool_call" }, model);
    }
    const message = messages[found.messageIndex];
    const current = message.content[found.partIndex] as ToolPart;
    const patched = withPrimaryArg({
      ...current,
      toolName: update.title ? String(update.title) : current.toolName,
      args: update.rawInput ?? update.input ?? current.args,
      result: update.rawOutput ?? update.content ?? current.result,
      status: (update.status as ToolStatus | undefined) ?? current.status,
      kind: update.kind ? String(update.kind) : current.kind,
    });
    const copy = messages.slice();
    copy[found.messageIndex] = replacePart(message, found.partIndex, patched);
    return copy;
  }

  return messages;
}

function browserKind(method: string): string {
  if (/^(get|query|exists|listTabs)/.test(method)) return "read";
  if (/^(navigate|goBack|goForward|reload|switchTab|openTab|closeTab|moveTabsToWindow|runScript)/.test(method)) return "fetch";
  return "other";
}

function browserTitle(command: BrowserCommand): string {
  const args = command.args;
  const detail = [args?.url, args?.selector, args?.text, args?.tabId != null ? String(args.tabId) : ""]
    .filter(Boolean)
    .join(" ");
  return detail ? `${command.method} ${detail}` : command.method;
}

export function applyBrowserTool(
  messages: ChatMessage[],
  command: BrowserCommand,
  result?: BrowserResult,
  model?: { modelId?: string; modelName?: string },
): ChatMessage[] {
  const toolCallId = `browser:${command.id}`;
  const found = findTool(messages, toolCallId);
  const part = withPrimaryArg({
    type: "tool-call",
    toolCallId,
    toolName: browserTitle(command),
    args: command.args ?? {},
    result: result ? (result.ok ? result.data ?? result.error : result.error) : undefined,
    status: result ? (result.ok ? "completed" : "failed") : "in_progress",
    kind: browserKind(command.method),
  });
  if (found) {
    const message = messages[found.messageIndex];
    const current = message.content[found.partIndex] as ToolPart;
    const patched = withPrimaryArg({
      ...part,
      toolName: command.args ? part.toolName : current.toolName,
      args: command.args ?? current.args,
      kind: current.kind ?? part.kind,
      primaryArg: current.primaryArg,
    });
    const copy = messages.slice();
    copy[found.messageIndex] = replacePart(message, found.partIndex, patched);
    return copy;
  }
  const next = lastAssistant(messages, model);
  const message = next.messages[next.index];
  next.messages[next.index] = { ...message, content: [...message.content, part] };
  return next.messages;
}

export function createUserMessage(text: string, attachments?: ChatMessage["attachments"]): ChatMessage {
  return {
    id: id(),
    role: "user",
    content: [{ type: "text", text }],
    createdAt: new Date(),
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
  };
}
