import type { AgentModeOption, AgentModel, AgentOption, AttachmentItem, CurrentPage, FsPickMode, SkillItem } from "@shared";
import { ArrowDown, AtSign, Check, ChevronDown, Copy, File, FileDown, Folder, FolderPen, GitFork, LoaderCircle, MousePointer2, Paperclip, Plus, RefreshCw, Send, Shield, Slash, Square, TriangleAlert, Unlock, X, Zap } from "lucide-react";
import logoUrl from "../../../assets/icon.svg?url";
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import type { ChatMessage, ChatPart, TodoItem } from "../chat-types";
import { useComposerHistory } from "../composer-history";
import { COMPOSER_ICON_PX, MODEL_NARROW_MAX_PX } from "../layout";
import { AgentOptionSelect } from "./AgentOptionSelect";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { closeAtMenuLock, installAtMenuGuard, openAtMenuLock, shouldBlockSubmit } from "../at-menu-lock";
import { composerHasContent, stripAttachmentMentions } from "../mentions";
import {
  composerCarryMatches,
  decodeComposerCarry,
  encodeComposerCarry,
  mergeAttachmentItems,
  type ComposerCarry,
} from "../composer-clipboard";
import {
  MAX_DROP_FILES,
  collectDrop,
  emptySkips,
  isTooLarge,
  walkEntry,
  type DropPlan,
  type DroppedFile,
} from "../file-drop";
import { stripEnvPrompt, textOf, type AgentMode } from "../persist";
import { detectDesktopOs } from "../platform";
import { useRipple } from "../useRipple";
import type { QueuedMessage } from "../queued-message";
import { AttachMenu } from "./AttachMenu";
import { AgentModeSelect } from "./AgentModeSelect";
import { AtMenu } from "./AtMenu";
import { ComposerActionsMenu, type ComposerAction } from "./ComposerActionsMenu";
import { SlashMenu } from "./SlashMenu";
import { ComposerEditor, type ComposerHandle } from "./ComposerEditor";
import { IconButton } from "./IconButton";
import { kindIcon, UserRichText } from "./MentionChip";
import { Markdown } from "./Markdown";
import { ImagePreview } from "./ImagePreview";
import { QueuedMessageList } from "./QueuedMessageList";
import { RippleButton } from "./RippleButton";
import { TextFold } from "./TextFold";
import { ArtifactList } from "./ArtifactList";
import { TodoList } from "./TodoList";
import { ToolCard } from "./ToolCard";

const STICKY_PX = 96;
/** Where the "copy/cut carried the attachments" payload waits for its paste. */
const COMPOSER_CARRY_KEY = "opensiderComposerCarry";

function stickToBottom(node: HTMLElement | null, smooth = false): void {
  if (!node) return;
  node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
}

export function ChatPane({
  locale,
  hostReady,
  sessionId,
  messages,
  isRunning,
  pickingElement,
  models,
  modelId,
  showModelPicker,
  onSend,
  onEnqueue,
  onUpdateQueued,
  onDeleteQueued,
  onSendQueuedNow,
  onEditingQueued,
  onRevise,
  onCancel,
  onFork,
  onRegenerate,
  onPickAttachments,
  onPasteImages,
  onUploadFiles,
  onPickElement,
  onCancelElementPick,
  onPreviewImage,
  onModel,
  agentMode,
  onAgentMode,
  agentModes,
  agentModeId,
  onAgentModeId,
  iconOnly,
  narrowModel,
  flatActions,
  skills,
  onRefreshSkills,
  agentOptions,
  onAgentOption,
  page,
  hitl,
  control,
  todos,
  artifacts,
  onRevealArtifact,
  notice,
  onDismissNotice,
  queue,
}: {
  locale: Locale;
  hostReady: boolean;
  sessionId: string;
  messages: ChatMessage[];
  isRunning: boolean;
  pickingElement: boolean;
  models: AgentModel[];
  modelId: string;
  showModelPicker: boolean;
  hitl?: ReactNode;
  /** Tab-control banner / borrow-request card, stacked above the todo list. */
  control?: ReactNode;
  todos?: TodoItem[];
  artifacts?: AttachmentItem[];
  onRevealArtifact?: (path: string) => void;
  /** Something the user just tried did not work (a drop, a paste, a stale bridge). */
  notice?: string;
  onDismissNotice?: () => void;
  queue: QueuedMessage[];
  onSend: (text: string, attachments: AttachmentItem[]) => void;
  onEnqueue: (text: string, attachments: AttachmentItem[]) => void;
  onUpdateQueued: (id: string, text: string, attachments: AttachmentItem[]) => void;
  onDeleteQueued: (id: string) => void;
  onSendQueuedNow: (id: string) => void;
  onEditingQueued: (id?: string) => void;
  onRevise: (messageId: string, text: string, attachments: AttachmentItem[]) => void;
  onCancel: () => void;
  onFork: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
  onPickAttachments: (mode?: FsPickMode) => Promise<AttachmentItem[]>;
  onPasteImages: (files: File[]) => Promise<AttachmentItem[]>;
  onUploadFiles: (plan: DropPlan) => Promise<AttachmentItem[]>;
  onPickElement: () => Promise<AttachmentItem[]>;
  onCancelElementPick: () => void;
  onPreviewImage: (path: string) => Promise<string>;
  onModel: (modelId: string) => void;
  agentMode: AgentMode;
  onAgentMode: (mode: AgentMode) => void;
  /** 该 Agent 自己广告的会话模式（plan / build / ask…）；少于两项时控件不出现。 */
  agentModes?: AgentModeOption[];
  agentModeId?: string;
  onAgentModeId?: (modeId: string) => void;
  /** ≤448px：两个下拉收成纯图标（隐藏文案，tooltip 里给全）。 */
  iconOnly?: boolean;
  /** ≥600px：四个功能钮（附件 / 拾取 / @ / 斜杠）平铺；否则收成一个加号钮。 */
  flatActions?: boolean;
  /** 本机全局已装的 skill，斜杠探测菜单列的就是它（与连哪个 Agent 无关）。 */
  skills?: SkillItem[];
  /** 打开探测菜单前要一份最新列表（Host 侧有缓存，不会每次都真扫）。 */
  onRefreshSkills?: () => void;
  /** ≤396px：模型下拉的最大宽度收到常值的 1/3；推理档位钮收到 OPTION_NARROW_MAX_PX。 */
  narrowModel?: boolean;
  /** 引擎广告的其它会话配置项（推理档位、模型开关…），没广告就是这家不支持。 */
  agentOptions?: AgentOption[];
  onAgentOption?: (configId: string, value: string) => void;
  page?: CurrentPage;
}) {
  // 引擎广告的其它配置项按类别分流：`thought_level` 是模型钮旁边的推理档位钮，
  // `model_config` 放进模型菜单里——工具栏这一行已经挤不下更多钮了。
  const thoughtLevel = (agentOptions ?? []).find((option) => option.category === "thought_level");
  const modelConfigOptions = (agentOptions ?? []).filter((option) => option.category === "model_config");
  const [draft, setDraft] = useState("");  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [pickingFiles, setPickingFiles] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const paperclipRef = useRef<HTMLSpanElement>(null);
  const [savingPaste, setSavingPaste] = useState(false);
  const [dropping, setDropping] = useState(false);
  const carryRef = useRef<ComposerCarry | null>(null);
  const [editingId, setEditingId] = useState<string>();
  const [editingQueueId, setEditingQueueId] = useState<string>();
  const [stash, setStash] = useState<{ draft: string; attachments: AttachmentItem[] } | null>(null);
  const [atOpen, setAtOpen] = useState(false);
  const [atQuery, setAtQuery] = useState("");
  const composerRef = useRef<ComposerHandle>(null);
  const atButtonRef = useRef<HTMLSpanElement>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const slashButtonRef = useRef<HTMLSpanElement>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const plusButtonRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { tabs: historyTabs } = useComposerHistory();
  const threadEndRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef<string | undefined>(undefined);
  const editingQueueRef = useRef<string | undefined>(undefined);
  const onEditingQueuedRef = useRef(onEditingQueued);
  const [preview, setPreview] = useState<{ name: string; path: string }>();
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const startEditRef = useRef<(message: ChatMessage) => void>(() => {});
  const onStartEdit = useCallback((message: ChatMessage) => {
    startEditRef.current(message);
  }, []);
  editingRef.current = editingId;
  editingQueueRef.current = editingQueueId;
  onEditingQueuedRef.current = onEditingQueued;
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const canSend = Boolean(composerHasContent(draft) || attachments.length);
  const locking = pickingFiles || pickingElement || savingPaste;
  const busy = locking;

  const mergeAttachments = (items: AttachmentItem[]) => {
    setAttachments((current) => mergeAttachmentItems(current, items));
  };

  /**
   * Copy/cut with the whole composer selected also carries the attachment bar, so a draft
   * can be moved to another session without re-uploading its files. The payload goes into
   * extension storage rather than the clipboard (Chromium drops custom clipboard flavours
   * and we must not leak markers into other apps); a later paste of exactly that text
   * restores it. Carrying is all this does: copy and cut both leave the bar alone, and cut
   * only loses the text because that is what the browser's own cut does.
   */
  const carryAttachments = () => {
    if (attachments.length === 0) return;
    const payload = encodeComposerCarry({ text: draft, attachments, at: Date.now() });
    carryRef.current = decodeComposerCarry(payload) ?? null;
    void chrome.storage.session.set({ [COMPOSER_CARRY_KEY]: payload }).catch(() => undefined);
  };

  /** A paste whose text is exactly what was copied: bring the attachments along, once. */
  const restoreCarriedAttachments = (pastedText: string) => {
    const apply = (carry: ComposerCarry | null) => {
      if (!composerCarryMatches(carry ?? undefined, pastedText, Date.now())) return;
      carryRef.current = null;
      void chrome.storage.session.remove(COMPOSER_CARRY_KEY).catch(() => undefined);
      mergeAttachments(carry!.attachments);
    };
    if (carryRef.current) {
      apply(carryRef.current);
      return;
    }
    // Another panel page (or a fresh mount) may hold the payload.
    void chrome.storage.session
      .get(COMPOSER_CARRY_KEY)
      .then((raw) => apply(decodeComposerCarry(raw?.[COMPOSER_CARRY_KEY] as string) ?? null))
      .catch(() => undefined);
  };

  const openAtMenu = () => {
    openAtMenuLock();
    setAtOpen(true);
  };

  const closeAtMenu = () => {
    closeAtMenuLock();
    setAtOpen(false);
    setAtQuery("");
  };

  const openSlashMenu = () => {
    openAtMenuLock();
    setSlashOpen(true);
  };

  const closeSlashMenu = () => {
    closeAtMenuLock();
    setSlashOpen(false);
    setSlashQuery("");
  };

  const handleSlashQueryChange = (query: string | null) => {
    if (query === null) {
      closeSlashMenu();
      return;
    }
    setSlashQuery(query);
  };

  /**
   * 两个菜单互斥：同一个位置不能同时挂两个弹层，而 `@` 与 `/` 又是在同一个输入框里打字。
   */
  const startAtMenu = () => {
    if (atOpen) {
      closeAtMenu();
      return;
    }
    if (slashOpen) closeSlashMenu();
    composerRef.current?.insertAtStart("@");
    openAtMenu();
  };

  const startSlashMenu = () => {
    if (slashOpen) {
      closeSlashMenu();
      return;
    }
    if (atOpen) closeAtMenu();
    onRefreshSkills?.();
    composerRef.current?.insertAtStart("/");
    openSlashMenu();
  };

  /** 直接在输入框里敲 `@` / `/` 的路径：只负责打开，不做「再敲一下关掉」。 */
  const onAtTyped = () => {
    if (slashOpen) closeSlashMenu();
    openAtMenu();
  };

  const onSlashTyped = () => {
    if (atOpen) closeAtMenu();
    onRefreshSkills?.();
    openSlashMenu();
  };

  const handleAtQueryChange = (query: string | null) => {
    if (query === null) {
      closeAtMenu();
      return;
    }
    setAtQuery(query);
  };

  const submit = (fromEnter = false) => {
    if (fromEnter && shouldBlockSubmit()) return;
    if (!canSend || savingPaste) return;
    if (editingId && isRunning) return;
    const text = draft.trim();
    const files = attachments;
    const reviseId = editingId;
    const queueEditId = editingQueueId;
    setDraft("");
    setAttachments([]);
    setEditingId(undefined);
    setEditingQueueId(undefined);
    setStash(null);
    closeAtMenu();
    if (reviseId) onRevise(reviseId, text, files);
    else if (queueEditId) onUpdateQueued(queueEditId, text, files);
    else if (isRunning) onEnqueue(text, files);
    else onSend(text, files);
    requestAnimationFrame(() => stickToBottom(listRef.current));
  };

  const restoreStash = () => {
    setDraft(stash?.draft ?? "");
    setAttachments(stash?.attachments ?? []);
    setStash(null);
  };

  const cancelEdit = () => {
    restoreStash();
    setEditingId(undefined);
  };

  const cancelQueueEdit = () => {
    restoreStash();
    setEditingQueueId(undefined);
    onEditingQueued();
  };

  const beginComposerEdit = () => {
    if (!editingId && !editingQueueId) setStash({ draft, attachments });
  };

  const startEdit = (message: ChatMessage) => {
    if (isRunning || pickingElement) return;
    beginComposerEdit();
    if (editingQueueId) onEditingQueued();
    setEditingQueueId(undefined);
    setEditingId(message.id);
    setDraft(stripEnvPrompt(textOf(message.content)));
    setAttachments(message.attachments ? [...message.attachments] : []);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.moveCaretToEnd();
    });
  };
  startEditRef.current = startEdit;

  const openPreview = useCallback((item: AttachmentItem) => {
    if (item.kind !== "image") return;
    setPreview({ name: item.name, path: item.path });
  }, []);

  const startQueueEdit = (item: QueuedMessage) => {
    if (pickingElement) return;
    beginComposerEdit();
    setEditingId(undefined);
    setEditingQueueId(item.id);
    setDraft(item.text);
    setAttachments(item.attachments ? [...item.attachments] : []);
    onEditingQueued(item.id);
    requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.moveCaretToEnd();
    });
  };

  const removeQueued = (id: string) => {
    if (editingQueueId === id) {
      restoreStash();
      setEditingQueueId(undefined);
    }
    onDeleteQueued(id);
  };

  const sendQueuedNow = (id: string) => {
    if (editingQueueId === id) {
      restoreStash();
      setEditingQueueId(undefined);
    }
    onSendQueuedNow(id);
  };

  useEffect(() => {
    installAtMenuGuard();
  }, []);

  useEffect(() => {
    const wasEditing = editingRef.current;
    const wasQueueEdit = editingQueueRef.current;
    setEditingId(undefined);
    setEditingQueueId(undefined);
    setStash(null);
    closeAtMenu();
    if (wasQueueEdit) onEditingQueuedRef.current();
    if (wasEditing || wasQueueEdit) {
      setDraft("");
      setAttachments([]);
    }
    setAwayFromBottom(false);
    setAttachOpen(false);
    setPlusOpen(false);
    closeSlashMenu();
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

  const addAttachments = async (mode: FsPickMode) => {
    if (busy) return;
    setAttachOpen(false);
    setPickingFiles(true);
    try {
      mergeAttachments(await onPickAttachments(mode));
    } finally {
      setPickingFiles(false);
    }
  };

  const onPaperclip = () => {
    if (busy) return;
    if (!hostReady) {
      void addAttachments("mixed");
      return;
    }
    if (detectDesktopOs() === "macos") {
      void addAttachments("mixed");
      return;
    }
    setAttachOpen((open) => !open);
  };

  // 收起来的加号菜单：Windows 把「文件 / 文件夹」拆成两条（系统框不能混选），其它系统
  // 合成一条「添加附件」（macOS 本来就开一个混选的框，Linux 再弹二级菜单）。
  const actionItems: ComposerAction[] =
    detectDesktopOs() === "windows"
      ? [
          { id: "files", label: label("pickFiles"), icon: File },
          { id: "folders", label: label("pickFolders"), icon: Folder },
          { id: "pick", label: label("pickElement"), icon: MousePointer2 },
          { id: "mention", label: label("mention"), icon: AtSign },
          { id: "slash", label: label("slash"), icon: Slash },
        ]
      : [
          { id: "attach", label: label("attach"), icon: Paperclip },
          { id: "pick", label: label("pickElement"), icon: MousePointer2 },
          { id: "mention", label: label("mention"), icon: AtSign },
          { id: "slash", label: label("slash"), icon: Slash },
        ];

  const runAction = (id: string) => {
    setPlusOpen(false);
    if (id === "files" || id === "folders") {
      void addAttachments(id);
      return;
    }
    if (id === "attach") {
      onPaperclip();
      return;
    }
    if (id === "pick") {
      void startElementPick();
      return;
    }
    if (id === "mention") {
      startAtMenu();
      return;
    }
    if (id === "slash") startSlashMenu();
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

  /** Drops land here: the bytes go to the host, which writes them into the workspace. */
  const addDroppedFiles = async (plan: DropPlan) => {
    // Even an empty plan is handed over: the uploader is what tells the user why nothing
    // was attached (too large, too many, unreadable, host silent), and a drop that ends in
    // silence is the bug we are not allowed to have.
    mergeAttachments(await onUploadFiles(plan));
  };

  // The whole panel accepts files, not just the composer: dropping one used to hand it to
  // the browser, which opened it and navigated away from the conversation.
  useEffect(() => {
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    let depth = 0;
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth += 1;
      setDropping(true);
    };
    const onOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDropping(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDropping(false);
      // `items` is only readable during the event, so capture the entries now.
      const captured = collectDrop(event.dataTransfer);
      void (async () => {
        const skipped = emptySkips();
        skipped.tooMany += captured.skippedTooMany;
        const files: DroppedFile[] = [];
        for (const item of captured.entries) {
          await walkEntry(item.entry, item.dir, files, skipped, item.fallback);
        }
        for (const file of captured.plainFiles) {
          if (files.length >= MAX_DROP_FILES) {
            skipped.tooMany += 1;
            continue;
          }
          if (isTooLarge(file.size)) {
            skipped.tooLarge += 1;
            continue;
          }
          files.push({ name: file.name, file });
        }
        await addDroppedFiles({ files, skipped });
      })();
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragover", onOver);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [onUploadFiles]);

  const startElementPick = async () => {
    if (pickingElement) {
      onCancelElementPick();
      return;
    }
    if (pickingFiles || savingPaste) return;
    mergeAttachments(await onPickElement());
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {dropping ? (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[1px]">
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--brass)] bg-[var(--panel)]/85 text-[var(--text)]">
            <FileDown size={28} className="text-[var(--brass)]" />
            <p className="text-[13px] font-medium">{label("dropToAttach")}</p>
          </div>
        </div>
      ) : null}
      {messages.length === 0 ? (
        <div className="flex min-h-0 w-full flex-1 select-none flex-col items-center justify-center">
          <img src={logoUrl} alt="" width={120} height={120} aria-hidden="true" draggable={false} className="opacity-30 saturate-[.2]" />
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
            <MessageThread
              locale={locale}
              messages={messages}
              isRunning={isRunning}
              editingId={editingId}
              models={models}
              page={page}
              onStartEdit={onStartEdit}
              onPreview={openPreview}
              onFork={onFork}
              onRegenerate={onRegenerate}
            />
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
        {control}
        <TodoList locale={locale} todos={todos ?? []} />
        {hitl}
        <ArtifactList locale={locale} items={artifacts ?? []} onReveal={(path) => onRevealArtifact?.(path)} />
        <QueuedMessageList
          locale={locale}
          items={queue}
          editingId={editingQueueId}
          onSendNow={sendQueuedNow}
          onEdit={startQueueEdit}
          onDelete={removeQueued}
        />
        <div className={`cs-composer rounded-xl bg-[var(--panel)] px-2 py-2 ${isRunning ? "is-running" : ""}`}>
          {editingQueueId ? (
            <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--muted)]">
                {label("editQueueHint")}
              </p>
              <RippleButton
                onClick={cancelQueueEdit}
                className="cs-hover-brass shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--brass)]"
              >
                {label("cancelQueueEdit")}
              </RippleButton>
            </div>
          ) : editingId ? (
            <div className="mb-1.5 flex items-start justify-between gap-2 px-1">
              <p className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--muted)]">
                {label("editHistoryHint")}
              </p>
              <RippleButton
                onClick={cancelEdit}
                className="cs-hover-brass shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--brass)]"
              >
                {label("cancelEdit")}
              </RippleButton>
            </div>
          ) : null}
          {notice ? (
            <div className="mb-1.5 flex items-start gap-1.5 px-1 text-[11px] leading-snug text-[var(--warn)]">
              <TriangleAlert size={12} className="mt-[1px] shrink-0" />
              <p className="min-w-0 flex-1">{notice}</p>
              <button
                type="button"
                onClick={onDismissNotice}
                aria-label={label("dismissNotice")}
                title={label("dismissNotice")}
                className="shrink-0 rounded text-[var(--muted)] hover:text-[var(--text)]"
              >
                <X size={12} />
              </button>
            </div>
          ) : null}
          {attachments.length > 0 ? (
            <AttachmentChips
              items={attachments}
              removable
              removeLabel={label("removeAttachment")}
              previewLabel={label("previewImage")}
              onPreview={openPreview}
              onRemove={(path) => {
                setAttachments((current) => current.filter((item) => item.path !== path));
                setDraft((current) => stripAttachmentMentions(current, path));
              }}
              className="mb-1.5 px-1"
            />
          ) : null}
          <ComposerEditor
            ref={composerRef}
            value={draft}
            placeholder={label("placeholder")}
            menuOpen={atOpen}
            slashMenuOpen={slashOpen}
            onChange={setDraft}
            onSubmit={() => submit(true)}
            onPasteImages={(files) => void addPastedImages(files)}
            onComposerClipboardCarry={carryAttachments}
            onComposerPastedText={restoreCarriedAttachments}
            onAtTyped={onAtTyped}
            onAtQueryChange={handleAtQueryChange}
            onSlashTyped={onSlashTyped}
            onSlashQueryChange={handleSlashQueryChange}
          />
          <div className="flex min-w-0 items-center gap-2">
            <div className="relative flex min-w-0 flex-1 items-center gap-1">
              <div className="flex shrink-0 items-center gap-0">
                {flatActions === false ? (
                  // <600px：四个功能钮收成一个加号钮（hover 或点击弹出）。
                  <span ref={plusButtonRef} onMouseEnter={() => setPlusOpen(true)}>
                    <IconButton
                      side="top"
                      label={label("moreActions")}
                      onClick={() => setPlusOpen((open) => !open)}
                      disabled={busy}
                      className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                        plusOpen || attachOpen ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                      }`}
                    >
                      {pickingFiles || savingPaste ? (
                        <LoaderCircle size={COMPOSER_ICON_PX} className="animate-spin" />
                      ) : (
                        <Plus size={COMPOSER_ICON_PX} />
                      )}
                    </IconButton>
                  </span>
                ) : (
                  <>
                    <span ref={paperclipRef}>
                      <IconButton
                        side="top"
                        label={label("attach")}
                        onClick={onPaperclip}
                        disabled={busy}
                        className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                          attachOpen ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                        }`}
                      >
                        {pickingFiles || savingPaste ? (
                          <LoaderCircle size={COMPOSER_ICON_PX} className="animate-spin" />
                        ) : (
                          <Paperclip size={COMPOSER_ICON_PX} />
                        )}
                      </IconButton>
                    </span>
                    <IconButton
                      side="top"
                      label={label("pickElement")}
                      onClick={() => void startElementPick()}
                      disabled={locking}
                      className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                        pickingElement ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                      }`}
                    >
                      <MousePointer2 size={COMPOSER_ICON_PX} />
                    </IconButton>
                    <span ref={atButtonRef}>
                      <IconButton
                        side="top"
                        label={label("mention")}
                        onClick={startAtMenu}
                        disabled={locking}
                        className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                          atOpen ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                        }`}
                      >
                        <AtSign size={COMPOSER_ICON_PX} />
                      </IconButton>
                    </span>
                    <span ref={slashButtonRef}>
                      <IconButton
                        side="top"
                        label={label("slash")}
                        onClick={startSlashMenu}
                        disabled={locking}
                        className={`flex h-7 w-7 items-center justify-center rounded-full hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent ${
                          slashOpen ? "bg-[var(--hover)] text-[var(--brass)]" : "text-[var(--text)]"
                        }`}
                      >
                        <Slash size={COMPOSER_ICON_PX} />
                      </IconButton>
                    </span>
                  </>
                )}
                <ComposerActionsMenu
                  open={plusOpen}
                  items={actionItems}
                  ignoreRef={plusButtonRef}
                  getAnchorRect={() => plusButtonRef.current?.getBoundingClientRect()}
                  onPick={runAction}
                  onClose={() => setPlusOpen(false)}
                />
                <AttachMenu
                  open={attachOpen}
                  locale={locale}
                  ignoreRef={paperclipRef}
                  getAnchorRect={() => (paperclipRef.current ?? plusButtonRef.current)?.getBoundingClientRect()}
                  onPick={(mode) => void addAttachments(mode)}
                  onClose={() => setAttachOpen(false)}
                />
              </div>
              {/* 两个下拉之间的间距跟图标钮那组一样（gap-1），不要把两个钮贴死。 */}
              <div className="flex min-w-0 items-center gap-1">
                <AgentModeSelect
                  locale={locale}
                  options={agentModes ?? []}
                  currentId={agentModeId ?? ""}
                  iconOnly={iconOnly === true}
                  onMode={onAgentModeId ?? (() => undefined)}
                />
                <ModeSelect locale={locale} mode={agentMode} iconOnly={iconOnly === true} onMode={onAgentMode} />
              </div>
              <AtMenu
                open={atOpen}
                locale={locale}
                query={atQuery}
                tabs={historyTabs}
                attachments={attachments}
                ignoreRef={atButtonRef}
                getAnchorRect={() => composerRef.current?.getCaretRect()}
                onSelect={(mention) => {
                  if (
                    mention.kind === "attachment" &&
                    !attachments.some((item) => item.path === mention.path)
                  ) {
                    return;
                  }
                  composerRef.current?.insertMention(mention);
                }}
                onClose={closeAtMenu}
              />
              <SlashMenu
                open={slashOpen}
                locale={locale}
                query={slashQuery}
                skills={skills ?? []}
                ignoreRef={slashButtonRef}
                getAnchorRect={() => composerRef.current?.getCaretRect()}
                onQuery={setSlashQuery}
                onSelect={(skill) => composerRef.current?.insertSkill({ kind: "skill", name: skill.name })}
                onClose={closeSlashMenu}
              />
            </div>
            <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
              {showModelPicker ? (
                <ModelSelect
                  locale={locale}
                  models={models}
                  modelId={modelId}
                  narrow={narrowModel}
                  onModel={onModel}
                  modelConfigs={modelConfigOptions}
                  onConfig={onAgentOption}
                />
              ) : null}
              {/* 推理档位紧跟模型下拉右侧（引擎不广告 thought_level 就整个不出现）。 */}
              <AgentOptionSelect
                option={thoughtLevel}
                narrow={narrowModel === true}
                onValue={(configId, value) => onAgentOption?.(configId, value)}
              />
              {isRunning ? (
                <IconButton
                  side="top"
                  label={label("stop")}
                  onClick={onCancel}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
                >
                  <Square size={COMPOSER_ICON_PX} />
                </IconButton>
              ) : null}
              <IconButton
                side="top"
                label={label("send")}
                onClick={submit}
                disabled={!canSend || savingPaste || Boolean(editingId && isRunning)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Send size={COMPOSER_ICON_PX} />
              </IconButton>
            </div>
          </div>
        </div>
        </div>
      </div>
      {preview ? (
        <ImagePreview
          locale={locale}
          name={preview.name}
          path={preview.path}
          loadSrc={onPreviewImage}
          onClose={() => setPreview(undefined)}
        />
      ) : null}
    </div>
  );
}

const MessageThread = memo(function MessageThread({
  locale,
  messages,
  isRunning,
  editingId,
  models,
  page,
  onStartEdit,
  onPreview,
  onFork,
  onRegenerate,
}: {
  locale: Locale;
  messages: ChatMessage[];
  isRunning: boolean;
  editingId?: string;
  models: AgentModel[];
  page?: CurrentPage;
  onStartEdit: (message: ChatMessage) => void;
  onPreview: (item: AttachmentItem) => void;
  onFork: (messageId: string) => void;
  onRegenerate: (messageId: string) => void;
}) {
  return (
    <>
      {messages.map((message, index) => {
        const gap = index === 0 ? "" : message.role === "user" ? "mt-6" : "mt-3";
        return message.role === "user" ? (
          <div key={message.id} className={`flex justify-end ${gap}`}>
            <div
              role={isRunning ? undefined : "button"}
              tabIndex={isRunning ? undefined : 0}
              onClick={() => {
                if (!isRunning) onStartEdit(message);
              }}
              onKeyDown={(event) => {
                if (isRunning) return;
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onStartEdit(message);
                }
              }}
              className={`cs-user-bubble ml-auto w-fit max-w-[80%] break-words rounded-2xl rounded-br-sm bg-[var(--user)] px-3 py-2 text-left text-[13.5px] leading-[1.5] ${
                editingId === message.id
                  ? "ring-1 ring-[var(--brass)]"
                  : isRunning
                    ? "cursor-default"
                    : "cursor-pointer hover:bg-[var(--user-hover)]"
              }`}
            >
              {stripEnvPrompt(textOf(message.content)) ? (
                <UserRichText text={stripEnvPrompt(textOf(message.content))} />
              ) : null}
              {message.attachments?.length ? (
                <AttachmentChips
                  items={message.attachments}
                  previewLabel={t(locale, "previewImage")}
                  onPreview={onPreview}
                  className={stripEnvPrompt(textOf(message.content)) ? "mt-2" : ""}
                />
              ) : null}
            </div>
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
              live={isRunning && message.durationMs == null && message.id === messages[messages.length - 1]?.id}
              durationMs={message.durationMs}
            />
          </MessageFrame>
        );
      })}
    </>
  );
});

function AttachmentChips({
  items,
  removable,
  removeLabel,
  previewLabel,
  onPreview,
  onRemove,
  className = "",
}: {
  items: AttachmentItem[];
  removable?: boolean;
  removeLabel?: string;
  previewLabel?: string;
  onPreview?: (item: AttachmentItem) => void;
  onRemove?: (path: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {items.map((item) => {
        const Icon = kindIcon(item.kind);
        const previewable = item.kind === "image" && Boolean(onPreview);
        return (
          <span
            key={item.path}
            title={item.path}
            className="inline-flex max-w-[200px] items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--panel-2)] py-0.5 pl-1.5 pr-1 text-[11px] text-[var(--muted)]"
          >
            <RippleButton
              type="button"
              disabled={!previewable}
              title={previewable ? previewLabel : item.path}
              aria-label={previewable ? previewLabel : undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (previewable && onPreview) onPreview(item);
              }}
              className={`inline-flex min-w-0 flex-1 items-center gap-1 rounded-full text-left disabled:hover:bg-transparent ${
                previewable ? "cursor-pointer" : "cursor-default"
              }`}
            >
              <Icon size={12} className="shrink-0 opacity-80" />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
            </RippleButton>
            {removable && onRemove ? (
              <RippleButton
                title={removeLabel}
                aria-label={removeLabel}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item.path);
                }}
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

function ModeSelect({
  locale,
  mode,
  iconOnly,
  onMode,
}: {
  locale: Locale;
  mode: AgentMode;
  iconOnly: boolean;
  onMode: (mode: AgentMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current =
    mode === "unattended"
      ? { icon: Unlock, name: t(locale, "modeUnattended"), hint: t(locale, "modeUnattendedHint") }
      : mode === "auto"
        ? { icon: Zap, name: t(locale, "modeAuto"), hint: t(locale, "modeAutoHint") }
        : mode === "workspace"
          ? { icon: FolderPen, name: t(locale, "modeWorkspace"), hint: t(locale, "modeWorkspaceHint") }
          : { icon: Shield, name: t(locale, "modeAsk"), hint: t(locale, "modeAskHint") };
  const CurrentIcon = current.icon;
  // 窄宽度只留图标，所以 tooltip 必须自带含义（「名称 — 含义」）。
  const tip = `${current.name} — ${current.hint}`;
  const options: Array<{ id: AgentMode; icon: typeof Shield; name: string; hint: string }> = [
    { id: "ask", icon: Shield, name: t(locale, "modeAsk"), hint: t(locale, "modeAskHint") },
    { id: "workspace", icon: FolderPen, name: t(locale, "modeWorkspace"), hint: t(locale, "modeWorkspaceHint") },
    { id: "auto", icon: Zap, name: t(locale, "modeAuto"), hint: t(locale, "modeAutoHint") },
    { id: "unattended", icon: Unlock, name: t(locale, "modeUnattended"), hint: t(locale, "modeUnattendedHint") },
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
    // 不参与撑开：两个下拉与左侧三个图标钮紧挨成一组居左，多余空间留给右侧的
    // 模型选择 / 发送（所以不要 flex-1，否则会被拉宽推到中间）。
    <div ref={rootRef} className={`relative min-w-0 shrink ${iconOnly ? "" : "min-w-[5rem] max-w-full"}`}>
      <button
        type="button"
        title={tip}
        aria-label={tip}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        // 内边距对称 px-2，与模式钮一致。
        className={`relative flex h-7 max-w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 text-[11px] hover:bg-[var(--hover)] ${
          mode === "ask" ? "text-[var(--muted)]" : "text-[var(--brass)]"
        }`}
      >
        <CurrentIcon size={COMPOSER_ICON_PX} className="shrink-0" />
        {iconOnly ? null : <span className="min-w-0 truncate">{current.name}</span>}
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
        <div className="absolute bottom-full left-0 z-[80] mb-1.5 w-64 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
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
                  <Icon size={COMPOSER_ICON_PX} />
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
  narrow,
  onModel,
  modelConfigs,
  onConfig,
}: {
  locale: Locale;
  models: AgentModel[];
  modelId: string;
  disabled?: boolean;
  /** ≤MODEL_NARROW_MAIN_PX：最大宽度收到常值的 1/3。 */
  narrow?: boolean;
  onModel: (modelId: string) => void;
  /**
   * `model_config` 类配置项（Claude 的 `Fast mode`、Cursor 的 `Fast`…）。它们不是独立
   * 控件，而是排在模型菜单底部：这一行已经挤不下更多钮，而这几个开关本来就是「模型
   * 自身的设置」，跟着模型菜单走最自然。
   */
  modelConfigs?: AgentOption[];
  onConfig?: (configId: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState(modelId);
  // 这一行到 396px 时已经挤了五个控件，模型名是唯一能让位的：上限从 9.5rem 收到 80px。
  // 宽度用常量（而不是这里写死一个类），保证这个数值在代码里只有一个来源。
  const shellMax = narrow ? undefined : "max-w-[9.5rem]";
  const shellStyle = narrow ? { maxWidth: MODEL_NARROW_MAX_PX } : undefined;
  const rootRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = models.find((model) => model.id === modelId) ?? models[0];
  const label = current?.name || modelId || t(locale, "model");
  const visible = models.filter((model) => matchesModel(model, query));
  // 只画「有值可切」的项：布尔项（开关）或至少两个值的选择项。
  const configs = (modelConfigs ?? []).filter(
    (option) => option.type === "boolean" || (option.values?.length ?? 0) >= 2,
  );

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
    <div ref={rootRef} className={`relative min-w-0 ${shellMax ?? ""}`} style={shellStyle}>
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
        style={shellStyle}
        className={`relative flex h-7 w-full min-w-0 ${shellMax ?? ""} items-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-[var(--line)] bg-[var(--panel-2)] px-2 text-[11px] text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-40`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown size={COMPOSER_ICON_PX} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
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
          {configs.length > 0 ? (
            <div className="shrink-0 border-t border-[var(--line)] py-1">
              {configs.map((option) => (
                <ModelConfigRow key={option.id} option={option} onConfig={onConfig} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 模型菜单底部的一行 `model_config`：布尔项画成开关（引擎没给值名，开关正好不需要文案），
 * 多值项逐个列出引擎给的值名并给当前值打勾。名称一律用引擎自己的，不翻译。
 */
function ModelConfigRow({
  option,
  onConfig,
}: {
  option: AgentOption;
  onConfig?: (configId: string, value: string) => void;
}) {
  const boolean = option.type === "boolean";
  const values = option.values ?? [];
  if (!boolean && values.length < 2) return null;
  const on = option.current === "true";
  return (
    <div>
      {boolean ? (
        <button
          type="button"
          title={option.name}
          aria-pressed={on}
          onClick={() => onConfig?.(option.id, on ? "false" : "true")}
          className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[12px] text-[var(--muted)] hover:text-[var(--text)]"
        >
          <span className="min-w-0 truncate">{option.name}</span>
          <span
            aria-hidden
            className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${
              on ? "bg-[var(--brass)]" : "bg-[var(--line)]"
            }`}
          >
            <span
              className={`absolute top-0.5 h-3 w-3 rounded-full bg-[var(--panel)] transition-transform ${
                on ? "translate-x-3.5" : "translate-x-0.5"
              }`}
            />
          </span>
        </button>
      ) : (
        <>
          <p className="px-2.5 py-1 text-[11px] text-[var(--muted)]">{option.name}</p>
          {values.map((value) => {
            const active = value.id === option.current;
            return (
              <RippleButton
                key={value.id}
                title={value.desc ? `${value.name || value.id} — ${value.desc}` : undefined}
                onClick={() => onConfig?.(option.id, value.id)}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] ${
                  active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <Check size={COMPOSER_ICON_PX} className={active ? "shrink-0" : "shrink-0 opacity-0"} />
                <span className="min-w-0 truncate">{value.name || value.id}</span>
              </RippleButton>
            );
          })}
        </>
      )}
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
      const prev = visible[visible.length - 1];
      if (prev && prev.part.type !== "text") visible.pop();
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

function renderAssistantPart(
  part: ChatPart,
  index: number,
  locale: Locale,
  page?: CurrentPage,
  live?: boolean,
  lastIndex?: number,
) {
  if (part.type === "text") return <Markdown key={index} text={part.text} page={page} />;
  if (part.type === "reasoning") {
    const thinking = Boolean(live && lastIndex != null && index === lastIndex);
    return (
      <TextFold
        key={index}
        label={t(locale, "thinking")}
        paneClass="cs-fold-scroll"
        icon={
          thinking ? (
            <span className="inline-flex shrink-0 text-[var(--muted)]">
              <LoaderCircle size={12} className="animate-spin" />
            </span>
          ) : undefined
        }
      >
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
  const lastIndex = content.length - 1;
  if (!fold) {
    const items = live ? liveVisibleParts(content) : content.map((part, index) => ({ part, index }));
    return (
      <div className="space-y-1">
        {items.map(({ part, index }) => renderAssistantPart(part, index, locale, page, live, lastIndex))}
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
