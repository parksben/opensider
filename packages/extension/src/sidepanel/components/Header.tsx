import { Check, Globe, History, MessageSquarePlus, Monitor, Moon, Pencil, RotateCw, Sun, Unplug } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CurrentPage } from "@shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { nextTheme, type ThemePreference } from "../theme";
import { IconButton } from "./IconButton";

export function Header({
  locale,
  status,
  error,
  page,
  sessionTitle,
  sessionsOpen,
  theme,
  onRetry,
  onLocale,
  onTheme,
  onToggleSessions,
  onNewSession,
  onRename,
}: {
  locale: Locale;
  status: "starting" | "ready" | "error";
  error?: string;
  page?: CurrentPage;
  sessionTitle: string;
  sessionsOpen: boolean;
  theme: ThemePreference;
  onRetry?: () => void;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: ThemePreference) => void;
  onToggleSessions: () => void;
  onNewSession: () => void;
  onRename: (title: string) => void;
}) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const title = sessionTitle.trim() || label("untitled");
  const rowRef = useRef<HTMLDivElement>(null);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleClusterRef = useRef<HTMLDivElement>(null);
  const [titleMaxWidth, setTitleMaxWidth] = useState<number>();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(sessionTitle);
  const renamingRef = useRef(false);
  const draftRef = useRef(draft);
  renamingRef.current = renaming;
  draftRef.current = draft;

  useEffect(() => {
    setRenaming(false);
    setDraft(sessionTitle);
  }, [sessionTitle]);

  useLayoutEffect(() => {
    if (!renaming) return;
    const node = titleInputRef.current;
    node?.focus();
    node?.select();
  }, [renaming]);

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
  }, [title, locale, status, page?.favIconUrl, renaming]);

  const commitRename = () => {
    if (!renamingRef.current) return;
    renamingRef.current = false;
    onRename(draftRef.current);
    setRenaming(false);
  };

  const cancelRename = () => {
    if (!renamingRef.current) return;
    renamingRef.current = false;
    setDraft(sessionTitle);
    setRenaming(false);
  };

  return (
    <header className="border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      <div ref={rowRef} className="relative flex items-center justify-between gap-2">
        <div ref={leftRef} className="flex items-center gap-1.5">
          {status !== "ready" ? (
            <div className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px]" title={error}>
              <Unplug size={13} className={status === "error" ? "text-[var(--bad)]" : "text-[var(--warn)]"} />
              <span className="text-[var(--muted)]">
                {status === "starting" ? label("starting") : label("offline")}
              </span>
            </div>
          ) : null}
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
          <PageFavicon locale={locale} page={page} />
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            ref={titleClusterRef}
            className={`pointer-events-auto flex min-w-0 items-center gap-0.5 ${renaming ? "w-full" : ""}`}
            style={{ maxWidth: titleMaxWidth, width: renaming ? titleMaxWidth : undefined }}
          >
            {renaming ? (
              <input
                ref={titleInputRef}
                size={1}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={(event) => {
                  const next = event.relatedTarget;
                  if (next instanceof Node && titleClusterRef.current?.contains(next)) return;
                  commitRename();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRename();
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRename();
                  }
                }}
                aria-label={label("rename")}
                placeholder={label("untitled")}
                className="min-w-0 w-full flex-1 rounded border border-[var(--line)] bg-[var(--ink)] px-1.5 py-0.5 text-[14px] font-medium tracking-tight text-[var(--text)] outline-none"
              />
            ) : (
              <div
                title={title}
                className="min-w-0 truncate whitespace-nowrap text-[14px] font-medium tracking-tight"
              >
                {title}
              </div>
            )}
            <IconButton
              ripple={false}
              label={renaming ? label("saveTitle") : label("rename")}
              onClick={() => (renaming ? commitRename() : setRenaming(true))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)]"
            >
              {renaming ? <Check size={14} /> : <Pencil size={14} />}
            </IconButton>
          </div>
        </div>
        <div ref={rightRef} className="flex items-center justify-end gap-1.5">
          <IconButton
            ripple={false}
            label={label("newChat")}
            onClick={onNewSession}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            <MessageSquarePlus size={14} />
          </IconButton>
          <IconButton
            ripple={false}
            label={sessionsOpen ? label("collapseSessions") : label("expandSessions")}
            onClick={onToggleSessions}
            aria-expanded={sessionsOpen}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            <History size={14} />
          </IconButton>
          <IconButton
            ripple={false}
            label={theme === "light" ? label("themeLight") : theme === "dark" ? label("themeDark") : label("themeSystem")}
            onClick={() => onTheme(nextTheme(theme))}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            {theme === "light" ? <Sun size={14} /> : theme === "dark" ? <Moon size={14} /> : <Monitor size={14} />}
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
      </div>

      {error && status !== "ready" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}
    </header>
  );
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
