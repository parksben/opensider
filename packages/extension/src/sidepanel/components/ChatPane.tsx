import type { AgentModel, AttachmentItem, AttachmentKind, CurrentPage } from "@shared";
import { ArrowDown, Check, ChevronDown, Copy, File, Folder, GitFork, Image, LoaderCircle, MessageSquareMore, MousePointer2, Plus, RefreshCw, Send, Shield, Square, X, Zap } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage, ChatPart, TodoItem } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { stripEnvPrompt, textOf, type AgentMode } from "../persist";
import { useRipple } from "../useRipple";
import { IconButton } from "./IconButton";
import { Markdown } from "./Markdown";
import { RippleButton } from "./RippleButton";
import { TextFold } from "./TextFold";
import { TodoList } from "./TodoList";
import { ToolCard } from "./ToolCard";

const STICKY_PX = 96;
const COMPOSER_MIN_LINES = 2;
const COMPOSER_MAX_LINES = 10;

function composerLineHeight(node: HTMLTextAreaElement): number {
  const style = getComputedStyle(node);
  const lineHeight = parseFloat(style.lineHeight);
  if (Number.isFinite(lineHeight) && lineHeight > 0) return lineHeight;
  const fontSize = parseFloat(style.fontSize);
  return (Number.isFinite(fontSize) ? fontSize : 13.5) * 1.5;
}

function composerBounds(node: HTMLTextAreaElement): { min: number; max: number; lineHeight: number } {
  const style = getComputedStyle(node);
  const lineHeight = composerLineHeight(node);
  const pad = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const padY = Number.isFinite(pad) ? pad : 0;
  return {
    lineHeight,
    min: lineHeight * COMPOSER_MIN_LINES + padY,
    max: lineHeight * COMPOSER_MAX_LINES + padY,
  };
}

function scrollComposerCaret(node: HTMLTextAreaElement | null): void {
  if (!node) return;
  const style = getComputedStyle(node);
  const mirror = document.createElement("div");
  mirror.setAttribute("aria-hidden", "true");
  const copy = [
    "boxSizing",
    "font",
    "fontSize",
    "fontFamily",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "lineHeight",
    "textTransform",
    "wordSpacing",
    "textIndent",
    "padding",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "borderWidth",
    "whiteSpace",
    "wordBreak",
    "overflowWrap",
    "tabSize",
  ] as const;
  for (const prop of copy) {
    mirror.style[prop] = style[prop];
  }
  Object.assign(mirror.style, {
    position: "absolute",
    visibility: "hidden",
    overflow: "hidden",
    top: "0",
    left: "0",
    width: `${node.clientWidth}px`,
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
  });
  mirror.textContent = node.value.slice(0, node.selectionEnd);
  const caret = document.createElement("span");
  caret.textContent = "\u200b";
  mirror.appendChild(caret);
  document.body.appendChild(mirror);
  const top = caret.offsetTop;
  const lineHeight = composerLineHeight(node);
  document.body.removeChild(mirror);
  const viewTop = node.scrollTop;
  const viewBottom = viewTop + node.clientHeight;
  if (top < viewTop) node.scrollTop = top;
  else if (top + lineHeight > viewBottom) node.scrollTop = top + lineHeight - node.clientHeight;
}

function fitComposer(node: HTMLTextAreaElement | null): void {
  if (!node) return;
  const { min, max } = composerBounds(node);
  node.style.overflowY = "hidden";
  node.style.height = "auto";
  let next = Math.min(max, Math.max(min, node.scrollHeight));
  node.style.height = `${next}px`;
  if (node.scrollHeight > max + 1) {
    node.style.overflowY = "auto";
    node.style.height = "auto";
    next = Math.min(max, Math.max(min, node.scrollHeight));
    node.style.height = `${next}px`;
    node.style.overflowY = "auto";
  }
  scrollComposerCaret(node);
}

function stickToBottom(node: HTMLElement | null, smooth = false): void {
  if (!node) return;
  node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const images = (files: File[]) => files.filter((file) => file.type.startsWith("image/"));
  const fromFiles = images(Array.from(data.files));
  if (fromFiles.length > 0) return fromFiles;
  return images(
    Array.from(data.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => file != null),
  );
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
  agentMode,
  onAgentMode,
  page,
  hitl,
  todos,
}: {
  locale: Locale;
  sessionId: string;
  messages: ChatMessage[];
  isRunning: boolean;
  pickingElement: boolean;
  models: AgentModel[];
  modelId: string;
  showModelPicker: boolean;
  hitl?: ReactNode;
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
  agentMode: AgentMode;
  onAgentMode: (mode: AgentMode) => void;
  page?: CurrentPage;
  todos?: TodoItem[];
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [savingPaste, setSavingPaste] = useState(false);
  const [editingId, setEditingId] = useState<string>();
  const [stash, setStash] = useState<{ draft: string; attachments: AttachmentItem[] } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);
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
    setDraft(stripEnvPrompt(textOf(message.content)));
    setAttachments(message.attachments ? [...message.attachments] : []);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const node = inputRef.current;
      if (!node) return;
      node.selectionStart = node.value.length;
      node.selectionEnd = node.value.length;
      fitComposer(node);
    });
  };

  useLayoutEffect(() => {
    fitComposer(inputRef.current);
  }, [draft]);

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

  useEffect(() => {
    const root = listRef.current;
    const target = threadEndRef.current;
    if (!root || !target) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        setAwayFromBottom(!entry.isIntersecting);
      },
      { root, rootMargin: `0px 0px ${STICKY_PX}px 0px`, threshold: 0 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [sessionId, messages.length]);

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
        fitComposer(node);
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
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
          <MessageSquareMore size={120} strokeWidth={1} className="text-[var(--muted)] opacity-25" />
          <p className="mt-4 w-full px-[min(200px,max(1rem,calc(50%-12rem)))] text-center text-[12px] leading-relaxed text-[var(--muted)] opacity-55">
            {label("emptyHint")}
          </p>
        </div>
      ) : (
        <div
          ref={listRef}
          className="cs-thread flex min-h-0 flex-1 flex-col-reverse overflow-y-auto px-3"
        >
          <div aria-hidden className="min-h-0 flex-1" />
          <div className="shrink-0 py-3">
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
                    {stripEnvPrompt(textOf(message.content)) ? (
                      <div>{stripEnvPrompt(textOf(message.content))}</div>
                    ) : null}
                    {message.attachments?.length ? (
                      <AttachmentChips
                        items={message.attachments}
                        className={stripEnvPrompt(textOf(message.content)) ? "mt-2" : ""}
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
                  replyMarkdown={replyMarkdown(message.content)}
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
            <div ref={threadEndRef} aria-hidden className="h-px w-full" />
          </div>
        </div>
      )}
      <div className="sticky bottom-0 bg-gradient-to-t from-[var(--ink)] via-[var(--ink)] to-transparent px-3 pb-3 pt-2">
        <div className="relative">
          {awayFromBottom ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 mb-4 flex justify-center">
              <IconButton
                side="top"
                label={label("scrollToBottom")}
                onClick={() => {
                  stickToBottom(listRef.current, true);
                  setAwayFromBottom(false);
                }}
                className="cs-jump-bottom pointer-events-auto flex h-[39px] w-[39px] items-center justify-center rounded-full border border-[var(--line)] text-[var(--text)]"
              >
                <ArrowDown size={15} />
              </IconButton>
            </div>
          ) : null}
        <TodoList locale={locale} todos={todos ?? []} />
        {hitl}
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
            rows={2}
            className="cs-composer-input w-full resize-none bg-transparent px-1 text-[13.5px] outline-none placeholder:text-[var(--muted)]"
            onChange={(event) => setDraft(event.target.value)}
            onSelect={() => scrollComposerCaret(inputRef.current)}
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
              <ModeSelect locale={locale} mode={agentMode} onMode={onAgentMode} />
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

function ModeSelect({
  locale,
  mode,
  onMode,
}: {
  locale: Locale;
  mode: AgentMode;
  onMode: (mode: AgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = mode === "auto" ? { icon: Zap, name: t(locale, "modeAuto") } : { icon: Shield, name: t(locale, "modeAsk") };
  const CurrentIcon = current.icon;
  const options: Array<{ id: AgentMode; icon: typeof Shield; name: string; hint: string }> = [
    { id: "ask", icon: Shield, name: t(locale, "modeAsk"), hint: t(locale, "modeAskHint") },
    { id: "auto", icon: Zap, name: t(locale, "modeAuto"), hint: t(locale, "modeAutoHint") },
  ];

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        title={current.name}
        aria-label={current.name}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        className={`relative flex h-7 items-center gap-1 overflow-hidden rounded-full px-2 text-[11px] hover:bg-[var(--hover)] ${
          mode === "auto" ? "text-[var(--brass)]" : "text-[var(--muted)]"
        }`}
      >
        <CurrentIcon size={14} />
        <span>{current.name}</span>
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
        <div className="absolute bottom-full left-0 z-30 mb-1.5 w-52 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          {options.map((option) => {
            const Icon = option.icon;
            const active = option.id === mode;
            return (
              <RippleButton
                key={option.id}
                onClick={() => {
                  onMode(option.id);
                  setOpen(false);
                }}
                className={`flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left ${
                  active ? "bg-[var(--hover-strong)]" : ""
                }`}
              >
                <span className={`flex items-center gap-1.5 text-[12px] ${active ? "text-[var(--text)]" : "text-[var(--muted)]"}`}>
                  <Icon size={14} />
                  {option.name}
                </span>
                <span className="pl-[22px] text-[11px] leading-snug text-[var(--muted)]">{option.hint}</span>
              </RippleButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function matchesModel(model: AgentModel, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle);
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
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState(modelId);
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = models.find((model) => model.id === modelId) ?? models[0];
  const label = current?.name || modelId || t(locale, "model");
  const visible = models.filter((model) => matchesModel(model, query));

  const pick = (id: string) => {
    onModel(id);
    setOpen(false);
  };

  const moveHighlight = (delta: number) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((model) => model.id === highlightId);
    const from = idx >= 0 ? idx : 0;
    setHighlightId(visible[(from + delta + visible.length) % visible.length].id);
  };

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = visible.find((model) => model.id === highlightId) ?? visible[0];
      if (chosen) pick(chosen.id);
    }
  };

  const onFilterChange = (value: string) => {
    setQuery(value);
    const next = models.filter((model) => matchesModel(model, value));
    setHighlightId((id) => (next.some((model) => model.id === id) ? id : (next[0]?.id ?? "")));
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    setHighlightId(current?.id ?? models[0]?.id ?? "");
    const focusFilter = () => filterRef.current?.focus();
    focusFilter();
    const frame = requestAnimationFrame(focusFilter);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !highlightId) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-model-id="${CSS.escape(highlightId)}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [open, highlightId]);

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
        <div className="absolute right-0 bottom-full z-30 mb-1.5 flex w-56 flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl">
          <input
            ref={filterRef}
            type="text"
            value={query}
            autoComplete="off"
            spellCheck={false}
            aria-label={t(locale, "filterModels")}
            placeholder={t(locale, "filterModels")}
            className="cs-model-filter shrink-0 bg-transparent px-2.5 py-1.5 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)]"
            onChange={(event) => onFilterChange(event.target.value)}
            onPaste={(event) => event.stopPropagation()}
            onKeyDown={onFilterKeyDown}
          />
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {visible.length === 0 ? (
              <p className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">{t(locale, "noMatchingModels")}</p>
            ) : (
              visible.map((model) => {
                const highlighted = model.id === highlightId;
                return (
                  <RippleButton
                    key={model.id}
                    data-model-id={model.id}
                    title={model.name}
                    onPointerEnter={() => setHighlightId(model.id)}
                    onClick={() => pick(model.id)}
                    className={`flex w-full px-2.5 py-1.5 text-left text-[12px] ${
                      highlighted ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="truncate">{model.name}</span>
                  </RippleButton>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function replyMarkdown(content: ChatPart[]): string {
  const cut = lastTextIndex(content);
  if (cut < 0) return "";
  const folded = cut > 0;
  const source = folded ? content.slice(cut) : content;
  return source
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n\n")
    .trim();
}

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (!ok) throw new Error("copy failed");
  }
}

function MessageFrame({
  locale,
  locked,
  hideActions,
  className = "",
  modelLabel,
  replyMarkdown: markdown,
  onFork,
  onRegenerate,
  children,
}: {
  locale: Locale;
  locked: boolean;
  hideActions?: boolean;
  className?: string;
  modelLabel?: string;
  replyMarkdown: string;
  onFork: () => void;
  onRegenerate: () => void;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<number>(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);
  const copyReply = async () => {
    if (!markdown) return;
    try {
      await writeClipboard(markdown);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={`group/msg relative ${className}`}>
      {children}
      {hideActions ? null : (
        <div
          className={`mt-1 flex items-center justify-between gap-2 transition-opacity ${
            copied ? "opacity-100" : "opacity-0 group-hover/msg:opacity-100"
          }`}
        >
          {modelLabel ? (
            <span className="min-w-0 truncate text-[11px] text-[var(--muted)]">
              {t(locale, "generatedBy").replace("{name}", modelLabel)}
            </span>
          ) : (
            <span />
          )}
          <div className="flex shrink-0 items-center gap-1">
            <IconButton
              label={copied ? t(locale, "copiedReply") : t(locale, "copyReply")}
              disabled={locked || !markdown}
              onClick={() => void copyReply()}
              className={`rounded p-1 disabled:opacity-40 ${
                copied ? "text-[var(--ok)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              }`}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </IconButton>
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

function liveVisibleParts(parts: ChatPart[]): Array<{ part: ChatPart; index: number }> {
  const visible: Array<{ part: ChatPart; index: number }> = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part.type === "text") {
      visible.push({ part, index });
      continue;
    }
    const prev = visible[visible.length - 1];
    if (prev && prev.part.type !== "text") {
      visible[visible.length - 1] = { part, index };
    } else {
      visible.push({ part, index });
    }
  }
  return visible;
}

function formatTurnDuration(ms: number, locale: Locale): string {
  const total = Math.max(1, Math.round(ms / 1000));
  if (total < 60) return locale === "zh" ? `${total} 秒` : `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (locale === "zh") return seconds ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function processLabel(locale: Locale, durationMs?: number): string {
  const time = durationMs != null ? formatTurnDuration(durationMs, locale) : "";
  return time ? t(locale, "ranFor").replace("{time}", time) : t(locale, "ran");
}

function renderAssistantPart(part: ChatPart, index: number, locale: Locale, page?: CurrentPage) {
  if (part.type === "text") return <Markdown key={index} text={part.text} page={page} />;
  if (part.type === "reasoning") {
    return (
      <TextFold key={index} label={t(locale, "thinking")} paneClass="cs-fold-scroll">
        <div className="whitespace-pre-wrap text-[11px] leading-relaxed text-[var(--muted)]">
          {compactReasoning(part.text)}
        </div>
      </TextFold>
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
  if (content.length === 0) {
    return <div className="text-[12px] text-[var(--muted)]">{t(locale, "waiting")}</div>;
  }
  const cut = lastTextIndex(content);
  const process = cut > 0 ? content.slice(0, cut) : cut < 0 ? content : [];
  const body = cut >= 0 ? content.slice(cut) : [];
  const fold = !live && process.length > 0;
  if (!fold) {
    const items = live ? liveVisibleParts(content) : content.map((part, index) => ({ part, index }));
    return (
      <div className="space-y-1">
        {items.map(({ part, index }) => renderAssistantPart(part, index, locale, page))}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <TextFold label={processLabel(locale, durationMs)} paneClass="cs-process-scroll space-y-1">
        {process.map((part, index) => renderAssistantPart(part, index, locale, page))}
      </TextFold>
      {body.map((part, index) => renderAssistantPart(part, cut + index, locale, page))}
    </div>
  );
}
