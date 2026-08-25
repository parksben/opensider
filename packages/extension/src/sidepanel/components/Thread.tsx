import {
  ComposerPrimitive,
  ThreadPrimitive,
  useAuiState,
} from "@assistant-ui/react";
import { ArrowUp, Square } from "lucide-react";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";
import type { ChatPart } from "../chat-types";

export function Thread() {
  return (
    <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col">
      <ThreadPrimitive.Viewport className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <EmptyState />
        <ThreadPrimitive.Messages>
          {({ message }) =>
            message.role === "user" ? <UserBubble /> : <AssistantBubble />
          }
        </ThreadPrimitive.Messages>
      </ThreadPrimitive.Viewport>
      <ThreadPrimitive.ViewportFooter className="sticky bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)] to-transparent px-3 pb-3 pt-2">
        <Composer />
      </ThreadPrimitive.ViewportFooter>
    </ThreadPrimitive.Root>
  );
}

function EmptyState() {
  const empty = useAuiState((state) => state.thread.isEmpty);
  if (!empty) return null;
  return (
    <div className="px-1 py-8 text-center">
      <div className="font-[Fraunces,serif] text-[22px] leading-tight">Talk to the machine beside the page.</div>
      <p className="mx-auto mt-2 max-w-[16rem] text-[12.5px] leading-relaxed text-[var(--muted)]">
        One workspace, one thread. Switch tabs and the agent keeps the same conversation, with the current page in view.
      </p>
    </div>
  );
}

function UserBubble() {
  const text = useAuiState((state) => {
    const content = state.message.content as ChatPart[];
    return content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
  });
  return (
    <div className="ml-6 rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-[13.5px] leading-relaxed">
      {text}
    </div>
  );
}

function AssistantBubble() {
  const parts = useAuiState((state) => state.message.content as ChatPart[]);
  return (
    <div className="space-y-1">
      {parts.map((part, index) => {
        if (part.type === "text") {
          return <Markdown key={index} text={part.text} />;
        }
        if (part.type === "reasoning") {
          return (
            <details key={index} className="text-[12px] text-[var(--muted)]">
              <summary className="cursor-pointer">Thinking</summary>
              <div className="mt-1 whitespace-pre-wrap">{part.text}</div>
            </details>
          );
        }
        return <ToolCard key={part.toolCallId} part={part} />;
      })}
    </div>
  );
}

function Composer() {
  const running = useAuiState((state) => state.thread.isRunning);
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2 py-2">
      <ComposerPrimitive.Input
        placeholder="Ask about this page"
        className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13.5px] outline-none placeholder:text-[var(--muted)]"
        rows={1}
      />
      {running ? (
        <ComposerPrimitive.Cancel className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text)]">
          <Square size={13} />
        </ComposerPrimitive.Cancel>
      ) : (
        <ComposerPrimitive.Send className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brass)] text-[#1a140b]">
          <ArrowUp size={15} />
        </ComposerPrimitive.Send>
      )}
    </ComposerPrimitive.Root>
  );
}
