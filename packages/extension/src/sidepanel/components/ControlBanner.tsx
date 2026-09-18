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
  onGrant,
}: {
  locale: Locale;
  tabs: ControlTab[];
  request?: BorrowRequest;
  onRelease: () => void;
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
  const primary = tabs[0];
  const acting = tabs.some((tab) => tab.acting);

  return (
    <section
      className="mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]"
      aria-live="polite"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`cs-control-dot shrink-0${acting ? " is-acting" : ""}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate text-[12.5px]">
          {acting ? t(locale, "controlWorking") : t(locale, "controlHeld")}{" "}
          <span className="text-[var(--text)]">“{primary.title}”</span>
          {tabs.length > 1 && (
            <span className="ml-1.5 text-[11px] text-[var(--muted)]">
              {t(locale, "controlMore").replace("{count}", String(tabs.length - 1))}
            </span>
          )}
        </div>
        <RippleButton
          onClick={onRelease}
          title={t(locale, "controlTakeBackHint")}
          className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]"
        >
          {t(locale, "controlTakeBack")}
        </RippleButton>
      </div>
    </section>
  );
}
