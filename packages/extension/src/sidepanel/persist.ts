import type { AttachmentItem } from "@shared";
import type { ChatMessage, ChatPart, TodoItem } from "./chat-types";
import { readCachedLocale, type Locale } from "./i18n";
import { displayMentionText, wrapUserMentions } from "./mentions";
import { stampToolParts } from "./tool-label";
import { isThemePreference, readCachedTheme, type ThemePreference } from "./theme";

export const STATE_KEY = "opensider/state";
const PREVIOUS_STATE_KEY = "cursor-sidebar/state";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant";
  content: ChatPart[];
  createdAt: string;
  attachments?: ChatMessage["attachments"];
  modelId?: string;
  modelName?: string;
  durationMs?: number;
};

export type Session = {
  id: string;
  acpSessionId?: string;
  acpByProvider?: Record<string, string>;
  title: string;
  titleManual?: boolean;
  createdAt: string;
  updatedAt: string;
  pinnedAt?: string;
  parentId?: string;
  forkedFromMessageId?: string;
  pendingForkContext?: string;
  messages: ChatMessage[];
  todos: TodoItem[];
};

export const SESSION_DRAWER_MIN = 196;
export const SESSION_DRAWER_MAX = 420;
export const SESSION_DRAWER_DEFAULT = 248;
export const SESSION_DRAWER_MAIN_MIN = 220;

export function clampSessionDrawerWidth(width: number, viewportWidth?: number): number {
  const viewport = viewportWidth ?? (typeof window === "undefined" ? 800 : window.innerWidth);
  const max = Math.min(
    SESSION_DRAWER_MAX,
    Math.max(SESSION_DRAWER_MIN, viewport - SESSION_DRAWER_MAIN_MIN),
  );
  if (!Number.isFinite(width)) return Math.min(max, SESSION_DRAWER_DEFAULT);
  return Math.min(max, Math.max(SESSION_DRAWER_MIN, Math.round(width)));
}

export type AgentMode = "ask" | "workspace" | "auto";

export function isAgentMode(value: unknown): value is AgentMode {
  return value === "ask" || value === "workspace" || value === "auto";
}

export function isWorkspaceWritePermission(params: Record<string, unknown>): boolean {
  const toolCall = params.toolCall as { kind?: string; title?: string } | undefined;
  const hay = `${toolCall?.kind ?? ""} ${toolCall?.title ?? ""}`.toLowerCase();
  if (/(execute|shell|bash|terminal|command|fetch|http|network|web_search|mcp)/.test(hay)) return false;
  return /(edit|write|delete|move|create|patch|apply)/.test(hay);
}

export function boundAcpId(session: Session, providerId?: string): string | undefined {
  if (providerId && session.acpByProvider?.[providerId]) return session.acpByProvider[providerId];
  return session.acpSessionId;
}

export function bindAcpSession(session: Session, providerId: string | undefined, acpSessionId: string): Session {
  const acpByProvider = providerId
    ? { ...session.acpByProvider, [providerId]: acpSessionId }
    : session.acpByProvider;
  return { ...session, acpSessionId, acpByProvider };
}

export function applyProviderBinding(sessions: Session[], providerId: string): Session[] {
  return sessions.map((session) => ({
    ...session,
    acpSessionId: session.acpByProvider?.[providerId],
  }));
}

export function sessionAcpIds(session: Session): string[] {
  const ids = new Set<string>();
  if (session.acpSessionId) ids.add(session.acpSessionId);
  for (const id of Object.values(session.acpByProvider ?? {})) {
    if (id) ids.add(id);
  }
  return [...ids];
}

export function autoPermissionOptionId(
  options: Array<{ optionId: string; name: string; kind?: string }>,
): string | undefined {
  const score = (option: { optionId: string; name: string; kind?: string }) => {
    const text = `${option.optionId} ${option.name} ${option.kind ?? ""}`.toLowerCase();
    if (/(reject|deny|cancel|拒绝)/.test(text)) return 0;
    if (/(always|unrestricted|始终)/.test(text)) return 3;
    if (/(once|allow|approve|yes|允许)/.test(text)) return 2;
    return 1;
  };
  return [...options].sort((a, b) => score(b) - score(a))[0]?.optionId;
}

export type PersistedState = {
  version: 1;
  locale: Locale;
  theme: ThemePreference;
  selectedId: string;
  selectedModelId?: string;
  selectedModelByProvider?: Record<string, string>;
  agentMode?: AgentMode;
  selectedProviderId?: string;
  onboardingCompleted?: boolean;
  sessionsOpen?: boolean;
  sessionDrawerWidth?: number;
  sessions: Array<Omit<Session, "messages"> & { messages: StoredMessage[] }>;
};

export function settleFinishedContent(content: ChatPart[]): ChatPart[] {
  const stamped = stampToolParts(content);
  let changed = stamped !== content;
  const next = stamped.map((part) => {
    if (part.type !== "tool-call") return part;
    const status = part.status ?? "pending";
    if (status !== "pending" && status !== "in_progress") return part;
    changed = true;
    return { ...part, status: "completed" as const };
  });
  return changed ? next : content;
}

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

const CURRENT_TAB_PREFIX = /^\[Current tab\] [^\n]*(?:\n\n)?/;
const FORK_WRAP_PREFIX = /^\[Forked thread context[^\]]*\]\s*(?:\n\n)?/;

export function stripEnvPrompt(text: string): string {
  return text.replace(CURRENT_TAB_PREFIX, "").replace(FORK_WRAP_PREFIX, "").trimStart();
}

function looksCollapsed(text: string): boolean {
  return (
    CURRENT_TAB_PREFIX.test(text) ||
    FORK_WRAP_PREFIX.test(text) ||
    (/\n\nUser: /.test(text) && /\n(?:\n)?Assistant: /.test(text))
  );
}

function trySplitForkTranscript(text: string): ChatMessage[] | undefined {
  const body = stripEnvPrompt(text);
  const chunks = body.split(/\n\n(?=(?:User|Assistant): )/);
  if (chunks.length < 2) return undefined;
  const messages: ChatMessage[] = [];
  const now = Date.now();
  for (const [index, chunk] of chunks.entries()) {
    const match = chunk.match(/^(User|Assistant):\s*/);
    if (!match) {
      const leftover = chunk.trim();
      if (!leftover) continue;
      const last = messages[messages.length - 1];
      if (last?.role === "assistant") {
        messages.push({
          id: crypto.randomUUID(),
          role: "user",
          content: [{ type: "text", text: leftover }],
          createdAt: new Date(now + index),
        });
      } else if (last) {
        const part = last.content[0];
        if (part?.type === "text") {
          messages[messages.length - 1] = {
            ...last,
            content: [{ type: "text", text: `${part.text}\n\n${leftover}` }],
          };
        }
      }
      continue;
    }
    messages.push({
      id: crypto.randomUUID(),
      role: match[1] === "User" ? "user" : "assistant",
      content: [{ type: "text", text: chunk.slice(match[0].length).trim() }],
      createdAt: new Date(now + index),
    });
  }
  return messages.length >= 2 ? messages : undefined;
}

export function repairCollapsedMessages(messages: ChatMessage[]): ChatMessage[] {
  if (messages.length === 0) return messages;
  const firstUser = messages.find((message) => message.role === "user");
  const raw = firstUser ? textOf(firstUser.content) : "";
  if (firstUser && looksCollapsed(raw)) {
    const split = trySplitForkTranscript(raw);
    if (split) {
      const rest = messages.filter((message) => message.id !== firstUser.id);
      const lastSplit = split[split.length - 1];
      const lastRest = rest[rest.length - 1];
      if (lastRest?.role === "assistant" && lastSplit?.role === "assistant") {
        return [...split.slice(0, -1), lastRest];
      }
      if (lastRest?.role === "assistant" && lastSplit?.role === "user") {
        return [...split, lastRest];
      }
      return split;
    }
  }
  return messages.map((message) => {
    if (message.role !== "user") return message;
    const rawText = textOf(message.content);
    const stripped = stripEnvPrompt(rawText);
    if (!stripped || stripped === rawText) return message;
    return {
      ...message,
      content: [{ type: "text", text: stripped }, ...message.content.filter((part) => part.type !== "text")],
    };
  });
}

export function hydrateSession(session: PersistedState["sessions"][number]): Session {
  const messages = repairCollapsedMessages(
    session.messages.map((message) => {
      const next = {
        ...message,
        createdAt: new Date(message.createdAt),
      };
      const stamped = stampToolParts(next.content);
      const settled =
        next.role === "assistant" && next.durationMs != null ? settleFinishedContent(stamped) : stamped;
      return settled === next.content ? next : { ...next, content: settled };
    }),
  );
  const title = nextSessionTitle(session, messages);
  return {
    ...session,
    title: stripEnvPrompt(title) || title,
    messages,
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

export function isPlaceholderTitle(title: string | undefined): boolean {
  const value = title?.trim() ?? "";
  if (!value) return true;
  return /^(new chat|新会话)$/i.test(value);
}

export function nextSessionTitle(
  session: Pick<Session, "title" | "titleManual">,
  messages: ChatMessage[],
): string {
  if (session.titleManual && !isPlaceholderTitle(session.title)) return session.title;
  return titleFromMessages(messages) || (isPlaceholderTitle(session.title) ? "" : session.title);
}

export function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((message) => message.role === "user");
  const text = stripEnvPrompt(
    first?.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
      .trim() ?? "",
  );
  const source = displayMentionText(text) || first?.attachments?.[0]?.name || "";
  return summarizeTitle(source);
}

function summarizeTitle(raw: string): string {
  const line =
    raw
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((part) => part.trim())
      .find(Boolean) ?? "";
  const cleaned = line.replace(/^#{1,6}\s+/, "").replace(/\s+/g, " ").trim();
  return cleaned;
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
      const text = displayMentionText(textOf(message.content)).trim();
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

export type LoadedState = {
  locale: Locale;
  theme: ThemePreference;
  selectedId: string;
  selectedModelId: string;
  selectedModelByProvider: Record<string, string>;
  agentMode: AgentMode;
  selectedProviderId: string;
  onboardingCompleted: boolean;
  sessionsOpen: boolean;
  sessionDrawerWidth: number;
  sessions: Session[];
};

function migrateSessionBindings(session: Session, providerId: string): Session {
  if (session.acpByProvider?.[providerId]) {
    return { ...session, acpSessionId: session.acpByProvider[providerId] };
  }
  if (!session.acpSessionId) return session;
  return {
    ...session,
    acpByProvider: { ...session.acpByProvider, [providerId]: session.acpSessionId },
  };
}

export async function loadState(): Promise<LoadedState> {
  const raw = await chrome.storage.local.get([STATE_KEY, PREVIOUS_STATE_KEY]);
  const data = (raw[STATE_KEY] ?? raw[PREVIOUS_STATE_KEY]) as PersistedState | undefined;
  if (!data || data.version !== 1 || !Array.isArray(data.sessions)) {
    return {
      locale: readCachedLocale() ?? "en",
      theme: readCachedTheme() ?? "dark",
      selectedId: "",
      selectedModelId: "",
      selectedModelByProvider: {},
      agentMode: "ask",
      selectedProviderId: "",
      onboardingCompleted: false,
      sessionsOpen: false,
      sessionDrawerWidth: SESSION_DRAWER_DEFAULT,
      sessions: [],
    };
  }
  const hasHistory = data.sessions.some(
    (session) => session.messages.length > 0 || Boolean(session.acpSessionId) || Boolean(session.acpByProvider),
  );
  const onboardingCompleted = data.onboardingCompleted === true || hasHistory;
  const selectedProviderId = data.selectedProviderId || (onboardingCompleted ? "cursor" : "");
  const sessions = data.sessions
    .map(hydrateSession)
    .map((session) => (selectedProviderId ? migrateSessionBindings(session, selectedProviderId) : session));
  const selectedId = sessions.some((session) => session.id === data.selectedId)
    ? data.selectedId
    : (sessions[0]?.id ?? "");
  const selectedModelByProvider = data.selectedModelByProvider ?? {};
  const selectedModelId =
    (selectedProviderId && selectedModelByProvider[selectedProviderId]) || data.selectedModelId || "";
  return {
    locale: data.locale === "zh" || data.locale === "en" ? data.locale : (readCachedLocale() ?? "en"),
    theme: isThemePreference(data.theme) ? data.theme : (readCachedTheme() ?? "dark"),
    selectedId,
    selectedModelId,
    selectedModelByProvider,
    agentMode: isAgentMode(data.agentMode) ? data.agentMode : "ask",
    selectedProviderId,
    onboardingCompleted,
    sessionsOpen: data.sessionsOpen === true,
    sessionDrawerWidth: clampSessionDrawerWidth(data.sessionDrawerWidth ?? SESSION_DRAWER_DEFAULT),
    sessions,
  };
}

export async function saveState(state: {
  locale: Locale;
  theme: ThemePreference;
  selectedId: string;
  selectedModelId: string;
  selectedModelByProvider: Record<string, string>;
  agentMode: AgentMode;
  selectedProviderId: string;
  onboardingCompleted: boolean;
  sessionsOpen: boolean;
  sessionDrawerWidth: number;
  sessions: Session[];
}): Promise<void> {
  const payload: PersistedState = {
    version: 1,
    locale: state.locale,
    theme: state.theme,
    selectedId: state.selectedId,
    selectedModelId: state.selectedModelId,
    selectedModelByProvider: state.selectedModelByProvider,
    agentMode: state.agentMode,
    selectedProviderId: state.selectedProviderId || undefined,
    onboardingCompleted: state.onboardingCompleted || undefined,
    sessionsOpen: state.sessionsOpen,
    sessionDrawerWidth: clampSessionDrawerWidth(state.sessionDrawerWidth),
    sessions: state.sessions.map(serializeSession),
  };
  await chrome.storage.local.set({ [STATE_KEY]: payload });
}

export function wrapAttachments(text: string, items: AttachmentItem[]): string {
  const files = items.filter((item) => item.kind !== "element");
  const elements = items.filter((item) => item.kind === "element");
  const parts: string[] = [];
  if (text) parts.push(text);
  if (files.length > 0) {
    parts.push(
      `[Attachments]\nLocal paths. Read these files or folders if needed.\n${files
        .map((item) => `- ${item.path}`)
        .join("\n")}`,
    );
  }
  if (elements.length > 0) {
    parts.push(
      `[Picked page elements]\nThe user picked these elements on the current browser tab. They want you to inspect and/or operate on them. Use page tools with args.selector set to the exact CSS selector below (or match the same control in browser/interactive.md and use args.index). Do not treat these as files.\n${elements
        .map((item) => `- ${item.path}`)
        .join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

export function wrapUserPrompt(text: string, items: AttachmentItem[]): string {
  const { display, appendix } = wrapUserMentions(text);
  const body = wrapAttachments(display, items);
  return [body, appendix].filter(Boolean).join("\n\n");
}
