import type { AttachmentItem } from "@shared";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { attachmentToMention, type MentionChip } from "../mentions";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import type { HistoryTab } from "../composer-history";
import { RippleButton } from "./RippleButton";
import { MentionChip as MentionChipView, TabFavicon } from "./MentionChip";

export type AtPane = "tabs" | "attachments";

export function AtMenu({
  open,
  locale,
  tabs,
  attachments,
  ignoreRef,
  onSelect,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  tabs: HistoryTab[];
  attachments: AttachmentItem[];
  ignoreRef?: RefObject<HTMLElement | null>;
  onSelect: (mention: MentionChip) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<AtPane>("tabs");
  const [highlight, setHighlight] = useState(0);

  const items = pane === "tabs" ? tabs : attachments;
  const count = items.length;

  useEffect(() => {
    if (!open) return;
    setPane("tabs");
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [pane]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-at-index="${highlight}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, pane]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setPane((current) => (current === "tabs" ? "attachments" : "tabs"));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (count === 0) return;
        setHighlight((index) => (index + 1) % count);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        if (count === 0) return;
        setHighlight((index) => (index - 1 + count) % count);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const chosen = items[highlight];
        if (!chosen) return;
        if (pane === "tabs") {
          const tab = chosen as HistoryTab;
          onSelect({
            kind: "tab",
            tabId: tab.tabId,
            title: tab.title,
            url: tab.url,
            favIconUrl: tab.favIconUrl,
          });
        } else {
          onSelect(attachmentToMention(chosen as AttachmentItem));
        }
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, count, highlight, items, pane, ignoreRef, onClose, onSelect]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      className="absolute bottom-full left-0 z-30 mb-1.5 flex w-64 flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl"
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex shrink-0 border-b border-[var(--line)]">
        {(["tabs", "attachments"] as const).map((id) => {
          const active = pane === id;
          return (
            <RippleButton
              key={id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setPane(id)}
              className={`flex-1 px-2.5 py-1.5 text-[12px] ${
                active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)]"
              }`}
            >
              {t(locale, id === "tabs" ? "atTabs" : "atAttachments")}
            </RippleButton>
          );
        })}
      </div>
      <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
        {count === 0 ? (
          <p className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">
            {t(locale, pane === "tabs" ? "atNoTabs" : "atNoAttachments")}
          </p>
        ) : pane === "tabs" ? (
          tabs.map((tab, index) => {
            const active = index === highlight;
            return (
              <RippleButton
                key={`${tab.url}-${tab.tabId}`}
                data-at-index={index}
                title={tab.url}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => setHighlight(index)}
                onClick={() =>
                  onSelect({
                    kind: "tab",
                    tabId: tab.tabId,
                    title: tab.title,
                    url: tab.url,
                    favIconUrl: tab.favIconUrl,
                  })
                }
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] ${
                  active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)]"
                }`}
              >
                <TabFavicon url={tab.favIconUrl} />
                <span className="min-w-0 truncate">{tab.title || tab.url}</span>
              </RippleButton>
            );
          })
        ) : (
          attachments.map((item, index) => {
            const active = index === highlight;
            return (
              <RippleButton
                key={item.path}
                data-at-index={index}
                title={item.path}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => setHighlight(index)}
                onClick={() => onSelect(attachmentToMention(item))}
                className={`flex w-full items-center px-2.5 py-1.5 text-left ${
                  active ? "bg-[var(--hover-strong)]" : ""
                }`}
              >
                <MentionChipView mention={attachmentToMention(item)} />
              </RippleButton>
            );
          })
        )}
      </div>
    </div>
  );
}
