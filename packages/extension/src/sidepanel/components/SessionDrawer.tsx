import { ChevronDown, ChevronRight, GitFork, MessageSquarePlus, Pencil, Pin, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import type { Locale, MessageKey } from "../i18n";
import { t } from "../i18n";
import { clampSessionDrawerWidth, SESSION_DRAWER_MAX, SESSION_DRAWER_MIN, type Session } from "../persist";
import { groupSessions, type SessionGroupId } from "../session-groups";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

const GROUP_KEYS = {
  pinned: "sessionGroupPinned",
  today: "sessionGroupToday",
  lastSevenDays: "sessionGroupLastSevenDays",
  older: "sessionGroupOlder",
} as const satisfies Record<SessionGroupId, MessageKey>;

function displayTitle(session: Session, locale: Locale): string {
  return session.title.trim() || t(locale, "untitled");
}

function matchesSession(session: Session, query: string, locale: Locale): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return displayTitle(session, locale).toLowerCase().includes(needle);
}

function formatSessionWhen(iso: string, locale: Locale): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diffSec = Math.round((ts - Date.now()) / 1000);
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale === "zh" ? "zh-CN" : "en", { numeric: "auto" });
  if (abs < 45) return rtf.format(diffSec, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 26 * 86400) return rtf.format(Math.round(diffSec / 86400), "day");
  if (abs < 8 * 7 * 86400) return rtf.format(Math.round(diffSec / (7 * 86400)), "week");
  return new Date(ts).toLocaleDateString(locale === "zh" ? "zh-CN" : "en", {
    month: "short",
    day: "numeric",
  });
}

export function SessionDrawer({
  locale,
  width,
  sessions,
  selectedId,
  runningIds,
  onWidth,
  onSelect,
  onRename,
  onDelete,
  onPin,
  onNewSession,
  onClose,
}: {
  locale: Locale;
  width: number;
  sessions: Session[];
  selectedId: string;
  runningIds: string[];
  onWidth: (width: number) => void;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}) {
  const label = (key: MessageKey) => t(locale, key);
  const [query, setQuery] = useState("");
  const [highlightId, setHighlightId] = useState(selectedId);
  const [editingId, setEditingId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<SessionGroupId>>(() => new Set());
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ startX: number; startWidth: number }>();

  const groups = useMemo(() => {
    return groupSessions(sessions.filter((session) => matchesSession(session, query, locale)));
  }, [locale, query, sessions]);

  const visible = useMemo(
    () => groups.flatMap((group) => (collapsed.has(group.id) ? [] : group.sessions)),
    [collapsed, groups],
  );

  const toggleGroup = (id: SessionGroupId) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveHighlight = (delta: number) => {
    if (visible.length === 0) return;
    const idx = visible.findIndex((session) => session.id === highlightId);
    const from = idx >= 0 ? idx : 0;
    setHighlightId(visible[(from + delta + visible.length) % visible.length].id);
  };

  const onFilterChange = (value: string) => {
    setQuery(value);
    const next = groupSessions(sessions.filter((session) => matchesSession(session, value, locale))).flatMap(
      (group) => group.sessions,
    );
    setHighlightId((id) => (next.some((session) => session.id === id) ? id : (next[0]?.id ?? "")));
  };

  useEffect(() => {
    const focus = () => filterRef.current?.focus();
    const frame = requestAnimationFrame(focus);
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    setHighlightId((id) => (visible.some((session) => session.id === id) ? id : (selectedId || visible[0]?.id || "")));
  }, [selectedId, visible]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      const inDrawer = target instanceof Node && !!rootRef.current?.contains(target);
      const inField =
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLInputElement && target !== filterRef.current);
      if (event.key === "Escape") {
        if (inField) return;
        event.preventDefault();
        if (query && inDrawer && target === filterRef.current) {
          onFilterChange("");
          return;
        }
        if (!inField) onClose();
        return;
      }
      if (!inDrawer || editingId) return;
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
      if (event.key === "Enter" && target === filterRef.current) {
        event.preventDefault();
        const chosen = visible.find((session) => session.id === highlightId) ?? visible[0];
        if (chosen) onSelect(chosen.id);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [editingId, highlightId, onClose, onSelect, query, visible]);

  useLayoutEffect(() => {
    if (!highlightId) return;
    const item = listRef.current?.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(highlightId)}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightId]);

  useEffect(() => {
    const onResize = () => onWidth(clampSessionDrawerWidth(width));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [onWidth, width]);

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      onWidth(clampSessionDrawerWidth(drag.startWidth + (drag.startX - event.clientX)));
    };
    const stop = () => {
      if (!dragRef.current) return;
      dragRef.current = undefined;
      setDragging(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onWidth]);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width };
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  return (
    <aside
      ref={rootRef}
      role="complementary"
      aria-label={label("sessions")}
      style={{ width }}
      className={`relative flex h-full min-h-0 shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)] ${
        dragging ? "" : "transition-[width] duration-150 ease-out"
      }`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={label("resizeSessionSidebar")}
        aria-valuenow={width}
        aria-valuemin={SESSION_DRAWER_MIN}
        aria-valuemax={SESSION_DRAWER_MAX}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            onWidth(clampSessionDrawerWidth(width + 16));
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            onWidth(clampSessionDrawerWidth(width - 16));
          }
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none before:absolute before:inset-y-0 before:left-[3px] before:w-px before:bg-transparent hover:before:bg-[var(--brass)]"
      />
      <div
        className={`pointer-events-none absolute inset-y-0 left-0 w-px ${
          dragging ? "bg-[var(--brass)]" : "bg-transparent"
        }`}
      />
      <div className="flex shrink-0 items-center px-2.5 pt-2">
        <input
          ref={filterRef}
          type="text"
          value={query}
          autoComplete="off"
          spellCheck={false}
          aria-label={label("filterSessions")}
          placeholder={label("filterSessions")}
          className="cs-model-filter w-full min-w-0 bg-transparent py-3 text-[12px] text-[var(--text)] placeholder:text-[var(--muted)]"
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>
      <div className="shrink-0 px-2.5 pb-1.5 pt-1">
        <RippleButton
          onClick={onNewSession}
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel-2)_80%,transparent)] px-2.5 py-1.5 text-[12.5px] text-[var(--text)]"
        >
          <MessageSquarePlus size={14} />
          {label("newChat")}
        </RippleButton>
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto pb-2">
        {groups.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">{label("noMatchingSessions")}</p>
        ) : (
          groups.map((group) => {
            const open = !collapsed.has(group.id);
            return (
            <section key={group.id} className="pt-1">
              <button
                type="button"
                aria-expanded={open}
                aria-label={`${label(GROUP_KEYS[group.id])}. ${open ? label("collapseSessionGroup") : label("expandSessionGroup")}`}
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center justify-between gap-2 px-2.5 pb-1.5 pt-2.5 text-left hover:bg-[var(--hover)]"
              >
                <span className="flex min-w-0 items-center gap-0.5">
                  <span
                    className={`text-[10px] font-medium tracking-[0.08em] text-[var(--muted)] ${
                      locale === "en" ? "uppercase" : ""
                    }`}
                  >
                    {label(GROUP_KEYS[group.id])}
                  </span>
                  {open ? (
                    <ChevronDown size={10} className="shrink-0 text-[var(--muted)]" />
                  ) : (
                    <ChevronRight size={10} className="shrink-0 text-[var(--muted)]" />
                  )}
                </span>
                <span className="text-[10px] tabular-nums text-[var(--muted)]">{group.sessions.length}</span>
              </button>
              {open ? (
              <ul>
                {group.sessions.map((session) => {
                  const active = session.id === selectedId;
                  const highlighted = session.id === highlightId;
                  const editing = editingId === session.id;
                  const running = runningIds.includes(session.id);
                  const pinned = Boolean(session.pinnedAt);
                  return (
                    <li key={session.id} className="group/session" data-session-id={session.id}>
                      <div
                        className={`flex w-full items-start gap-1.5 px-1.5 py-3.5 ${
                          highlighted ? "bg-[var(--hover-strong)]" : ""
                        } ${active && !highlighted ? "bg-[color-mix(in_oklab,var(--brass)_16%,transparent)]" : ""}`}
                        onPointerEnter={() => setHighlightId(session.id)}
                      >
                        <span className="flex h-6 w-3.5 shrink-0 items-center justify-center">
                          {running ? (
                            <span className="cs-braille-spin" aria-label={label("sessionRunning")} />
                          ) : (
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                active ? "bg-[var(--brass)]" : "bg-[var(--line)]"
                              }`}
                            />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          {editing ? (
                            <div className="flex h-6 min-w-0 items-center">
                              <SessionTitleInput
                                initial={session.title || label("untitled")}
                                onCancel={() => setEditingId(undefined)}
                                onCommit={(title) => {
                                  onRename(session.id, title);
                                  setEditingId(undefined);
                                }}
                              />
                            </div>
                          ) : (
                            <div className="flex min-w-0 items-start">
                              <button
                                type="button"
                                onClick={() => onSelect(session.id)}
                                title={displayTitle(session, locale)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block h-6 truncate text-[12.5px] leading-6">
                                  {displayTitle(session, locale)}
                                </span>
                                <SessionMeta locale={locale} running={running} session={session} />
                              </button>
                              <div className="hidden h-6 shrink-0 items-center group-hover/session:flex">
                                <IconButton
                                  side="top"
                                  label={pinned ? label("unpinSession") : label("pinSession")}
                                  onClick={() => onPin(session.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] disabled:opacity-40"
                                >
                                  <Pin size={12} className={pinned ? "fill-current" : undefined} />
                                </IconButton>
                                <IconButton
                                  side="top"
                                  label={label("rename")}
                                  onClick={() => setEditingId(session.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] disabled:opacity-40"
                                >
                                  <Pencil size={12} />
                                </IconButton>
                                <IconButton
                                  side="top"
                                  label={label("deleteSession")}
                                  onClick={() => onDelete(session.id)}
                                  className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)] disabled:opacity-40"
                                >
                                  <Trash2 size={12} />
                                </IconButton>
                              </div>
                            </div>
                          )}
                          {editing ? <SessionMeta locale={locale} running={running} session={session} /> : null}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              ) : null}
            </section>
            );
          })
        )}
      </div>
    </aside>
  );
}

function SessionMeta({
  locale,
  session,
  running,
}: {
  locale: Locale;
  session: Session;
  running?: boolean;
}) {
  return (
    <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
      {running ? (
        t(locale, "sessionRunning")
      ) : session.parentId ? (
        <>
          <GitFork size={10} />
          {t(locale, "forked")}
        </>
      ) : (
        formatSessionWhen(session.updatedAt, locale)
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
  const skipBlur = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <input
      ref={ref}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (skipBlur.current) return;
        onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.stopPropagation();
          skipBlur.current = true;
          onCommit(value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          skipBlur.current = true;
          onCancel();
        }
      }}
      className="w-full rounded border border-[var(--line)] bg-[var(--ink)] px-1 py-0.5 text-[12.5px] text-[var(--text)] outline-none"
    />
  );
}
