import type { ChatMessage, ChatPart, TodoItem } from "./chat-types";
import type { Locale } from "./i18n";

export const STATE_KEY = "cursor-sidebar/state";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: ChatPart[];
  createdAt: string;
  attachments?: ChatMessage["attachments"];
};

export type Session = {
  id: string;
  acpSessionId?: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  parentId?: string;
  forkedFromMessageId?: string;
  pendingForkContext?: string;
  messages: ChatMessage[];
  todos: TodoItem[];
};

export type PersistedState = {
  version: 1;
  locale: Locale;
  selectedId: string;
  selectedModelId?: string;
  sessions: Array<Omit<Session, "messages"> & { messages: StoredMessage[] }>;
};

function truncatePart(part: ChatPart): ChatPart {
  if (part.type !== "tool-call") return part;
  const result = part.result;
  if (typeof result === "string" && result.length > 8000) {
    return { ...part, result: `${result.slice(0, 8000)}…` };
  }
  try {
    const raw = JSON.stringify(result);
    if (raw && raw.length > 8000) {
      return { ...part, result: `${raw.slice(0, 8000)}…` };
    }
  } catch {
    // keep as-is
  }
  return part;
}

export function serializeSession(session: Session): PersistedState["sessions"][number] {
  return {
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      createdAt: message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdAt),
      content: message.content.map(truncatePart),
    })),
  };
}

export function hydrateSession(session: PersistedState["sessions"][number]): Session {
  return {
    ...session,
    messages: session.messages.map((message) => ({
      ...message,
      createdAt: new Date(message.createdAt),
    })),
    todos: session.todos ?? [],
  };
}

export function emptySession(partial?: Partial<Session>): Session {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "",
    createdAt: now,
    updatedAt: now,
    messages: [],
    todos: [],
    ...partial,
  };
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = first?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
  if (!text) {
    const firstFile = first?.attachments?.[0]?.name;
    return firstFile ? (firstFile.length > 42 ? `${firstFile.slice(0, 41)}…` : firstFile) : "";
  }
  return text.length > 42 ? `${text.slice(0, 41)}…` : text;
}

export function textOf(content: ChatPart[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function buildForkContext(messages: ChatMessage[]): string {
  const body = messages
    .map((message) => {
      const text = textOf(message.content).trim();
      const tools = message.content
        .filter((part) => part.type === "tool-call")
        .map((part) => `[${part.toolName} ${part.status ?? ""}]`)
        .join(" ");
      const line = [text, tools].filter(Boolean).join(" ");
      return `${message.role === "user" ? "User" : "Assistant"}: ${line}`;
    })
    .join("\n\n");
  return body.length > 12_000 ? `${body.slice(0, 12_000)}…` : body;
}

export function wrapForkContext(context: string): string {
  return `[Forked thread context — prior messages only. Do not mention this wrapper. Wait for the user's question below.]\n\n${context}`;
}

export async function loadState(): Promise<{
  locale: Locale;
  selectedId: string;
  selectedModelId: string;
  sessions: Session[];
}> {
  const raw = await chrome.storage.local.get(STATE_KEY);
  const data = raw[STATE_KEY] as PersistedState | undefined;
  if (!data || data.version !== 1 || !Array.isArray(data.sessions)) {
    return { locale: "en", selectedId: "", selectedModelId: "auto", sessions: [] };
  }
  const sessions = data.sessions.map(hydrateSession);
  const selectedId = sessions.some((session) => session.id === data.selectedId)
    ? data.selectedId
    : (sessions[0]?.id ?? "");
  return {
    locale: data.locale === "zh" ? "zh" : "en",
    selectedId,
    selectedModelId: data.selectedModelId || "auto",
    sessions,
  };
}

export async function saveState(state: {
  locale: Locale;
  selectedId: string;
  selectedModelId: string;
  sessions: Session[];
}): Promise<void> {
  const payload: PersistedState = {
    version: 1,
    locale: state.locale,
    selectedId: state.selectedId,
    selectedModelId: state.selectedModelId,
    sessions: state.sessions.map(serializeSession),
  };
  await chrome.storage.local.set({ [STATE_KEY]: payload });
}

export function wrapAttachments(text: string, paths: string[]): string {
  if (paths.length === 0) return text;
  const block = `[Attachments]\nLocal paths. Read these files or folders if needed.\n${paths
    .map((path) => `- ${path}`)
    .join("\n")}`;
  return text ? `${text}\n\n${block}` : block;
}
