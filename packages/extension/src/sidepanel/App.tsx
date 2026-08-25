import type { BrowserCommand, BrowserResult, CurrentPage, ExtToHost, HostToExt } from "@shared";
import { useEffect, useRef, useState } from "react";
import { applyAcpUpdate, createUserMessage } from "./acp-messages";
import { connectSidebar } from "./bridge";
import type { ChatMessage, PermissionRequest, PlanPrompt, QuestionPrompt, TodoItem } from "./chat-types";
import { ChatPane } from "./components/ChatPane";
import { Header } from "./components/Header";
import { PermissionBar } from "./components/PermissionBar";

export function App() {
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string>();
  const [page, setPage] = useState<CurrentPage>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [permission, setPermission] = useState<PermissionRequest>();
  const [question, setQuestion] = useState<QuestionPrompt>();
  const [plan, setPlan] = useState<PlanPrompt>();
  const [activity, setActivity] = useState<{ command: BrowserCommand; result?: BrowserResult }>();
  const sendRef = useRef<(msg: ExtToHost) => void>(() => undefined);
  const reconnectRef = useRef<() => void>(() => undefined);
  const pageRef = useRef<CurrentPage | undefined>(undefined);
  const statusRef = useRef(status);
  pageRef.current = page;
  statusRef.current = status;

  const handleHost = (msg: HostToExt) => {
    if (msg.type === "status") {
      setStatus(msg.state);
      setError(msg.error);
      if (msg.state === "error") setIsRunning(false);
      return;
    }
    if (msg.type === "page") {
      setPage(msg.page);
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
      setMessages((current) => applyAcpUpdate(current, msg.update));
      return;
    }
    if (msg.type === "turn.end") {
      setIsRunning(false);
      if (msg.stopReason === "error") {
        setError("The agent turn ended with an error.");
      }
      return;
    }
    if (msg.type === "permission") {
      const toolCall = msg.params.toolCall as { title?: string } | undefined;
      const options = (msg.params.options as PermissionRequest["options"]) ?? [];
      setPermission({
        id: msg.id,
        title: toolCall?.title ?? "Permission required",
        options,
      });
      return;
    }
    if (msg.type === "cursor") {
      if (msg.method === "cursor/update_todos") {
        const incoming = (msg.params.todos as TodoItem[]) ?? [];
        const merge = Boolean(msg.params.merge);
        setTodos((current) => (merge ? mergeTodos(current, incoming) : incoming));
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
    const { send, reconnect, disconnect } = connectSidebar((msg) => handleHostRef.current(msg));
    sendRef.current = send;
    reconnectRef.current = reconnect;
    return () => {
      sendRef.current = () => undefined;
      reconnectRef.current = () => undefined;
      disconnect();
    };
  }, []);

  const onSend = (text: string) => {
    setMessages((current) => [...current, createUserMessage(text)]);
    if (statusRef.current !== "ready") {
      setError("Local agent is offline. Retry the connection, then send again.");
      setStatus("error");
      setIsRunning(false);
      return;
    }
    setIsRunning(true);
    setError(undefined);
    sendRef.current({
      type: "prompt",
      text,
      currentPage: pageRef.current
        ? { title: pageRef.current.title, url: pageRef.current.url }
        : undefined,
    });
  };

  const onCancel = () => {
    sendRef.current({ type: "cancel" });
    setIsRunning(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Header
        status={status}
        error={error}
        page={page}
        todos={todos}
        activity={activity}
        onRetry={() => {
          setStatus("starting");
          setError("Reconnecting…");
          reconnectRef.current();
        }}
      />
      <div className="min-h-0 flex-1">
        <ChatPane
          messages={messages}
          isRunning={isRunning}
          disabled={status !== "ready"}
          onSend={onSend}
          onCancel={onCancel}
        />
      </div>
      <PermissionBar
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
  );
}

function mergeTodos(current: TodoItem[], incoming: TodoItem[]): TodoItem[] {
  const map = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}
