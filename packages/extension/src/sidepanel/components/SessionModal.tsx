import { GitFork, MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Locale, MessageKey } from "../i18n";
import { t } from "../i18n";
import type { Session } from "../persist";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

function displayTitle(session: Session, locale: Locale): string {
  return session.title.trim() || t(locale, "untitled");
}

function matchesSession(session: Session, query: string, locale: Locale): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return displayTitle(session, locale).toLowerCase().includes(needle);
}

export function SessionModal({
  locale,
  sessions,
  selectedId,
  locked,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onClose,
}: {
  locale: Locale;
  sessions: Session[];
  selectedId: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const label = (key: MessageKey) => t(locale, key);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState(selectedId);
  const [editingId, setEditingId] = useState<string>();
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const visible = useMemo(() => {
    return sessions
      .filter((session) => matchesSession(session, query, locale))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [locale, query, sessions]);

  const pick = (id: string) => {
    if (locked && id !== selectedId) return;
    onSelect(id);
    onClose();
  };

  const moveHighlight = (delta: number) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((session) => session.id === highlightId);
    const from = idx >= 0 ? idx : 0;
    setHighlightId(visible[(from + delta + visible.length) % visible.length].id);
  };

  const onFilterChange = (value: string) => {
    setQuery(value);
    const next = sessions
      .filter((session) => matchesSession(session, value, locale))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    setHighlightId((id) => (next.some((session) => session.id === id) ? id : (next[0]?.id ?? "")));
  };

  useEffect(() => {
    setHighlightId(selectedId);
    const focus = () => filterRef.current?.focus();
    focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (editingId && event.target instanceof HTMLInputElement && event.target !== filterRef.current) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
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
        const chosen = visible.find((session) => session.id === highlightId) ?? visible[0];
        if (chosen) pick(chosen.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingId, highlightId, locked, onClose, selectedId, visible]);

  useLayoutEffect(() => {
    if (!highlightId) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(highlightId)}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={label("sessions")}
        className="flex w-[min(22rem,calc(100%-1.5rem))] max-h-[calc(100dvh-400px)] flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-1.5 px-2 py-1.5">
          <RippleButton
            disabled={locked}
            onClick={() => {
              onNew();
              onClose();
            }}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[12px] text-[var(--text)] disabled:opacity-40"
          >
            <MessageSquarePlus size={14} />
            {label("newChat")}
          </RippleButton>
          <input
            ref={filterRef}
            type="text"
            value={query}
            autoComplete="off"
            spellCheck={false}
            aria-label={label("filterSessions")}
            placeholder={label("filterSessions")}
            className="cs-model-filter min-w-0 flex-1 bg-transparent py-1 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)]"
            onChange={(event) => onFilterChange(event.target.value)}
          />
        </div>
        {locked ? <p className="px-2.5 pb-1 text-[11px] text-[var(--warn)]">{label("runningLock")}</p> : null}
        <ul ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
          {visible.length === 0 ? (
            <li className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">{label("noMatchingSessions")}</li>
          ) : (
            visible.map((session) => {
              const active = session.id === selectedId;
              const highlighted = session.id === highlightId;
              const editing = editingId === session.id;
              return (
                <li key={session.id} className="group/session" data-session-id={session.id}>
                  <div
                    className={`flex w-full items-start gap-1 px-1.5 py-1.5 ${
                      highlighted ? "bg-[var(--hover-strong)]" : ""
                    } ${active && !highlighted ? "bg-[color-mix(in_oklab,var(--brass)_16%,transparent)]" : ""}`}
                    onPointerEnter={() => setHighlightId(session.id)}
                  >
                    {editing ? (
                      <div className="flex min-w-0 flex-1 items-start gap-2 px-1">
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[var(--brass)]" : "bg-[var(--line)]"}`} />
                        <div className="min-w-0 flex-1">
                          <SessionTitleInput
                            initial={session.title || label("untitled")}
                            onCancel={() => setEditingId(undefined)}
                            onCommit={(title) => {
                              onRename(session.id, title);
                              setEditingId(undefined);
                            }}
                          />
                          <SessionMeta locale={locale} session={session} />
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={locked && !active}
                        onClick={() => pick(session.id)}
                        className="flex min-w-0 flex-1 items-start gap-2 px-1 text-left disabled:opacity-40"
                      >
                        <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[var(--brass)]" : "bg-[var(--line)]"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px]">{displayTitle(session, locale)}</span>
                          <SessionMeta locale={locale} session={session} />
                        </span>
                      </button>
                    )}
                    <div
                      className={`flex shrink-0 items-center gap-0.5 pt-0.5 ${
                        editing || highlighted ? "opacity-100" : "opacity-0 group-hover/session:opacity-100"
                      }`}
                    >
                      <IconButton
                        side="top"
                        label={label("rename")}
                        disabled={locked}
                        onClick={() => setEditingId(session.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] disabled:opacity-40"
                      >
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton
                        side="top"
                        label={label("deleteSession")}
                        disabled={locked}
                        onClick={() => onDelete(session.id)}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] disabled:opacity-40"
                      >
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      </div>
    </div>
  );
}

function SessionMeta({ locale, session }: { locale: Locale; session: Session }) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
      {session.parentId ? (
        <>
          <GitFork size={10} />
          {t(locale, "forked")}
        </>
      ) : (
        new Date(session.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en")
      )}
    </span>
  );
}

function SessionTitleInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onCommit(value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          onCommit(value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
      className="w-full rounded border border-[var(--line)] bg-[var(--ink)] px-1 py-0.5 text-[12.5px] text-[var(--text)] outline-none"
    />
  );
}
