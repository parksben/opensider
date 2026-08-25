import { GitFork, Plus, RotateCcw } from "lucide-react";
import type { Locale, MessageKey } from "../i18n";
import { t } from "../i18n";
import type { Session } from "../persist";

export function SessionDrawer({
  locale,
  sessions,
  selectedId,
  locked,
  onSelect,
  onNew,
  onRestore,
}: {
  locale: Locale;
  sessions: Session[];
  selectedId: string;
  locked: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRestore: (checkpointId: string) => void;
}) {
  const selected = sessions.find((session) => session.id === selectedId);
  const label = (key: MessageKey) => t(locale, key);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--line)] px-2.5 py-2">
        <div className="text-[11px] tracking-wide text-[var(--muted)]">{label("sessions")}</div>
        <button
          type="button"
          disabled={locked}
          onClick={onNew}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] px-2 py-0.5 text-[11.5px] text-[var(--text)] disabled:opacity-40"
        >
          <Plus size={12} />
          {label("newChat")}
        </button>
      </div>
      {locked ? <p className="px-2.5 pt-2 text-[11px] text-[var(--warn)]">{label("runningLock")}</p> : null}
      <ul className="max-h-40 overflow-y-auto py-1">
        {sessions.map((session) => {
          const active = session.id === selectedId;
          return (
            <li key={session.id}>
              <button
                type="button"
                disabled={locked && !active}
                onClick={() => onSelect(session.id)}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left ${
                  active ? "bg-[color-mix(in_oklab,var(--brass)_16%,transparent)]" : "hover:bg-[var(--panel)]"
                } disabled:opacity-40`}
              >
                <span
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-[var(--brass)]" : "bg-[var(--line)]"}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px]">{session.title || label("untitled")}</span>
                  <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--muted)]">
                    {session.parentId ? (
                      <>
                        <GitFork size={10} />
                        {label("forked")}
                      </>
                    ) : (
                      new Date(session.updatedAt).toLocaleString(locale === "zh" ? "zh-CN" : "en")
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-[var(--line)] px-2.5 py-2">
        <div className="text-[11px] tracking-wide text-[var(--muted)]">{label("checkpoints")}</div>
        {selected && selected.checkpoints.length > 0 ? (
          <ul className="mt-1 space-y-1">
            {selected.checkpoints.map((checkpoint) => (
              <li key={checkpoint.id} className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px]">{checkpoint.title}</span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onRestore(checkpoint.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-[var(--line)] px-1.5 py-0.5 text-[11px] disabled:opacity-40"
                >
                  <RotateCcw size={10} />
                  {label("restore")}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-[11.5px] text-[var(--muted)]">{label("emptyCheckpoints")}</p>
        )}
      </div>
    </div>
  );
}
