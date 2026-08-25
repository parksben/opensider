import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { useState } from "react";
import type { ChatMessage, ChatPart } from "../chat-types";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

export function ChatPane({
  messages,
  isRunning,
  disabled,
  onSend,
  onCancel,
}: {
  messages: ChatMessage[];
  isRunning: boolean;
  disabled: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text || isRunning) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.length === 0 ? (
          <div className="px-1 py-8 text-center">
            <div className="font-[Fraunces,serif] text-[22px] leading-tight">Talk to the machine beside the page.</div>
            <p className="mx-auto mt-2 max-w-[16rem] text-[12.5px] leading-relaxed text-[var(--muted)]">
              One workspace, one thread. Switch tabs and the agent keeps the same conversation, with the current page in view.
            </p>
          </div>
        ) : (
          messages.map((message) =>
            message.role === "user" ? (
              <div
                key={message.id}
                className="ml-6 rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-[13.5px] leading-relaxed"
              >
                {textOf(message.content)}
              </div>
            ) : (
              <AssistantMessage key={message.id} content={message.content} />
            ),
          )
        )}
        {isRunning ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--brass)]">
            <LoaderCircle size={14} className="animate-spin" />
            Agent is working
          </div>
        ) : null}
      </div>
      <div className="sticky bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)] to-transparent px-3 pb-3 pt-2">
        <div className="flex items-end gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2 py-2">
          <textarea
            value={draft}
            placeholder={disabled ? "Agent is offline — send to see the error, or retry above" : "Ask about this page"}
            className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-1 py-1.5 text-[13.5px] outline-none placeholder:text-[var(--muted)] disabled:opacity-50"
            rows={1}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          {isRunning ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] text-[var(--text)]"
              aria-label="Stop"
            >
              <Square size={13} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!draft.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--brass)] text-[#1a140b] disabled:opacity-40"
              aria-label="Send"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({ content }: { content: ChatPart[] }) {
  if (content.length === 0) {
    return <div className="text-[12px] text-[var(--muted)]">Waiting for the agent…</div>;
  }
  return (
    <div className="space-y-1">
      {content.map((part, index) => {
        if (part.type === "text") return <Markdown key={index} text={part.text} />;
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

function textOf(content: ChatPart[]): string {
  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
