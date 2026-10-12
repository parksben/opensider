import type { ControlTab } from "@shared";
import { Hand, LocateFixed, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { ConfirmPopover } from "./ConfirmPopover";
import { IconButton } from "./IconButton";
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

/** 收回确认的目标：某一行，或表头的「全部收回」。 */
type ConfirmTarget = { scope: "tab"; tabId: number } | { scope: "all" };

/**
 * The control card stacked above the composer (same family as the todo list / queued
 * messages): who is driving right now. Shows the tabs the Agent holds — each row reveals
 * its own icon actions on hover (focus / take back) — or a borrow request waiting for the
 * user's answer. This is the one surface that keeps "the Agent is about to touch your
 * tabs" from being invisible.
 */
export function ControlBanner({
  locale,
  tabs,
  request,
  onRelease,
  onReleaseTab,
  onFocusTab,
  onGrant,
}: {
  locale: Locale;
  tabs: ControlTab[];
  request?: BorrowRequest;
  onRelease: () => void;
  onReleaseTab: (tabId: number) => void;
  onFocusTab: (tabId: number) => void;
  onGrant: (requestId: string, allow: boolean) => void;
}) {
  const [confirm, setConfirm] = useState<ConfirmTarget>();
  /** 点按钮时记下它的容器：ConfirmPopover 要靠它把「点锚点本身」排除在「点外面」之外。 */
  const ignoreRef = useRef<HTMLElement | null>(null);

  // 卡片内容变了（行被收回 / 换成借用卡 / 列表清空），确认弹层就跟着收掉。
  useEffect(() => {
    if (!confirm) return;
    if (request || tabs.length === 0) {
      setConfirm(undefined);
      return;
    }
    if (confirm.scope === "tab" && !tabs.some((tab) => tab.tabId === confirm.tabId)) setConfirm(undefined);
  }, [confirm, request, tabs]);

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
  // themselves — title + host, and, on hover / keyboard focus, the row's own actions:
  // focus (Lucide LocateFixed) and take-back (Lucide Undo2). `cs-list-cap` keeps a pile of
  // tabs scrolling inside the card instead of eating the message area. Both take-backs ask
  // once more in an in-place popover (the delete-session pattern): a stray click must not
  // drop the Agent's hold mid-task.
  const many = tabs.length > 1;
  const solo = tabs[0];

  const anchorRect = (): DOMRect | undefined => {
    const selector =
      confirm?.scope === "all" ? "[data-takeback-all]" : `[data-takeback-anchor="${confirm?.tabId}"]`;
    return document.querySelector<HTMLElement>(selector)?.getBoundingClientRect();
  };

  const toggleConfirm = (target: ConfirmTarget, anchor: HTMLElement | null) => {
    ignoreRef.current = anchor;
    setConfirm((current) => {
      if (!current) return target;
      if (current.scope === "all" && target.scope === "all") return undefined;
      if (current.scope === "tab" && target.scope === "tab" && current.tabId === target.tabId) {
        return undefined;
      }
      return target;
    });
  };

  const confirmDetailTarget =
    confirm !== undefined && confirm.scope === "tab"
      ? tabs.find((tab) => tab.tabId === confirm.tabId)
      : undefined;

  return (
    <>
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
            <span data-takeback-all className="shrink-0">
              <RippleButton
                onClick={(event) =>
                  toggleConfirm({ scope: "all" }, event.currentTarget.closest("[data-takeback-all]"))
                }
                aria-haspopup="dialog"
                aria-expanded={confirm?.scope === "all"}
                title={t(locale, "controlTakeBackHint")}
                className="shrink-0 rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-[12px] hover:border-[var(--brass)]"
              >
                {t(locale, "controlTakeBackAll")}
              </RippleButton>
            </span>
          ) : null}
        </div>
        <ul className={many ? "cs-list-cap border-t border-[var(--line)] py-0.5" : "px-3 pb-2"}>
          {(many ? tabs : [solo]).map((tab) => {
            const confirming = confirm !== undefined && confirm.scope === "tab" && confirm.tabId === tab.tabId;
            return (
              <li
                key={tab.tabId}
                data-control-row={tab.tabId}
                className={`group flex items-center gap-2 ${many ? "px-3 py-1" : ""}`}
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
                <span
                  className={`flex h-6 shrink-0 items-center gap-0.5 ${
                    confirming
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                  }`}
                >
                  <IconButton
                    side="top"
                    label={t(locale, "controlFocus")}
                    onClick={() => onFocusTab(tab.tabId)}
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)]"
                  >
                    <LocateFixed size={13} />
                  </IconButton>
                  <span data-takeback-anchor={tab.tabId}>
                    <IconButton
                      side="top"
                      label={t(locale, "controlTakeBack")}
                      tooltip={t(locale, "controlTakeBackHint")}
                      aria-haspopup="dialog"
                      aria-expanded={confirming}
                      onClick={(event) => {
                        event.currentTarget.blur();
                        toggleConfirm(
                          { scope: "tab", tabId: tab.tabId },
                          event.currentTarget.closest("[data-takeback-anchor]"),
                        );
                      }}
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[var(--muted)]"
                    >
                      <Undo2 size={13} />
                    </IconButton>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <ConfirmPopover
        open={confirm !== undefined}
        title={
          confirm?.scope === "all"
            ? t(locale, "controlTakeBackAllConfirmTitle")
            : t(locale, "controlTakeBackConfirmTitle")
        }
        description={
          confirm ? (
            <>
              {confirm.scope === "tab" ? (
                <p className="truncate" title={confirmDetailTarget?.title || confirmDetailTarget?.url}>
                  “{confirmDetailTarget?.title || hostOf(confirmDetailTarget?.url ?? "")}”
                </p>
              ) : null}
              <p className={confirm.scope === "tab" ? "mt-0.5" : undefined}>
                {confirm.scope === "all"
                  ? t(locale, "controlTakeBackAllConfirmDetail")
                  : t(locale, "controlTakeBackConfirmDetail")}
              </p>
            </>
          ) : null
        }
        confirmLabel={t(locale, "controlTakeBack")}
        cancelLabel={t(locale, "controlCancel")}
        ignoreRef={ignoreRef}
        getAnchorRect={anchorRect}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          const target = confirm;
          setConfirm(undefined);
          if (!target) return;
          if (target.scope === "all") onRelease();
          else onReleaseTab(target.tabId);
        }}
      />
    </>
  );
}
