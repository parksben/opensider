import { Globe, MessageSquarePlus, MousePointerClick, PanelLeftClose, PlugZap, RotateCw, Unplug } from "lucide-react";
import type { BrowserCommand, BrowserResult, CurrentPage } from "@shared";
import type { TodoItem } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";

export function Header({
  locale,
  status,
  error,
  page,
  todos,
  activity,
  sessionTitle,
  sessionsOpen,
  onRetry,
  onLocale,
  onToggleSessions,
}: {
  locale: Locale;
  status: "starting" | "ready" | "error";
  error?: string;
  page?: CurrentPage;
  todos: TodoItem[];
  activity?: { command: BrowserCommand; result?: BrowserResult };
  sessionTitle: string;
  sessionsOpen: boolean;
  onRetry?: () => void;
  onLocale: (locale: Locale) => void;
  onToggleSessions: () => void;
}) {
  const host = safeHost(page?.url);
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const ToggleIcon = sessionsOpen ? PanelLeftClose : MessageSquarePlus;
  return (
    <header className="border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-1.5">
          <IconButton
            ripple={false}
            label={sessionsOpen ? label("collapseSessions") : label("expandSessions")}
            onClick={onToggleSessions}
            aria-expanded={sessionsOpen}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            <ToggleIcon size={14} />
          </IconButton>
          <IconButton
            ripple={false}
            label={label("switchLanguage")}
            onClick={() => onLocale(locale === "en" ? "zh" : "en")}
            className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] px-1 text-[11px] font-medium text-[var(--text)]"
          >
            {locale === "en" ? "中" : "EN"}
          </IconButton>
        </div>
        <div className="max-w-[46vw] truncate text-center text-[14px] font-medium tracking-tight">
          {sessionTitle || label("untitled")}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <div
            className="flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-1 text-[11px]"
            title={error}
          >
            {status === "ready" ? (
              <PlugZap size={13} className="text-[var(--ok)]" />
            ) : (
              <Unplug size={13} className={status === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"} />
            )}
            <span className="text-[var(--muted)]">
              {status === "ready" ? label("connected") : status === "starting" ? label("starting") : label("offline")}
            </span>
          </div>
          {status === "error" && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--text)]"
            >
              <RotateCw size={12} />
              {label("retry")}
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--panel-2)] px-2 py-1.5">
        <Globe size={13} className="shrink-0 text-[var(--brass)]" />
        <div className="min-w-0">
          <div className="truncate text-[12px]">{page?.title || label("noPage")}</div>
          <div className="truncate text-[11px] text-[var(--muted)]">{host || label("switchTab")}</div>
        </div>
      </div>

      {activity ? (
        <div className="mt-2 flex items-center gap-2 text-[11.5px] text-[var(--muted)]">
          <MousePointerClick size={13} className="shrink-0 text-[var(--brass)]" />
          <span className="truncate">
            {activity.command.method}
            {targetLabel(activity.command)}
            {activity.result
              ? activity.result.ok
                ? ` · ${label("activityDone")}`
                : ` · ${activity.result.error ?? label("activityFailed")}`
              : ` · ${label("activityRunning")}`}
          </span>
        </div>
      ) : null}

      {error && status !== "ready" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}

      {todos.length > 0 ? (
        <ol className="mt-2 space-y-1">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-[11.5px] text-[var(--muted)]">
              <span className="mt-[2px] inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brass)]" />
              <span className={todo.status === "completed" ? "line-through opacity-60" : ""}>{todo.content}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </header>
  );
}

function targetLabel(command: BrowserCommand): string {
  const args = command.args;
  const bit = args?.selector || args?.text || args?.url || args?.key;
  return bit ? ` ${bit}` : "";
}

function safeHost(url?: string): string {
  if (!url) return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
