import { GitFork, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale, MessageKey } from "../i18n";
import { t } from "../i18n";
import type { Session } from "../persist";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

export function SessionDrawer({
  locale,
  sessions,
  selectedId,
  locked,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  locale: Locale;
  sessions: Session[];
  selectedId: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const label = (key: MessageKey) => t(locale, key);
  const [editingId, setEditingId] = useState<string>();

  return (
    <aside className="flex h-full w-[13.5rem] shrink-0 flex-col border-r border-[var(--line)] bg-[var(--panel-2)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-2.5 py-2">
        <div className="text-[11px] tracking-wide text-[var(--muted)]">{label("sessions")}</div>
        <RippleButton
          disabled={locked}
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 text-[11.5px] text-[var(--text)] disabled:opacity-40"
        >
          <Plus size={12} />
          {label("newChat")}
        </RippleButton>
      </div>
      {locked ? <p className="px-2.5 pt-2 text-[11px] text-[var(--warn)]">{label("runningLock")}</p> : null}
      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {sessions.map((session) => {
          const active = session.id === selectedId;
          const editing = editingId === session.id;
          return (
            <li key={session.id} className="group/session">
              <div
                className={`flex w-full items-start gap-1 px-1.5 py-1.5 ${
                  active ? "bg-[color-mix(in_oklab,var(--brass)_16%,transparent)]" : "hover:bg-[var(--panel)]"
                }`}
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
                    onClick={() => onSelect(session.id)}
                    className="flex min-w-0 flex-1 items-start gap-2 px-1 text-left disabled:opacity-40"
                  >
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[var(--brass)]" : "bg-[var(--line)]"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px]">{session.title || label("untitled")}</span>
                      <SessionMeta locale={locale} session={session} />
                    </span>
                  </button>
                )}
                <div
                  className={`flex shrink-0 items-center gap-0.5 pt-0.5 ${
                    editing || active ? "opacity-100" : "opacity-0 group-hover/session:opacity-100"
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
        })}
      </ul>
    </aside>
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
          onCommit(value);
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      className="w-full rounded border border-[var(--line)] bg-[var(--ink)] px-1 py-0.5 text-[12.5px] text-[var(--text)] outline-none"
    />
  );
}
