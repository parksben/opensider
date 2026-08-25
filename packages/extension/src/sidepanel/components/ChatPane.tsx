import { GitFork, LoaderCircle, MessageCircle, Send, Square } from "lucide-react";
import { IconButton } from "./IconButton";
import { useState, type ReactNode } from "react";
import type { ChatMessage, ChatPart } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { textOf } from "../persist";
import { Markdown } from "./Markdown";
import { ToolCard } from "./ToolCard";

export function ChatPane({
  locale,
  messages,
  isRunning,
  onSend,
  onCancel,
  onFork,
}: {
  locale: Locale;
  messages: ChatMessage[];
  isRunning: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onFork: (messageId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);

  const submit = () => {
    const text = draft.trim();
    if (!text || isRunning) return;
    setDraft("");
    onSend(text);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-4">
            <MessageCircle size={120} strokeWidth={1} className="text-[var(--muted)] opacity-25" />
            <p className="mt-4 max-w-[16rem] text-center text-[12px] leading-relaxed text-[var(--muted)] opacity-55">
              {label("emptyHint")}
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-3">
          {messages.map((message) =>
            message.role === "user" ? (
              <MessageFrame
                key={message.id}
                locale={locale}
                locked={isRunning}
                onFork={() => onFork(message.id)}
              >
                <div className="ml-6 rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-[13.5px] leading-relaxed">
                  {textOf(message.content)}
                </div>
              </MessageFrame>
            ) : (
              <MessageFrame
                key={message.id}
                locale={locale}
                locked={isRunning}
                onFork={() => onFork(message.id)}
              >
                <AssistantMessage locale={locale} content={message.content} />
              </MessageFrame>
            ),
          )}
            {isRunning ? (
              <div className="flex items-center gap-2 text-[12px] text-[var(--brass)]">
                <LoaderCircle size={14} className="animate-spin" />
                {label("working")}
              </div>
            ) : null}
          </div>
        )}
      </div>
      <div className="sticky bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)] to-transparent px-3 pb-3 pt-2">
        <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-2 py-2">
          <textarea
            value={draft}
            placeholder={label("placeholder")}
            className="max-h-32 min-h-10 w-full resize-none bg-transparent px-1 py-1.5 text-[13.5px] outline-none placeholder:text-[var(--muted)]"
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="flex justify-end">
            {isRunning ? (
              <IconButton
                side="top"
                label={label("stop")}
                onClick={onCancel}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-white/15"
              >
                <Square size={14} />
              </IconButton>
            ) : (
              <IconButton
                side="top"
                label={label("send")}
                onClick={submit}
                disabled={!draft.trim()}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Send size={14} />
              </IconButton>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageFrame({
  locale,
  locked,
  onFork,
  children,
}: {
  locale: Locale;
  locked: boolean;
  onFork: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative">
      {children}
      <div className="mt-1 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          label={t(locale, "fork")}
          disabled={locked}
          onClick={onFork}
          className="rounded border border-[var(--line)] p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <GitFork size={12} />
        </IconButton>
      </div>
    </div>
  );
}

function AssistantMessage({ locale, content }: { locale: Locale; content: ChatPart[] }) {
  if (content.length === 0) {
    return <div className="text-[12px] text-[var(--muted)]">{t(locale, "waiting")}</div>;
  }
  return (
    <div className="space-y-1">
      {content.map((part, index) => {
        if (part.type === "text") return <Markdown key={index} text={part.text} />;
        if (part.type === "reasoning") {
          return (
            <details key={index} className="text-[12px] text-[var(--muted)]">
              <summary className="cursor-pointer">{t(locale, "thinking")}</summary>
              <div className="mt-1 whitespace-pre-wrap">{part.text}</div>
            </details>
          );
        }
        return <ToolCard key={part.toolCallId} part={part} />;
      })}
    </div>
  );
}
