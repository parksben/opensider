import type {
  AgentModel,
  AttachmentItem,
  BrowserCommand,
  BrowserResult,
  CurrentPage,
  ExtToHost,
  HostToExt,
} from "@shared";
import { MousePointer2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { encodeImageBlob } from "../image-encode";
import { applyAcpUpdate, createUserMessage } from "./acp-messages";
import { connectSidebar } from "./bridge";
import type { ChatMessage, PermissionRequest, PlanPrompt, QuestionPrompt, TodoItem } from "./chat-types";
import { ChatPane } from "./components/ChatPane";
import { Header } from "./components/Header";
import { PermissionBar } from "./components/PermissionBar";
import { SessionModal } from "./components/SessionModal";
import { applyLocale, readCachedLocale, t, type Locale } from "./i18n";
import {
  applyResolvedTheme,
  resolveTheme,
  watchSystemTheme,
  applyThemePreference,
  readCachedTheme,
  type ThemePreference,
} from "./theme";
import {
  buildForkContext,
  autoPermissionOptionId,
  emptySession,
  loadState,
  saveState,
  titleFromMessages,
  wrapAttachments,
  wrapForkContext,
  textOf,
  type AgentMode,
  type Session,
} from "./persist";

export function App() {
  const [hydrated, setHydrated] = useState(false);
  const [locale, setLocale] = useState<Locale>(() => readCachedLocale() ?? "en");
  const [theme, setTheme] = useState<ThemePreference>(() => readCachedTheme() ?? "dark");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [agentMode, setAgentMode] = useState<AgentMode>("ask");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<CurrentPage>();
  const [runningIds, setRunningIds] = useState<string[]>([]);
  const [permissions, setPermissions] = useState<Record<string, PermissionRequest>>({});
  const [questions, setQuestions] = useState<Record<string, QuestionPrompt>>({});
  const [plans, setPlans] = useState<Record<string, PlanPrompt>>({});
  const [activity, setActivity] = useState<{ command: BrowserCommand; result?: BrowserResult }>();
  const [pickingElement, setPickingElement] = useState(false);

  const sendRef = useRef<(msg: ExtToHost) => void>(() => undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const pageRef = useRef<CurrentPage | undefined>(undefined);
  const statusRef = useRef(status);
  const selectedIdRef = useRef(selectedId);
  const sessionsRef = useRef(sessions);
  const pendingBinds = useRef<Array<{ localId: string; kind: "new" | "use" | "fork" }>>([]);
  const pendingRegen = useRef<{
    localId: string;
    text: string;
    attachments: AttachmentItem[];
    context?: string;
  } | null>(null);
  const localeRef = useRef(locale);
  const selectedModelRef = useRef(selectedModelId);
  const agentModeRef = useRef(agentMode);
  const pickWaiters = useRef(new Map<string, (items: AttachmentItem[]) => void>());
  const appliedModelRef = useRef("");
  const elementPickId = useRef("");
  const runningIdsRef = useRef<Set<string>>(new Set());
  const turnStartedAt = useRef(new Map<string, number>());
  pageRef.current = page;
  statusRef.current = status;
  selectedIdRef.current = selectedId;
  sessionsRef.current = sessions;
  localeRef.current = locale;
  selectedModelRef.current = selectedModelId;
  agentModeRef.current = agentMode;

  const enqueueBind = (item: { localId: string; kind: "new" | "use" | "fork" }) => {
    pendingBinds.current.push(item);
  };

  const tryBindCurrent = () => {
    if (statusRef.current !== "ready") return;
    if (pendingBinds.current.length > 0) return;
    const list = sessionsRef.current;
    const id = selectedIdRef.current || list[0]?.id;
    const session = list.find((item) => item.id === id);
    if (!session) return;
    if (runningIdsRef.current.has(session.id)) return;
    if (session.acpSessionId) {
      enqueueBind({ localId: session.id, kind: "use" });
      sendRef.current({ type: "session.use", sessionId: session.acpSessionId });
    } else {
      enqueueBind({ localId: session.id, kind: "new" });
      sendRef.current({ type: "session.new" });
    }
  };

  const syncRunning = (next: Set<string>) => {
    runningIdsRef.current = next;
    setRunningIds([...next]);
  };

  const localIdForAcp = (acpId?: string) => {
    if (acpId) {
      const found = sessionsRef.current.find((item) => item.acpSessionId === acpId);
      if (found) return found.id;
    }
    return selectedIdRef.current;
  };

  const clearHitl = (id: string) => {
    setPermissions((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setQuestions((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setPlans((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId],
  );

  const patchSession = (id: string, updater: (session: Session) => Session) => {
    setSessions((current) => current.map((session) => (session.id === id ? updater(session) : session)));
  };

  const beginTurn = (id: string) => {
    turnStartedAt.current.set(id, Date.now());
    const next = new Set(runningIdsRef.current);
    next.add(id);
    syncRunning(next);
  };

  const replyPermission = (id: number, options: PermissionRequest["options"]): boolean => {
    const optionId = autoPermissionOptionId(options);
    if (!optionId) return false;
    sendRef.current({
      type: "permission.reply",
      id,
      outcome: { outcome: "selected", optionId },
    });
    return true;
  };

  const updateSessionMessages = (id: string, updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    setSessions((current) =>
      current.map((session) => {
        if (session.id !== id) return session;
        const messages = updater(session.messages);
        return {
          ...session,
          messages,
          title: session.titleManual ? session.title : titleFromMessages(messages) || session.title,
          updatedAt: new Date().toISOString(),
        };
      }),
    );
  };

  const finishTurn = (id?: string) => {
    const target = id ?? selectedIdRef.current;
    if (!target) return;
    const started = turnStartedAt.current.get(target);
    turnStartedAt.current.delete(target);
    if (!runningIdsRef.current.has(target) && started == null) return;
    const next = new Set(runningIdsRef.current);
    next.delete(target);
    syncRunning(next);
    if (started == null) return;
    const durationMs = Math.max(0, Date.now() - started);
    updateSessionMessages(target, (messages) => {
      const last = messages[messages.length - 1];
      if (last?.role !== "assistant" || last.durationMs != null) return messages;
      if (last.createdAt.getTime() < started - 2000) return messages;
      return [...messages.slice(0, -1), { ...last, durationMs }];
    });
  };

  const finishAllTurns = () => {
    for (const id of [...runningIdsRef.current]) finishTurn(id);
  };

  const handleHost = (msg: HostToExt) => {
    if (msg.type === "status") {
      setStatus(msg.state);
      setError(msg.error);
      if (msg.state === "error") {
        pendingRegen.current = null;
        pendingBinds.current = [];
        finishAllTurns();
      }
      if (msg.state !== "ready") appliedModelRef.current = "";
      if (msg.state === "ready") tryBindCurrent();
      return;
    }
    if (msg.type === "session") {
      const pending = pendingBinds.current.shift();
      const current = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
      const targetId = pending?.localId ?? (current && !current.acpSessionId ? current.id : undefined);
      if (targetId) {
        patchSession(targetId, (session) => ({
          ...session,
          acpSessionId: msg.sessionId,
          pendingForkContext:
            pending?.kind === "fork" && msg.forked === false
              ? (session.pendingForkContext ?? buildForkContext(session.messages))
              : session.pendingForkContext,
        }));
      }
      const regen = pendingRegen.current;
      if (regen && regen.localId === targetId) {
        pendingRegen.current = null;
        const body = wrapAttachments(regen.text, regen.attachments);
        beginTurn(regen.localId);
        setError(undefined);
        sendRef.current({
          type: "prompt",
          text: regen.context ? `${wrapForkContext(regen.context)}\n\n${body}` : body,
          sessionId: msg.sessionId,
          currentPage: pageRef.current
            ? { title: pageRef.current.title, url: pageRef.current.url }
            : undefined,
        });
      }
      return;
    }
    if (msg.type === "page") {
      setPage(msg.page);
      return;
    }
    if (msg.type === "models") {
      const incoming = msg.models.filter((model, index, all) => all.findIndex((item) => item.id === model.id) === index);
      setModels(incoming);
      const desired = selectedModelRef.current;
      const autoId = incoming.find((model) => model.id === "auto")?.id;
      const known = incoming.some((model) => model.id === desired);
      if (desired && desired !== "auto" && known) {
        if (desired !== msg.currentId && desired !== appliedModelRef.current) {
          appliedModelRef.current = desired;
          sendRef.current({ type: "model.set", modelId: desired });
        }
      } else {
        setSelectedModelId(autoId || msg.currentId || incoming[0]?.id || "");
      }
      return;
    }
    if (msg.type === "fs.picked" || msg.type === "fs.saved" || msg.type === "page.picked") {
      const waiter = pickWaiters.current.get(msg.requestId);
      pickWaiters.current.delete(msg.requestId);
      if (msg.type === "page.picked") setPickingElement(false);
      if (msg.error === "restricted") setError(t(localeRef.current, "pickPageFailed"));
      else if (msg.error) setError(msg.error);
      waiter?.(msg.items ?? []);
      return;
    }
    if (msg.type === "browser.command") {
      setActivity({ command: msg.command });
      return;
    }
    if (msg.type === "browser.result") {
      setActivity((current) =>
        current && current.command.id === msg.result.id
          ? { command: current.command, result: msg.result }
          : { command: { id: msg.result.id, method: msg.result.method }, result: msg.result },
      );
      return;
    }
    if (msg.type === "update") {
      const localId = localIdForAcp(msg.sessionId);
      if (!localId) return;
      if (!runningIdsRef.current.has(localId)) {
        const session = sessionsRef.current.find((item) => item.id === localId);
        const last = session?.messages[session.messages.length - 1];
        const live = last?.role === "assistant" && last.durationMs == null;
        if (!live) return;
      }
      const modelId = selectedModelRef.current;
      const modelName =
        models.find((item) => item.id === modelId)?.name ||
        (!modelId || modelId === "auto" ? "Auto" : modelId);
      updateSessionMessages(localId, (current) => applyAcpUpdate(current, msg.update, { modelId, modelName }));
      return;
    }
    if (msg.type === "turn.end") {
      const localId = localIdForAcp(msg.sessionId);
      finishTurn(localId);
      if (msg.stopReason === "error" && localId === selectedIdRef.current) {
        setError(t(localeRef.current, "turnError"));
      }
      return;
    }
    if (msg.type === "permission") {
      const localId = localIdForAcp(msg.sessionId);
      if (!localId) return;
      const toolCall = msg.params.toolCall as { title?: string } | undefined;
      const options = (msg.params.options as PermissionRequest["options"]) ?? [];
      if (agentModeRef.current === "auto" && replyPermission(msg.id, options)) {
        setPermissions((current) => {
          if (!(localId in current)) return current;
          const next = { ...current };
          delete next[localId];
          return next;
        });
        return;
      }
      setPermissions((current) => ({
        ...current,
        [localId]: {
          id: msg.id,
          title: toolCall?.title ?? t(localeRef.current, "wantsTool"),
          options,
        },
      }));
      return;
    }
    if (msg.type === "cursor") {
      const localId = localIdForAcp(msg.sessionId);
      if (msg.method === "cursor/update_todos") {
        if (!localId) return;
        const incoming = (msg.params.todos as TodoItem[]) ?? [];
        const merge = Boolean(msg.params.merge);
        patchSession(localId, (session) => ({
          ...session,
          todos: merge ? mergeTodos(session.todos, incoming) : incoming,
        }));
        return;
      }
      if (msg.method === "cursor/ask_question" && msg.id !== undefined && localId) {
        setQuestions((current) => ({
          ...current,
          [localId]: {
            id: msg.id,
            title: msg.params.title as string | undefined,
            questions: (msg.params.questions as QuestionPrompt["questions"]) ?? [],
          },
        }));
        return;
      }
      if (msg.method === "cursor/create_plan" && msg.id !== undefined && localId) {
        setPlans((current) => ({
          ...current,
          [localId]: {
            id: msg.id,
            name: msg.params.name as string | undefined,
            overview: msg.params.overview as string | undefined,
            plan: String(msg.params.plan ?? ""),
          },
        }));
      }
    }
  };

  const handleHostRef = useRef(handleHost);
  handleHostRef.current = handleHost;

  useEffect(() => {
    void loadState().then((state) => {
      const sessions = state.sessions.length > 0 ? state.sessions : [emptySession()];
      const selectedId = sessions.some((session) => session.id === state.selectedId)
        ? state.selectedId
        : sessions[0].id;
      applyLocale(state.locale);
      setLocale(state.locale);
      applyThemePreference(state.theme);
      setTheme(state.theme);
      setSessions(sessions);
      setSelectedId(selectedId);
      setSelectedModelId(state.selectedModelId);
      setAgentMode(state.agentMode);
      setHydrated(true);
    });
  }, []);

  useLayoutEffect(() => {
    applyLocale(locale);
  }, [locale]);

  useEffect(() => {
    if (!hydrated) return;
    void saveState({ locale, theme, selectedId, selectedModelId, agentMode, sessions });
  }, [hydrated, locale, theme, selectedId, selectedModelId, agentMode, sessions]);

  useLayoutEffect(() => {
    applyThemePreference(theme);
    if (theme !== "system") return;
    return watchSystemTheme(() => applyResolvedTheme(resolveTheme("system")));
  }, [theme]);

  useEffect(() => {
    const { send, reconnect, disconnect } = connectSidebar((msg) => handleHostRef.current(msg));
    sendRef.current = send;
    reconnectRef.current = reconnect;
    return () => {
      sendRef.current = () => undefined;
      reconnectRef.current = () => undefined;
      disconnect();
    };
  }, []);

  useEffect(() => {
    if (hydrated) tryBindCurrent();
  }, [hydrated, selectedId]);

  const onSend = (text: string, attachments: AttachmentItem[] = []) => {
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    const localId = session?.id ?? selectedIdRef.current;
    if (!localId) return;
    const user = createUserMessage(text, attachments);
    updateSessionMessages(localId, (current) => [...current, user]);
    if (statusRef.current !== "ready") {
      setError(t(locale, "offlineSend"));
      setStatus("error");
      return;
    }
    const context = session?.pendingForkContext;
    if (context && session) {
      patchSession(session.id, (item) => ({ ...item, pendingForkContext: undefined }));
    }
    const body = wrapAttachments(text, attachments);
    beginTurn(localId);
    setError(undefined);
    if (!session?.acpSessionId) {
      pendingRegen.current = { localId, text, attachments, context };
      if (pendingBinds.current.every((item) => item.localId !== localId)) {
        enqueueBind({ localId, kind: "new" });
        sendRef.current({ type: "session.new" });
      }
      return;
    }
    sendRef.current({
      type: "prompt",
      text: context ? `${wrapForkContext(context)}\n\n${body}` : body,
      sessionId: session.acpSessionId,
      currentPage: pageRef.current
        ? { title: pageRef.current.title, url: pageRef.current.url }
        : undefined,
    });
  };

  const onPickAttachments = () =>
    new Promise<AttachmentItem[]>((resolve) => {
      if (statusRef.current !== "ready") {
        setError(t(localeRef.current, "pickFailed"));
        resolve([]);
        return;
      }
      const requestId = crypto.randomUUID();
      pickWaiters.current.set(requestId, resolve);
      sendRef.current({ type: "fs.pick", requestId });
    });

  const onPasteImages = async (files: File[]) => {
    if (statusRef.current !== "ready") {
      setError(t(localeRef.current, "pasteFailed"));
      return [] as AttachmentItem[];
    }
    const items: AttachmentItem[] = [];
    for (const [index, file] of files.entries()) {
      try {
        const payload = await encodeImageBlob(file);
        const saved = await new Promise<AttachmentItem[]>((resolve) => {
          const requestId = crypto.randomUUID();
          pickWaiters.current.set(requestId, resolve);
          sendRef.current({
            type: "fs.save",
            requestId,
            name: `paste-${Date.now()}-${index}.jpg`,
            imageBase64: payload.imageBase64,
            mime: "image/jpeg",
          });
        });
        items.push(...saved);
      } catch (error) {
        setError(error instanceof Error ? error.message : t(localeRef.current, "pasteFailed"));
      }
    }
    return items;
  };

  const onPickElement = () =>
    new Promise<AttachmentItem[]>((resolve) => {
      const requestId = crypto.randomUUID();
      elementPickId.current = requestId;
      setPickingElement(true);
      pickWaiters.current.set(requestId, resolve);
      sendRef.current({
        type: "page.pick",
        requestId,
        hint: `${t(localeRef.current, "pickHint")} · ${t(localeRef.current, "pickHintDetail")}`,
      });
    });

  const onCancelElementPick = () => {
    const requestId = elementPickId.current;
    sendRef.current({ type: "page.pick.cancel", requestId });
    const waiter = pickWaiters.current.get(requestId);
    pickWaiters.current.delete(requestId);
    setPickingElement(false);
    waiter?.([]);
  };

  useEffect(() => {
    if (!pickingElement) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onCancelElementPick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickingElement]);

  const onModel = (modelId: string) => {
    setSelectedModelId(modelId);
    appliedModelRef.current = modelId;
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (statusRef.current === "ready" && modelId !== "auto") {
      sendRef.current({ type: "model.set", modelId, sessionId: session?.acpSessionId });
    }
  };

  const onCancel = () => {
    const session = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    sendRef.current({ type: "cancel", sessionId: session?.acpSessionId });
    if (session) finishTurn(session.id);
  };

  const switchSession = (id: string) => {
    if (id === selectedIdRef.current) return;
    setSelectedId(id);
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;
    if (runningIdsRef.current.has(id)) return;
    if (session.acpSessionId) {
      enqueueBind({ localId: id, kind: "use" });
      sendRef.current({ type: "session.use", sessionId: session.acpSessionId });
    } else if (statusRef.current === "ready") {
      enqueueBind({ localId: id, kind: "new" });
      sendRef.current({ type: "session.new" });
    }
  };

  const renameSession = (id: string, title: string) => {
    patchSession(id, (session) => ({
      ...session,
      title: title.trim(),
      titleManual: true,
      updatedAt: new Date().toISOString(),
    }));
  };

  const deleteSession = (id: string) => {
    const doomed = sessionsRef.current.find((session) => session.id === id);
    if (doomed && runningIdsRef.current.has(id)) {
      sendRef.current({ type: "cancel", sessionId: doomed.acpSessionId });
      finishTurn(id);
    }
    clearHitl(id);
    pendingBinds.current = pendingBinds.current.filter((item) => item.localId !== id);
    if (pendingRegen.current?.localId === id) pendingRegen.current = null;
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    if (remaining.length > 0) {
      setSessions(remaining);
      if (selectedIdRef.current === id) switchSession(remaining[0].id);
      return;
    }
    const created = emptySession();
    setSessions([created]);
    setSelectedId(created.id);
    if (statusRef.current === "ready") {
      enqueueBind({ localId: created.id, kind: "new" });
      sendRef.current({ type: "session.new" });
    }
  };

  const newSession = () => {
    const created = emptySession();
    setSessions((current) => [created, ...current]);
    setSelectedId(created.id);
    setSessionsOpen(true);
    if (statusRef.current === "ready") {
      enqueueBind({ localId: created.id, kind: "new" });
      sendRef.current({ type: "session.new" });
    }
  };

  const sessionBusy = (id: string) => runningIdsRef.current.has(id);

  const forkFromMessage = (messageId: string) => {
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source || sessionBusy(source.id)) return;
    const index = source.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const sliced = source.messages.slice(0, index + 1).map((message) => ({
      ...message,
      content: message.content.map((part) => ({ ...part })),
    }));
    const atTip = index === source.messages.length - 1;
    const created = emptySession({
      parentId: source.id,
      forkedFromMessageId: messageId,
      messages: sliced,
      title: titleFromMessages(sliced),
      pendingForkContext: atTip ? undefined : buildForkContext(sliced),
    });
    setSessions((current) => [created, ...current]);
    setSelectedId(created.id);
    setSessionsOpen(true);
    if (statusRef.current !== "ready") return;
    if (atTip && source.acpSessionId) {
      enqueueBind({ localId: created.id, kind: "fork" });
      sendRef.current({ type: "session.fork", sessionId: source.acpSessionId });
    } else {
      enqueueBind({ localId: created.id, kind: "new" });
      sendRef.current({ type: "session.new" });
    }
  };

  const startReplayTurn = (source: Session, userIndex: number, user: ChatMessage) => {
    const kept = [...source.messages.slice(0, userIndex), user];
    const prior = source.messages.slice(0, userIndex);
    pendingRegen.current = {
      localId: source.id,
      text: textOf(user.content),
      attachments: user.attachments ?? [],
      context: prior.length > 0 ? buildForkContext(prior) : undefined,
    };
    patchSession(source.id, (session) => ({
      ...session,
      acpSessionId: undefined,
      pendingForkContext: undefined,
      messages: kept,
      todos: [],
      title: session.titleManual ? session.title : titleFromMessages(kept) || session.title,
      updatedAt: new Date().toISOString(),
    }));
    clearHitl(source.id);
    if (statusRef.current !== "ready") {
      pendingRegen.current = null;
      setError(t(localeRef.current, "offlineSend"));
      setStatus("error");
      return;
    }
    appliedModelRef.current = "";
    enqueueBind({ localId: source.id, kind: "new" });
    beginTurn(source.id);
    setError(undefined);
    sendRef.current({ type: "session.new" });
  };

  const regenerateFromMessage = (messageId: string) => {
    if (sessionBusy(selectedIdRef.current)) return;
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source) return;
    const assistantIndex = source.messages.findIndex((message) => message.id === messageId);
    if (assistantIndex < 0 || source.messages[assistantIndex]?.role !== "assistant") return;
    let userIndex = -1;
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (source.messages[index].role === "user") {
        userIndex = index;
        break;
      }
    }
    if (userIndex < 0) return;
    startReplayTurn(source, userIndex, source.messages[userIndex]);
  };

  const reviseFromMessage = (messageId: string, text: string, attachments: AttachmentItem[]) => {
    if (sessionBusy(selectedIdRef.current)) return;
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source) return;
    const userIndex = source.messages.findIndex((message) => message.id === messageId);
    if (userIndex < 0 || source.messages[userIndex]?.role !== "user") return;
    const previous = source.messages[userIndex];
    startReplayTurn(source, userIndex, {
      ...previous,
      content: [{ type: "text", text }],
      attachments: attachments.length > 0 ? attachments : undefined,
    });
  };

  if (!hydrated || !selected) {
    return <div className="h-full bg-[var(--ink)]" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        locale={locale}
        status={status}
        error={error}
        page={page}
        activity={activity}
        sessionTitle={selected.title || t(locale, "untitled")}
        sessionsOpen={sessionsOpen}
        theme={theme}
        onLocale={(next) => {
          applyLocale(next);
          setLocale(next);
        }}
        onTheme={(next) => {
          applyThemePreference(next);
          setTheme(next);
        }}
        onToggleSessions={() => setSessionsOpen((open) => !open)}
        onRetry={() => {
          pendingBinds.current = [];
          setStatus("starting");
          setError(t(locale, "reconnecting"));
          reconnectRef.current();
        }}
      />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ChatPane
              locale={locale}
              sessionId={selected.id}
              messages={selected.messages}
              isRunning={runningIds.includes(selected.id)}
              pickingElement={pickingElement}
              models={models}
              modelId={selectedModelId}
              showModelPicker={status === "ready" && models.length > 0}
              onSend={onSend}
              onRevise={reviseFromMessage}
              onCancel={onCancel}
              onFork={forkFromMessage}
              onRegenerate={regenerateFromMessage}
              onPickAttachments={onPickAttachments}
              onPasteImages={onPasteImages}
              onPickElement={onPickElement}
              onCancelElementPick={onCancelElementPick}
              onModel={onModel}
              agentMode={agentMode}
              onAgentMode={(mode) => {
                setAgentMode(mode);
                if (mode !== "auto") return;
                setPermissions((current) => {
                  const kept: Record<string, PermissionRequest> = {};
                  for (const [id, request] of Object.entries(current)) {
                    if (!replyPermission(request.id, request.options)) kept[id] = request;
                  }
                  return kept;
                });
              }}
              page={page}
              todos={selected.todos}
              hitl={
                <PermissionBar
                  locale={locale}
                  permission={permissions[selected.id]}
                  question={questions[selected.id]}
                  plan={plans[selected.id]}
                  onPermission={(optionId) => {
                    const current = permissions[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "permission.reply",
                      id: current.id,
                      outcome: { outcome: "selected", optionId },
                    });
                    setPermissions((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                  onQuestion={(answers) => {
                    const current = questions[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "cursor.reply",
                      id: current.id,
                      result: { outcome: { outcome: "answered", answers } },
                    });
                    setQuestions((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                  page={page}
                  onPlan={(accepted) => {
                    const current = plans[selected.id];
                    if (!current) return;
                    sendRef.current({
                      type: "cursor.reply",
                      id: current.id,
                      result: accepted
                        ? { outcome: { outcome: "accepted" } }
                        : { outcome: { outcome: "rejected", reason: "User rejected the plan" } },
                    });
                    setPlans((items) => {
                      const next = { ...items };
                      delete next[selected.id];
                      return next;
                    });
                  }}
                />
              }
            />
          </div>
        </div>
      </div>
      {sessionsOpen ? (
        <SessionModal
          locale={locale}
          sessions={sessions}
          selectedId={selected.id}
          runningIds={runningIds}
          onSelect={(id) => {
            switchSession(id);
            setSessionsOpen(false);
          }}
          onNew={() => {
            newSession();
            setSessionsOpen(false);
          }}
          onRename={renameSession}
          onDelete={deleteSession}
          onClose={() => setSessionsOpen(false)}
        />
      ) : null}
      {pickingElement ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[var(--overlay)] px-5 backdrop-blur-md">
          <div className="flex max-w-[17rem] flex-col items-center gap-2.5 rounded-2xl border border-[var(--line)] bg-[var(--panel)]/92 px-5 py-4 text-center shadow-2xl">
            <MousePointer2 size={26} className="text-[var(--brass)]" />
            <p className="text-[13px] leading-relaxed text-[var(--text)]">{t(locale, "pickHint")}</p>
            <p className="text-[11px] text-[var(--muted)]">{t(locale, "pickHintDetail")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function mergeTodos(current: TodoItem[], incoming: TodoItem[]): TodoItem[] {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}
