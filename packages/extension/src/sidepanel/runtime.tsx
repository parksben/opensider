import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import type { ReactNode } from "react";
import type { ChatMessage } from "./chat-types";

function toThreadMessage(message: ChatMessage): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    createdAt: message.createdAt,
    content: message.content.map((part) => {
      if (part.type === "tool-call") {
        return {
          type: "tool-call" as const,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          args: JSON.parse(JSON.stringify(part.args ?? {})) as Record<string, never>,
          result: part.result,
        };
      }
      if (part.type === "reasoning") {
        return { type: "reasoning" as const, text: part.text };
      }
      return { type: "text" as const, text: part.text };
    }),
  };
}

export function SidebarRuntime({
  messages,
  isRunning,
  onNew,
  onCancel,
  children,
}: {
  messages: ChatMessage[];
  isRunning: boolean;
  onNew: (message: AppendMessage) => Promise<void>;
  onCancel: () => void;
  children: ReactNode;
}) {
  const runtime = useExternalStoreRuntime({
    isRunning,
    messages: messages.map(toThreadMessage),
    convertMessage: (message) => message,
    onNew,
    onCancel: async () => {
      onCancel();
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}
