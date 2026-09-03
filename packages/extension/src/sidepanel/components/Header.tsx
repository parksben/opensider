import type { AgentInfo, AgentProgress, HostStatusState } from "@shared";
import { Check, Monitor, Moon, PanelRight, PanelRightClose, Pencil, RotateCw, Sun, Unplug } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { nextTheme, type ThemePreference } from "../theme";
import { AgentSelect } from "./AgentSelect";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

const PHASE_KEYS = {
  resolve: "progressResolve",
  spawn: "progressSpawn",
  handshake: "progressHandshake",
  auth: "progressAuth",
  session: "progressSession",
  models: "progressModels",
} as const;

export function Header({
  locale,
  status,
  error,
  progress,
  agents,
  selectedProviderId,
  showAgentSelect,
  compact,
  sessionTitle,
  sessionsOpen,
  theme,
  onRetry,
  onCancelConnect,
  onLocale,
  onTheme,
  onToggleSessions,
  onRename,
  onSelectAgent,
}: {
  locale: Locale;
  status: HostStatusState;
  error?: string;
  progress?: AgentProgress;
  agents: AgentInfo[];
  selectedProviderId: string;
  showAgentSelect: boolean;
  compact?: boolean;
  sessionTitle: string;
  sessionsOpen: boolean;
  theme: ThemePreference;
  onRetry?: () => void;
  onCancelConnect?: () => void;
  onLocale: (locale: Locale) => void;
  onTheme: (theme: ThemePreference) => void;
  onToggleSessions: () => void;
  onRename: (title: string) => void;
  onSelectAgent: (id: string) => void;
}) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const title = sessionTitle.trim() || label("untitled");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleClusterRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(sessionTitle);
  const renamingRef = useRef(false);
  const draftRef = useRef(draft);
  renamingRef.current = renaming;
  draftRef.current = draft;
  const showSwitcher =
    !compact && showAgentSelect && agents.length > 0 && status !== "connecting" && status !== "starting";
  const showStatus = !showSwitcher && (!compact || status !== "ready");

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
    <header className="group/header relative z-40 border-b border-[var(--line)] bg-[color-mix(in_oklab,var(--panel)_88%,transparent)] px-3 py-2.5 backdrop-blur">
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {showSwitcher ? (
            <AgentSelect
              locale={locale}
              agents={agents}
              selectedId={selectedProviderId}
              onSelect={onSelectAgent}
            />
          ) : showStatus ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px]" title={error}>
              <Unplug
                size={13}
                className={status === "error" || status === "missing" ? "text-[var(--bad)]" : "text-[var(--warn)]"}
              />
              <span className="text-[var(--muted)]">
                {status === "starting"
                  ? label("starting")
                  : status === "connecting"
                    ? progress
                      ? `${progress.index}/${progress.total}`
                      : label("connecting")
                    : label("offline")}
              </span>
            </div>
          ) : null}
          {(status === "error" || status === "missing") && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--line)] px-2 py-1 text-[11px] text-[var(--text)]"
            >
              <RotateCw size={12} />
              {label("retry")}
            </button>
          ) : null}
          <div
            ref={titleClusterRef}
            className="flex min-w-0 flex-1 items-center justify-start gap-0.5"
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
                className="min-w-0 w-full flex-1 rounded border border-[var(--line)] bg-[var(--ink)] px-1.5 py-0.5 text-left text-[14px] font-medium tracking-tight text-[var(--text)] outline-none"
              />
            ) : (
              <div
                title={title}
                className="min-w-0 truncate whitespace-nowrap text-left text-[14px] font-medium tracking-tight"
              >
                {title}
              </div>
            )}
            <IconButton
              ripple={false}
              label={renaming ? label("saveTitle") : label("rename")}
              onClick={() => (renaming ? commitRename() : setRenaming(true))}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--muted)] hover:text-[var(--text)] ${
                renaming
                  ? "opacity-100"
                  : "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100"
              }`}
            >
              {renaming ? <Check size={14} /> : <Pencil size={14} />}
            </IconButton>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-1.5">
          {!compact ? (
            <>
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
            </>
          ) : null}
          <IconButton
            ripple={false}
            label={sessionsOpen ? label("collapseSessions") : label("expandSessions")}
            onClick={onToggleSessions}
            aria-expanded={sessionsOpen}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--line)] text-[var(--text)]"
          >
            {sessionsOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
          </IconButton>
        </div>
      </div>

      {status === "connecting" ? (
        <div className="mt-2">
          {progress ? (
            <div className="h-0.5 overflow-hidden rounded-full bg-[var(--panel-2)]">
              <div
                className="h-full bg-[var(--brass)] transition-[width] duration-300"
                style={{ width: `${Math.round((progress.index / progress.total) * 100)}%` }}
              />
            </div>
          ) : null}
          <div className="mt-1 flex items-center justify-between gap-2">
            <p className="min-w-0 truncate text-[11px] text-[var(--muted)]">
              {progress
                ? `${progress.index}/${progress.total} · ${
                    PHASE_KEYS[progress.phase as keyof typeof PHASE_KEYS]
                      ? label(PHASE_KEYS[progress.phase as keyof typeof PHASE_KEYS])
                      : progress.label
                  }`
                : label("connecting")}
            </p>
            {onCancelConnect ? (
              <RippleButton
                onClick={onCancelConnect}
                className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-[var(--brass)] hover:bg-[var(--brass)]/20"
              >
                {label("cancelConnect")}
              </RippleButton>
            ) : null}
          </div>
        </div>
      ) : null}
      {error && status === "error" ? (
        <p className="mt-2 text-[11.5px] leading-relaxed text-[var(--bad)]">{error}</p>
      ) : null}
    </header>
  );
}
