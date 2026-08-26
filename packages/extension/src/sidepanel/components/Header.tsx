import { Globe, MessageCirclePlus, Monitor, Moon, MousePointerClick, PanelLeftClose, PlugZap, RotateCw, Sun, Unplug } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BrowserCommand, BrowserResult, CurrentPage } from "@shared";
import type { TodoItem } from "../chat-types";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { nextTheme, type ThemePreference } from "../theme";
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
  theme,
  onRetry,
  onLocale,
  onTheme,
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
  theme: ThemePreference;
  onRetry?: () => void;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: ThemePreference) => void;
  onToggleSessions: () => void;
}) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const title = sessionTitle || label("untitled");
  const ToggleIcon = sessionsOpen ? PanelLeftClose : MessageCirclePlus;
  const rowRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [titleMaxWidth, setTitleMaxWidth] = useState<number>();

  useLayoutEffect(() => {
    const row = rowRef.current;
    const left = leftRef.current;
    const right = rightRef.current;
    if (!row || !left || !right) return;
    const update = () => {
      const rowBox = row.getBoundingClientRect();
      const leftBox = left.getBoundingClientRect();
      const rightBox = right.getBoundingClientRect();
      const center = rowBox.left + rowBox.width / 2;
      const half = Math.min(center - leftBox.right - 32, rightBox.left - center - 32);
      setTitleMaxWidth(Math.max(0, half * 2));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(row);
    observer.observe(left);
    observer.observe(right);
    return () => observer.disconnect();
  }, [title, locale, status, page?.favIconUrl]);

  return (
    <header className="border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      <div ref={rowRef} className="relative flex items-center justify-between gap-2">
        <div ref={leftRef} className="flex items-center gap-1.5">
          <IconButton
            ripple={false}
            label={label("switchLanguage")}
            onClick={() => onLocale(locale === "en" ? "zh" : "en")}
            className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] px-1 text-[11px] font-medium text-[var(--text)]"
          >
            {locale === "en" ? "中" : "EN"}
          </IconButton>
          <IconButton
            ripple={false}
            label={theme === "light" ? label("themeLight") : theme === "dark" ? label("themeDark") : label("themeSystem")}
            onClick={() => onTheme(nextTheme(theme))}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            {theme === "light" ? <Sun size={14} /> : theme === "dark" ? <Moon size={14} /> : <Monitor size={14} />}
          </IconButton>
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="pointer-events-auto flex min-w-0 items-center gap-1.5"
            style={{ maxWidth: titleMaxWidth }}
          >
            <div
              title={title}
              className="min-w-0 truncate whitespace-nowrap text-[14px] font-medium tracking-tight"
            >
              {title}
            </div>
            <IconButton
              ripple={false}
              label={sessionsOpen ? label("collapseSessions") : label("expandSessions")}
              onClick={onToggleSessions}
              aria-expanded={sessionsOpen}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
            >
              <ToggleIcon size={14} />
            </IconButton>
          </div>
        </div>
        <div ref={rightRef} className="flex items-center justify-end gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px]" title={error}>
            {status === "ready" ? (
              <PlugZap size={13} className="text-[var(--ok)]" />
            ) : (
              <Unplug size={13} className={status === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"} />
            )}
            <span className="text-[var(--muted)]">
              {status === "ready" ? label("connected") : status === "starting" ? label("starting") : label("offline")}
            </span>
          </div>
          <PageFavicon locale={locale} page={page} />
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

function PageFavicon({ locale, page }: { locale: Locale; page?: CurrentPage }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => {
    setBroken(false);
  }, [page?.favIconUrl]);
  const title = page?.title?.trim() || t(locale, "noPage");
  const url = page?.url?.trim() || t(locale, "switchTab");
  const src = page?.favIconUrl;
  return (
    <IconButton
      ripple={false}
      side="bottom"
      label={`${title}\n${url}`}
      tooltip={
        <span className="flex flex-col gap-0.5">
          <span>{title}</span>
          <span className="break-all text-[var(--muted)]">{url}</span>
        </span>
      }
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text)]"
    >
      {src && !broken ? (
        <img src={src} alt="" className="h-3.5 w-3.5" onError={() => setBroken(true)} />
      ) : (
        <Globe size={14} className="text-[var(--muted)]" />
      )}
    </IconButton>
  );
}
