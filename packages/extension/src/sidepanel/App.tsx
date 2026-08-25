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
import { useEffect, useMemo, useRef, useState } from "react";
import { applyAcpUpdate, createUserMessage } from "./acp-messages";
import { connectSidebar } from "./bridge";
import type { ChatMessage, PermissionRequest, PlanPrompt, QuestionPrompt, TodoItem } from "./chat-types";
import { ChatPane } from "./components/ChatPane";
import { Header } from "./components/Header";
import { PermissionBar } from "./components/PermissionBar";
import { SessionDrawer } from "./components/SessionDrawer";
import type { Locale } from "./i18n";
import { t } from "./i18n";
import {
  buildForkContext,
  emptySession,
  loadState,
  saveState,
  titleFromMessages,
  wrapAttachments,
  wrapForkContext,
  type Session,
} from "./persist";

export function App() {
  const [hydrated, setHydrated] = useState(false);
  const [locale, setLocale] = useState<Locale>("en");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [models, setModels] = useState<AgentModel[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<CurrentPage>();
  const [isRunning, setIsRunning] = useState(false);
  const [permission, setPermission] = useState<PermissionRequest>();
  const [question, setQuestion] = useState<QuestionPrompt>();
  const [plan, setPlan] = useState<PlanPrompt>();
  const [activity, setActivity] = useState<{ command: BrowserCommand; result?: BrowserResult }>();
  const [pickingElement, setPickingElement] = useState(false);

  const sendRef = useRef<(msg: ExtToHost) => void>(() => undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const pageRef = useRef<CurrentPage | undefined>(undefined);
  const statusRef = useRef(status);
  const selectedIdRef = useRef(selectedId);
  const sessionsRef = useRef(sessions);
  const pendingBind = useRef<{ localId: string; kind: "new" | "use" | "fork" } | null>(null);
  const boundRef = useRef(false);
  const localeRef = useRef(locale);
  const selectedModelRef = useRef(selectedModelId);
  const pickWaiters = useRef(new Map<string, (items: AttachmentItem[]) => void>());
  const appliedModelRef = useRef("");
  const elementPickId = useRef("");
  pageRef.current = page;
  statusRef.current = status;
  selectedIdRef.current = selectedId;
  sessionsRef.current = sessions;
  localeRef.current = locale;
  selectedModelRef.current = selectedModelId;

  const tryBindCurrent = () => {
    if (statusRef.current !== "ready") return;
    if (pendingBind.current || boundRef.current) return;
    const list = sessionsRef.current;
    const id = selectedIdRef.current || list[0]?.id;
    const session = list.find((item) => item.id === id);
    if (!session) return;
    if (session.acpSessionId) {
      pendingBind.current = { localId: session.id, kind: "use" };
      sendRef.current({ type: "session.use", sessionId: session.acpSessionId });
    } else {
      pendingBind.current = { localId: session.id, kind: "new" };
      sendRef.current({ type: "session.new" });
    }
    boundRef.current = true;
  };

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [sessions, selectedId],
  );

  const patchSession = (id: string, updater: (session: Session) => Session) => {
    setSessions((current) => current.map((session) => (session.id === id ? updater(session) : session)));
  };

  const updateSelectedMessages = (updater: (messages: ChatMessage[]) => ChatMessage[]) => {
    const id = selectedIdRef.current;
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

  const handleHost = (msg: HostToExt) => {
    if (msg.type === "status") {
      setStatus(msg.state);
      setError(msg.error);
      if (msg.state === "error") setIsRunning(false);
      if (msg.state !== "ready") appliedModelRef.current = "";
      if (msg.state === "ready") tryBindCurrent();
      return;
    }
    if (msg.type === "session") {
      const pending = pendingBind.current;
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
        boundRef.current = true;
      }
      pendingBind.current = null;
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
      const known = incoming.some((model) => model.id === desired);
      if (
        desired &&
        desired !== "auto" &&
        known &&
        desired !== msg.currentId &&
        desired !== appliedModelRef.current
      ) {
        appliedModelRef.current = desired;
        sendRef.current({ type: "model.set", modelId: desired });
      } else if (!desired || !known) {
        setSelectedModelId(msg.currentId || incoming[0]?.id || "");
      }
      return;
    }
    if (msg.type === "fs.picked" || msg.type === "page.picked") {
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
      updateSelectedMessages((current) => applyAcpUpdate(current, msg.update));
      return;
    }
    if (msg.type === "turn.end") {
      setIsRunning(false);
      if (msg.stopReason === "error") setError(t(localeRef.current, "turnError"));
      return;
    }
    if (msg.type === "permission") {
      const toolCall = msg.params.toolCall as { title?: string } | undefined;
      const options = (msg.params.options as PermissionRequest["options"]) ?? [];
      setPermission({
        id: msg.id,
        title: toolCall?.title ?? t(localeRef.current, "wantsTool"),
        options,
      });
      return;
    }
    if (msg.type === "cursor") {
      if (msg.method === "cursor/update_todos") {
        const incoming = (msg.params.todos as TodoItem[]) ?? [];
        const merge = Boolean(msg.params.merge);
        const id = selectedIdRef.current;
        patchSession(id, (session) => ({
          ...session,
          todos: merge ? mergeTodos(session.todos, incoming) : incoming,
        }));
        return;
      }
      if (msg.method === "cursor/ask_question" && msg.id !== undefined) {
        setQuestion({
          id: msg.id,
          title: msg.params.title as string | undefined,
          questions: (msg.params.questions as QuestionPrompt["questions"]) ?? [],
        });
        return;
      }
      if (msg.method === "cursor/create_plan" && msg.id !== undefined) {
        setPlan({
          id: msg.id,
          name: msg.params.name as string | undefined,
          overview: msg.params.overview as string | undefined,
          plan: String(msg.params.plan ?? ""),
        });
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
      setLocale(state.locale);
      setSessions(sessions);
      setSelectedId(selectedId);
      setSelectedModelId(state.selectedModelId);
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  useEffect(() => {
    if (!hydrated) return;
    void saveState({ locale, selectedId, selectedModelId, sessions });
  }, [hydrated, locale, selectedId, selectedModelId, sessions]);

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
    const user = createUserMessage(text, attachments);
    updateSelectedMessages((current) => [...current, user]);
    if (statusRef.current !== "ready") {
      setError(t(locale, "offlineSend"));
      setStatus("error");
      setIsRunning(false);
      return;
    }
    const context = session?.pendingForkContext;
    if (context) {
      patchSession(session.id, (item) => ({ ...item, pendingForkContext: undefined }));
    }
    const body = wrapAttachments(text, attachments);
    setIsRunning(true);
    setError(undefined);
    sendRef.current({
      type: "prompt",
      text: context ? `${wrapForkContext(context)}\n\n${body}` : body,
      sessionId: session?.acpSessionId,
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
    if (statusRef.current === "ready" && modelId !== "auto") {
      sendRef.current({ type: "model.set", modelId });
    }
  };

  const onCancel = () => {
    sendRef.current({ type: "cancel" });
    setIsRunning(false);
  };

  const switchSession = (id: string) => {
    if (isRunning) return;
    if (id === selectedIdRef.current) return;
    boundRef.current = false;
    setSelectedId(id);
    setPermission(undefined);
    setQuestion(undefined);
    setPlan(undefined);
    const session = sessionsRef.current.find((item) => item.id === id);
    if (!session) return;
    if (session.acpSessionId) {
      pendingBind.current = { localId: id, kind: "use" };
      sendRef.current({ type: "session.use", sessionId: session.acpSessionId });
      boundRef.current = true;
    } else if (statusRef.current === "ready") {
      pendingBind.current = { localId: id, kind: "new" };
      sendRef.current({ type: "session.new" });
      boundRef.current = true;
    }
  };

  const renameSession = (id: string, title: string) => {
    if (isRunning) return;
    patchSession(id, (session) => ({
      ...session,
      title: title.trim(),
      titleManual: true,
      updatedAt: new Date().toISOString(),
    }));
  };

  const deleteSession = (id: string) => {
    if (isRunning) return;
    const remaining = sessionsRef.current.filter((session) => session.id !== id);
    if (remaining.length > 0) {
      setSessions(remaining);
      if (selectedIdRef.current === id) switchSession(remaining[0].id);
      return;
    }
    const created = emptySession();
    setSessions([created]);
    boundRef.current = false;
    setSelectedId(created.id);
    if (statusRef.current === "ready") {
      pendingBind.current = { localId: created.id, kind: "new" };
      sendRef.current({ type: "session.new" });
      boundRef.current = true;
    }
  };

  const newSession = () => {
    if (isRunning) return;
    const created = emptySession();
    setSessions((current) => [created, ...current]);
    boundRef.current = false;
    setSelectedId(created.id);
    setSessionsOpen(true);
    if (statusRef.current === "ready") {
      pendingBind.current = { localId: created.id, kind: "new" };
      sendRef.current({ type: "session.new" });
      boundRef.current = true;
    }
  };

  const forkFromMessage = (messageId: string) => {
    if (isRunning) return;
    const source = sessionsRef.current.find((item) => item.id === selectedIdRef.current);
    if (!source) return;
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
    boundRef.current = false;
    setSelectedId(created.id);
    setSessionsOpen(true);
    if (statusRef.current !== "ready") return;
    if (atTip && source.acpSessionId) {
      pendingBind.current = { localId: created.id, kind: "fork" };
      sendRef.current({ type: "session.fork", sessionId: source.acpSessionId });
    } else {
      pendingBind.current = { localId: created.id, kind: "new" };
      sendRef.current({ type: "session.new" });
    }
    boundRef.current = true;
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
        todos={selected.todos}
        activity={activity}
        sessionTitle={selected.title || t(locale, "untitled")}
        sessionsOpen={sessionsOpen}
        onLocale={setLocale}
        onToggleSessions={() => setSessionsOpen((open) => !open)}
        onRetry={() => {
          boundRef.current = false;
          setStatus("starting");
          setError(t(locale, "reconnecting"));
          reconnectRef.current();
        }}
      />
      <div className="flex min-h-0 flex-1">
        {sessionsOpen ? (
          <SessionDrawer
            locale={locale}
            sessions={sessions}
            selectedId={selected.id}
            locked={isRunning}
            onSelect={switchSession}
            onNew={newSession}
            onRename={renameSession}
            onDelete={deleteSession}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <ChatPane
              locale={locale}
              messages={selected.messages}
              isRunning={isRunning}
              pickingElement={pickingElement}
              models={models}
              modelId={selectedModelId}
              showModelPicker={status === "ready" && models.length > 0}
              onSend={onSend}
              onCancel={onCancel}
              onFork={forkFromMessage}
              onPickAttachments={onPickAttachments}
              onPickElement={onPickElement}
              onCancelElementPick={onCancelElementPick}
              onModel={onModel}
            />
          </div>
          <PermissionBar
            locale={locale}
            permission={permission}
            question={question}
            plan={plan}
            onPermission={(optionId) => {
              if (!permission) return;
              sendRef.current({
                type: "permission.reply",
                id: permission.id,
                outcome: { outcome: "selected", optionId },
              });
              setPermission(undefined);
            }}
            onQuestion={(answers) => {
              if (!question) return;
              sendRef.current({
                type: "cursor.reply",
                id: question.id,
                result: { outcome: { outcome: "answered", answers } },
              });
              setQuestion(undefined);
            }}
            onPlan={(accepted) => {
              if (!plan) return;
              sendRef.current({
                type: "cursor.reply",
                id: plan.id,
                result: accepted
                  ? { outcome: { outcome: "accepted" } }
                  : { outcome: { outcome: "rejected", reason: "User rejected the plan" } },
              });
              setPlan(undefined);
            }}
          />
        </div>
      </div>
      {pickingElement ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-[rgba(8,9,6,0.55)] px-5 backdrop-blur-md">
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
