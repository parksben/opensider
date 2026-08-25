import type { AppendMessage } from "@assistant-ui/react";
import type { CurrentPage, ExtToHost, HostToExt } from "@shared";
import { useEffect, useRef, useState } from "react";
import { applyAcpUpdate, createUserMessage } from "./acp-messages";
import { connectSidebar } from "./bridge";
import type { ChatMessage, PermissionRequest, PlanPrompt, QuestionPrompt, TodoItem } from "./chat-types";
import { Header } from "./components/Header";
import { PermissionBar } from "./components/PermissionBar";
import { Thread } from "./components/Thread";
import { SidebarRuntime } from "./runtime";

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
  const sendRef = useRef<(msg: ExtToHost) => void>(() => undefined);
  const pageRef = useRef<CurrentPage | undefined>(undefined);
  pageRef.current = page;

  useEffect(() => {
    const { send, disconnect } = connectSidebar((msg) => handleHost(msg));
    sendRef.current = send;
    return () => {
      sendRef.current = () => undefined;
      disconnect();
    };
  }, []);

  const handleHost = (msg: HostToExt) => {
    if (msg.type === "status") {
      setStatus(msg.state);
      setError(msg.error);
      if (msg.state === "error") setIsRunning(false);
      return;
    }
    if (msg.type === "session" && msg.replay) {
      setMessages([]);
      return;
    }
    if (msg.type === "page") {
      setPage(msg.page);
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

  const onNew = async (message: AppendMessage) => {
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    if (!text.trim()) return;
    setMessages((current) => [...current, createUserMessage(text)]);
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
      <Header status={status} error={error} page={page} todos={todos} />
      <div className="min-h-0 flex-1">
        <SidebarRuntime
          messages={messages}
          isRunning={isRunning}
          onNew={onNew}
          onCancel={onCancel}
        >
          <Thread />
        </SidebarRuntime>
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
