import type { ControlTab } from "@shared";
import { Hand } from "lucide-react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { RippleButton } from "./RippleButton";

export type BorrowRequest = {
  requestId: string;
  tabId: number;
  title: string;
  url: string;
  sessionId?: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * The control card stacked above the composer (same family as the todo list / queued
 * messages): who is driving right now. Shows the tabs the Agent holds (with a take-back
 * button), or a borrow request waiting for the user's answer. This is the one surface that
 * keeps "the Agent is about to touch your tabs" from being invisible.
 */
export function ControlBanner({
  locale,
  tabs,
  request,
  onRelease,
  onReleaseTab,
  onGrant,
}: {
  locale: Locale;
  tabs: ControlTab[];
  request?: BorrowRequest;
  onRelease: () => void;
  onReleaseTab: (tabId: number) => void;
  onGrant: (requestId: string, allow: boolean) => void;
}) {
  if (request) {
    return (
      <section
        className="mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]"
        aria-live="polite"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Hand size={14} className="shrink-0 text-[var(--brass)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-medium tracking-tight">
              {t(locale, "controlRequest")}{" "}
              <span className="text-[var(--text)]">“{request.title || hostOf(request.url)}”</span>
            </div>
            <div className="truncate text-[11px] text-[var(--muted)]">{hostOf(request.url)}</div>
          </div>
          <RippleButton
            variant="primary"
            onClick={() => onGrant(request.requestId, true)}
            className="shrink-0 rounded-md bg-[var(--brass)] px-2.5 py-1 text-[12px] text-[var(--on-brass)]"
          >
            {t(locale, "controlAllow")}
          </RippleButton>
          <RippleButton
            onClick={() => onGrant(request.requestId, false)}
            className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]"
          >
            {t(locale, "controlDeny")}
          </RippleButton>
        </div>
      </section>
    );
  }

  if (tabs.length === 0) return null;
  const acting = tabs.some((tab) => tab.acting);

  // One row per page, under a title bar: a state dot + 「已接管 / 正在操作」 + the page count
  // (or the single page's title) with a take-back-all on the right, then the pages
  // themselves — title + host + its own 「收回」. The list is what makes a hold reviewable
  // per page (which pages, and how to give just one back); `cs-list-cap` keeps a pile of
  // tabs scrolling inside the card instead of eating the message area.
  const many = tabs.length > 1;
  const solo = tabs[0];

  return (
    <section
      className="mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 px-3 py-2" data-control-head="">
        <span className={`cs-control-dot shrink-0${acting ? " is-acting" : ""}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate text-[12.5px]">
          {acting ? t(locale, "controlWorking") : t(locale, "controlHeld")}
          <span className="ml-1.5">
            {many ? (
              <span className="text-[11px] text-[var(--muted)]">
                · {t(locale, "controlPages").replace("{count}", String(tabs.length))}
              </span>
            ) : (
              // A tab that is still loading has no title yet: fall back to its host.
              <span className="text-[var(--text)]">“{solo.title || hostOf(solo.url)}”</span>
            )}
          </span>
        </div>
        {many ? (
          <RippleButton
            onClick={onRelease}
            title={t(locale, "controlTakeBackHint")}
            className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]"
          >
            {t(locale, "controlTakeBackAll")}
          </RippleButton>
        ) : null}
      </div>
      <ul className={many ? "cs-list-cap border-t border-[var(--line)] py-0.5" : "px-3 pb-2"}>
        {(many ? tabs : [solo]).map((tab) => (
          <li
            key={tab.tabId}
            data-control-row={tab.tabId}
            className={`flex items-center gap-2 ${many ? "px-3 py-1" : ""}`}
          >
            {many ? (
              <span
                className={`cs-control-dot shrink-0${tab.acting ? " is-acting" : ""}`}
                aria-hidden="true"
              />
            ) : null}
            <span
              className={`min-w-0 flex-1 truncate ${many ? "text-[12px] text-[var(--text)]" : "text-[11px] text-[var(--muted)]"}`}
              title={tab.title || hostOf(tab.url)}
            >
              {many ? tab.title || hostOf(tab.url) : hostOf(tab.url)}
            </span>
            {many ? (
              <span className="max-w-[38%] shrink-0 truncate text-[11px] text-[var(--muted)]">
                {hostOf(tab.url)}
              </span>
            ) : null}
            <RippleButton
              onClick={() => onReleaseTab(tab.tabId)}
              title={t(locale, "controlTakeBackHint")}
              className={`shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] hover:border-[var(--brass)] ${
                many ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-[12px]"
              }`}
            >
              {t(locale, "controlTakeBack")}
            </RippleButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
