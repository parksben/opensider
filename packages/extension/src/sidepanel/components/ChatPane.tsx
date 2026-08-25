import type { AgentModel, AttachmentItem, AttachmentKind, CurrentPage } from "@shared";
import { ArrowDown, ChevronDown, ChevronRight, File, Folder, GitFork, Image, LoaderCircle, MessageCircle, MousePointer2, Plus, RefreshCw, Send, Square, X } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type ReactNode } from "react";
import type { ChatMessage, ChatPart } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { textOf } from "../persist";
import { useRipple } from "../useRipple";
import { IconButton } from "./IconButton";
import { Markdown } from "./Markdown";
import { RippleButton } from "./RippleButton";
import { ToolCard } from "./ToolCard";

const STICKY_PX = 96;

function distanceFromBottom(node: HTMLElement): number {
  if (node.scrollTop <= 0) return Math.abs(node.scrollTop);
  return node.scrollHeight - node.clientHeight - node.scrollTop;
}

function stickToBottom(node: HTMLElement | null, smooth = false): void {
  if (!node) return;
  node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files: File[] = [];
  const add = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (files.some((item) => item.name === file.name && item.size === file.size && item.lastModified === file.lastModified)) {
      return;
    }
    files.push(file);
  };
  for (const file of Array.from(data.files)) add(file);
  for (const item of Array.from(data.items)) {
    if (item.kind === "file") add(item.getAsFile());
  }
  return files;
}

export function ChatPane({
  locale,
  sessionId,
  messages,
  isRunning,
  pickingElement,
  models,
  modelId,
  showModelPicker,
  onSend,
  onRevise,
  onCancel,
  onFork,
  onRegenerate,
  onPickAttachments,
  onPasteImages,
  onPickElement,
  onCancelElementPick,
  onModel,
  page,
}: {
  locale: Locale;
  sessionId: string;
  messages: ChatMessage[];
  isRunning: boolean;
  pickingElement: boolean;
  models: AgentModel[];
  modelId: string;
  showModelPicker: boolean;
  onSend: (text: string, attachments: AttachmentItem[]) => void;
  onRevise: (messageId: string, text: string, attachments: AttachmentItem[]) => void;
  onCancel: () => void;
  onFork: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onPickAttachments: () => Promise<AttachmentItem[]>;
  onPasteImages: (files: File[]) => Promise<AttachmentItem[]>;
  onPickElement: () => Promise<AttachmentItem[]>;
  onCancelElementPick: () => void;
  onModel: (modelId: string) => void;
  page?: CurrentPage;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [savingPaste, setSavingPaste] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [stash, setStash] = useState<{ draft: string; attachments: AttachmentItem[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef<string | undefined>(undefined);
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  editingRef.current = editingId;
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const canSend = Boolean(draft.trim() || attachments.length);
  const busy = pickingFiles || pickingElement || isRunning || savingPaste;

  const mergeAttachments = (items: AttachmentItem[]) => {
    setAttachments((current) => {
      const seen = new Set(current.map((item) => item.path));
      return [...current, ...items.filter((item) => !seen.has(item.path))];
    });
  };

  const submit = () => {
    if (!canSend || isRunning || savingPaste) return;
    const text = draft.trim();
    const files = attachments;
    const reviseId = editingId;
    setDraft("");
    setAttachments([]);
    setEditingId(undefined);
    setStash(null);
    if (reviseId) onRevise(reviseId, text, files);
    else onSend(text, files);
    requestAnimationFrame(() => stickToBottom(listRef.current));
  };

  const cancelEdit = () => {
    setDraft(stash?.draft ?? "");
    setAttachments(stash?.attachments ?? []);
    setEditingId(undefined);
    setStash(null);
  };

  const startEdit = (message: ChatMessage) => {
    if (isRunning || pickingElement) return;
    if (!editingId) setStash({ draft, attachments });
    setEditingId(message.id);
    setDraft(textOf(message.content));
    setAttachments(message.attachments ? [...message.attachments] : []);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const node = inputRef.current;
      if (!node) return;
      node.selectionStart = node.value.length;
      node.selectionEnd = node.value.length;
    });
  };

  useEffect(() => {
    const wasEditing = editingRef.current;
    setEditingId(undefined);
    setStash(null);
    if (wasEditing) {
      setDraft("");
      setAttachments([]);
    }
    setAwayFromBottom(false);
    requestAnimationFrame(() => stickToBottom(listRef.current));
  }, [sessionId]);

  const onThreadScroll = () => {
    const node = listRef.current;
    if (!node) return;
    setAwayFromBottom(distanceFromBottom(node) > STICKY_PX);
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

  const addPastedImages = async (files: File[]) => {
    if (files.length === 0 || busy) return;
    setSavingPaste(true);
    try {
      mergeAttachments(await onPasteImages(files));
    } finally {
      setSavingPaste(false);
    }
  };

  const onComposerPaste = (event: ClipboardEvent<HTMLElement>) => {
    const images = clipboardImages(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    if (text) {
      const node = inputRef.current;
      const start = node?.selectionStart ?? draft.length;
      const end = node?.selectionEnd ?? draft.length;
      setDraft((current) => current.slice(0, start) + text + current.slice(end));
      requestAnimationFrame(() => {
        if (!node) return;
        const cursor = start + text.length;
        node.selectionStart = cursor;
        node.selectionEnd = cursor;
      });
    }
    void addPastedImages(images);
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
      {messages.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          <MessageCircle size={120} strokeWidth={1} className="text-[var(--muted)] opacity-25" />
          <p className="mt-4 max-w-[16rem] text-center text-[12px] leading-relaxed text-[var(--muted)] opacity-55">
            {label("emptyHint")}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          onScroll={onThreadScroll}
          className="cs-thread flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3"
        >
          <div className="py-3">
            {messages.map((message, index) => {
              const gap = index === 0 ? "" : message.role === "user" ? "mt-6" : "mt-3";
              return message.role === "user" ? (
                <div key={message.id} className={`flex justify-end ${gap}`}>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => startEdit(message)}
                    className={`ml-auto w-fit max-w-[80%] break-words rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-left text-[13.5px] leading-relaxed disabled:cursor-default ${
                      editingId === message.id
                        ? "ring-1 ring-[var(--brass)]"
                        : "cursor-pointer hover:bg-[var(--user-hover)]"
                    }`}
                  >
                    {textOf(message.content) ? <div>{textOf(message.content)}</div> : null}
                    {message.attachments?.length ? (
                      <AttachmentChips
                        items={message.attachments}
                        className={textOf(message.content) ? "mt-2" : ""}
                      />
                    ) : null}
                  </button>
                </div>
              ) : (
                <MessageFrame
                  key={message.id}
                  locale={locale}
                  locked={isRunning}
                  hideActions={isRunning && message.id === messages[messages.length - 1]?.id}
                  className={gap}
                  modelLabel={
                    message.modelName ||
                    models.find((item) => item.id === message.modelId)?.name ||
                    (message.modelId && message.modelId !== "auto" ? message.modelId : "")
                  }
                  onFork={() => onFork(message.id)}
                  onRegenerate={() => onRegenerate(message.id)}
                >
                  <AssistantMessage
                    locale={locale}
                    content={message.content}
                    page={page}
                    live={isRunning && message.id === messages[messages.length - 1]?.id}
                    durationMs={message.durationMs}
                  />
                </MessageFrame>
              );
            })}
            {isRunning ? (
              <div className="mt-3 flex items-center gap-2 text-[12px] text-[var(--brass)]">
                <LoaderCircle size={14} className="animate-spin" />
                {label("working")}
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div className="sticky bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)] to-transparent px-3 pb-3 pt-2">
        <div className="relative">
          {awayFromBottom ? (
            <IconButton
              side="top"
              label={label("scrollToBottom")}
              onClick={() => {
                stickToBottom(listRef.current, true);
                setAwayFromBottom(false);
              }}
              className="absolute right-0 bottom-full z-20 mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--text)] hover:bg-[var(--hover)]"
            >
              <ArrowDown size={22} />
            </IconButton>
          ) : null}
        <div
          className={`cs-composer rounded-xl bg-[var(--panel)] px-2 py-2 ${isRunning ? "is-running" : ""}`}
          onPaste={onComposerPaste}
        >
          {editingId ? (
            <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--muted)]">
                {label("editHistoryHint")}
              </p>
              <RippleButton
                onClick={cancelEdit}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--brass)] hover:bg-[var(--brass)]/20"
              >
                {label("cancelEdit")}
              </RippleButton>
            </div>
          ) : null}
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
            ref={inputRef}
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
                disabled={pickingFiles || savingPaste || isRunning}
                className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                  pickingElement ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                }`}
              >
                <MousePointer2 size={14} />
              </IconButton>
              <IconButton
                side="top"
                label={label("attach")}
                onClick={() => void addAttachments()}
                disabled={busy}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                {pickingFiles || savingPaste ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}
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
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  <Square size={14} />
                </IconButton>
              ) : (
                <IconButton
                  side="top"
                  label={label("send")}
                  onClick={submit}
                  disabled={!canSend}
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent"
                >
                  <Send size={14} />
                </IconButton>
              )}
            </div>
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
                  active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
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
  hideActions,
  className = "",
  modelLabel,
  onFork,
  onRegenerate,
  children,
}: {
  locale: Locale;
  locked: boolean;
  hideActions?: boolean;
  className?: string;
  modelLabel?: string;
  onFork: () => void;
  onRegenerate: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`group relative ${className}`}>
      {children}
      {hideActions ? null : (
        <div className="mt-1 flex items-center justify-start opacity-0 transition-opacity group-hover:opacity-100">
          {modelLabel ? (
            <span className="min-w-0 truncate text-[11px] text-[var(--muted)]">
              {t(locale, "generatedBy").replace("{name}", modelLabel)}
            </span>
          ) : null}
          <div className={`flex items-center gap-1 ${modelLabel ? "ml-4" : ""}`}>
            <IconButton
              label={t(locale, "fork")}
              disabled={locked}
              onClick={onFork}
              className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <GitFork size={12} />
            </IconButton>
            <IconButton
              label={t(locale, "regenerate")}
              disabled={locked}
              onClick={onRegenerate}
              className="rounded p-1 text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <RefreshCw size={12} />
            </IconButton>
          </div>
        </div>
      )}
    </div>
  );
}

function compactReasoning(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function lastTextIndex(parts: ChatPart[]): number {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].type === "text") return index;
  }
  return -1;
}

function formatTurnDuration(ms: number, locale: Locale): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return locale === "zh" ? `${total} 秒` : `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (locale === "zh") return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function ProcessToggle({
  locale,
  durationMs,
  open,
  onToggle,
}: {
  locale: Locale;
  durationMs?: number;
  open: boolean;
  onToggle: () => void;
}) {
  const time = durationMs != null ? formatTurnDuration(durationMs, locale) : "";
  const label = time ? t(locale, "ranFor").replace("{time}", time) : t(locale, "ran");
  return (
    <RippleButton
      onClick={onToggle}
      className="group flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-[12px] text-[var(--muted)]"
    >
      <span>{label}</span>
      {open ? (
        <ChevronDown size={14} className="shrink-0" />
      ) : (
        <ChevronRight size={14} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </RippleButton>
  );
}

function renderAssistantPart(part: ChatPart, index: number, locale: Locale, page?: CurrentPage) {
  if (part.type === "text") return <Markdown key={index} text={part.text} page={page} />;
  if (part.type === "reasoning") {
    return (
      <details key={index} className="text-[12px] text-[var(--muted)]">
        <summary className="cursor-pointer">{t(locale, "thinking")}</summary>
        <div className="mt-1 whitespace-pre-wrap">{compactReasoning(part.text)}</div>
      </details>
    );
  }
  return <ToolCard key={part.toolCallId} locale={locale} part={part} />;
}

function AssistantMessage({
  locale,
  content,
  page,
  live,
  durationMs,
}: {
  locale: Locale;
  content: ChatPart[];
  page?: CurrentPage;
  live?: boolean;
  durationMs?: number;
}) {
  const [open, setOpen] = useState(false);
  if (content.length === 0) {
    return <div className="text-[12px] text-[var(--muted)]">{t(locale, "waiting")}</div>;
  }
  const cut = lastTextIndex(content);
  const process = cut > 0 ? content.slice(0, cut) : cut < 0 ? content : [];
  const body = cut >= 0 ? content.slice(cut) : [];
  const fold = !live && process.length > 0;
  if (!fold) {
    return <div className="space-y-1">{content.map((part, index) => renderAssistantPart(part, index, locale, page))}</div>;
  }
  return (
    <div className="space-y-1">
      <ProcessToggle locale={locale} durationMs={durationMs} open={open} onToggle={() => setOpen((value) => !value)} />
      {open ? process.map((part, index) => renderAssistantPart(part, index, locale, page)) : null}
      {body.map((part, index) => renderAssistantPart(part, cut + index, locale, page))}
    </div>
  );
}
