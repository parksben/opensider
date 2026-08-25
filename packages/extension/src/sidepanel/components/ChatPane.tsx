import type { AgentModel, AttachmentItem, AttachmentKind } from "@shared";
import { ChevronDown, File, Folder, GitFork, Image, LoaderCircle, MessageCircle, MousePointer2, Plus, RefreshCw, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { ChatMessage, ChatPart } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { textOf } from "../persist";
import { useRipple } from "../useRipple";
import { IconButton } from "./IconButton";
import { Markdown } from "./Markdown";
import { RippleButton } from "./RippleButton";
import { ToolCard } from "./ToolCard";

export function ChatPane({
  locale,
  messages,
  isRunning,
  pickingElement,
  models,
  modelId,
  showModelPicker,
  onSend,
  onCancel,
  onFork,
  onRegenerate,
  onPickAttachments,
  onPickElement,
  onCancelElementPick,
  onModel,
}: {
  locale: Locale;
  messages: ChatMessage[];
  isRunning: boolean;
  pickingElement: boolean;
  models: AgentModel[];
  modelId: string;
  showModelPicker: boolean;
  onSend: (text: string, attachments: AttachmentItem[]) => void;
  onCancel: () => void;
  onFork: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onPickAttachments: () => Promise<AttachmentItem[]>;
  onPickElement: () => Promise<AttachmentItem[]>;
  onCancelElementPick: () => void;
  onModel: (modelId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [pickingFiles, setPickingFiles] = useState(false);
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const canSend = Boolean(draft.trim() || attachments.length);
  const busy = pickingFiles || pickingElement || isRunning;

  const mergeAttachments = (items: AttachmentItem[]) => {
    setAttachments((current) => {
      const seen = new Set(current.map((item) => item.path));
      return [...current, ...items.filter((item) => !seen.has(item.path))];
    });
  };

  const submit = () => {
    if (!canSend || isRunning) return;
    const text = draft.trim();
    const files = attachments;
    setDraft("");
    setAttachments([]);
    onSend(text, files);
  };

  const addAttachments = async () => {
    if (busy) return;
    setPickingFiles(true);
    try {
      mergeAttachments(await onPickAttachments());
    } finally {
      setPickingFiles(false);
    }
  };

  const startElementPick = async () => {
    if (pickingElement) {
      onCancelElementPick();
      return;
    }
    if (pickingFiles || isRunning) return;
    mergeAttachments(await onPickElement());
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
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
                <div key={message.id}>
                  <div className="ml-auto w-fit max-w-[80%] break-words rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-[13.5px] leading-relaxed">
                    {textOf(message.content) ? <div>{textOf(message.content)}</div> : null}
                    {message.attachments?.length ? (
                      <AttachmentChips
                        items={message.attachments}
                        className={textOf(message.content) ? "mt-2" : ""}
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <MessageFrame
                  key={message.id}
                  locale={locale}
                  locked={isRunning}
                  onFork={() => onFork(message.id)}
                  onRegenerate={() => onRegenerate(message.id)}
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
        <div
          className={`cs-composer rounded-xl bg-[var(--panel)] px-2 py-2 ${isRunning ? "is-running" : ""}`}
        >
          {attachments.length > 0 ? (
            <AttachmentChips
              items={attachments}
              removable
              removeLabel={label("removeAttachment")}
              onRemove={(path) => setAttachments((current) => current.filter((item) => item.path !== path))}
              className="mb-1.5 px-1"
            />
          ) : null}
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1">
              <IconButton
                side="top"
                label={label("pickElement")}
                onClick={() => void startElementPick()}
                disabled={pickingFiles || isRunning}
                className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent ${
                  pickingElement ? "bg-white/15 text-[var(--brass)]" : "text-[var(--text)]"
                }`}
              >
                <MousePointer2 size={14} />
              </IconButton>
              <IconButton
                side="top"
                label={label("attach")}
                onClick={() => void addAttachments()}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                {pickingFiles ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}
              </IconButton>
            </div>
            <div className="flex min-w-0 items-center justify-end gap-1.5">
              {showModelPicker ? (
                <ModelSelect locale={locale} models={models} modelId={modelId} onModel={onModel} />
              ) : null}
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
                  disabled={!canSend}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-white/15 disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Send size={14} />
                </IconButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AttachmentChips({
  items,
  removable,
  removeLabel,
  onRemove,
  className = "",
}: {
  items: AttachmentItem[];
  removable?: boolean;
  removeLabel?: string;
  onRemove?: (path: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((item) => {
        const Icon = kindIcon(item.kind);
        return (
          <span
            key={item.path}
            title={item.path}
            className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--panel-2)] py-0.5 pl-1.5 pr-1 text-[11px] text-[var(--muted)]"
          >
            <Icon size={12} className="shrink-0 opacity-80" />
            <span className="min-w-0 flex-1 truncate">{item.name}</span>
            {removable && onRemove ? (
              <RippleButton
                title={removeLabel}
                aria-label={removeLabel}
                onClick={() => onRemove(item.path)}
                className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X size={10} />
              </RippleButton>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function kindIcon(kind: AttachmentKind) {
  if (kind === "image") return Image;
  if (kind === "folder") return Folder;
  if (kind === "element") return MousePointer2;
  return File;
}

function ModelSelect({
  locale,
  models,
  modelId,
  disabled,
  onModel,
}: {
  locale: Locale;
  models: AgentModel[];
  modelId: string;
  disabled?: boolean;
  onModel: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = models.find((model) => model.id === modelId) ?? models[0];
  const label = current?.name || modelId || t(locale, "model");

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        title={label}
        aria-label={t(locale, "model")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => {
          if (!disabled) spawn(event);
        }}
        className="relative flex h-7 max-w-[9.5rem] items-center gap-1 overflow-hidden rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="cs-ripple"
            style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
            onAnimationEnd={() => done(ripple.id)}
          />
        ))}
      </button>
      {open ? (
        <div className="absolute right-0 bottom-full z-30 mb-1.5 max-h-56 w-56 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          {models.map((model) => {
            const active = model.id === (current?.id ?? modelId);
            return (
              <RippleButton
                key={model.id}
                title={model.name}
                onClick={() => {
                  onModel(model.id);
                  setOpen(false);
                }}
                className={`flex w-full px-2.5 py-1.5 text-left text-[12px] ${
                  active ? "bg-white/8 text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <span className="truncate">{model.name}</span>
              </RippleButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function MessageFrame({
  locale,
  locked,
  onFork,
  onRegenerate,
  children,
}: {
  locale: Locale;
  locked: boolean;
  onFork: () => void;
  onRegenerate: () => void;
  children: ReactNode;
}) {
  return (
    <div className="group relative">
      {children}
      <div className="mt-1 flex justify-start gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <IconButton
          label={t(locale, "fork")}
          disabled={locked}
          onClick={onFork}
          className="rounded border border-[var(--line)] p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <GitFork size={12} />
        </IconButton>
        <IconButton
          label={t(locale, "regenerate")}
          disabled={locked}
          onClick={onRegenerate}
          className="rounded border border-[var(--line)] p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
        >
          <RefreshCw size={12} />
        </IconButton>
      </div>
    </div>
  );
}

function compactReasoning(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .join("\n");
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
              <div className="mt-1 whitespace-pre-wrap">{compactReasoning(part.text)}</div>
            </details>
          );
        }
        return <ToolCard key={part.toolCallId} locale={locale} part={part} />;
      })}
    </div>
  );
}
