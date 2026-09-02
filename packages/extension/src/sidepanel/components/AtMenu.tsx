import type { AttachmentItem } from "@shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  atMenuLock,
  armEnterSuppress,
  blockEnterEvent,
  closeAtMenuLock,
  isEnterKey,
  openAtMenuLock,
  releaseEnterSuppress,
} from "../at-menu-lock";
import { filterAtAttachments, filterAtTabs, type AtAttachmentMatch, type AtTabMatch } from "../at-menu-search";
import { attachmentToMention, type MentionChip } from "../mentions";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import type { HistoryTab } from "../composer-history";
import { HighlightText } from "./HighlightText";
import { RippleButton } from "./RippleButton";
import { MentionIcon, TabFavicon } from "./MentionChip";

export type AtPane = "tabs" | "attachments";

const SAFE = 16;
const GAP = 6;
const MENU_WIDTH = 256;

type AtMenuItem = AtTabMatch | AtAttachmentMatch;

function placeMenu(
  anchor: DOMRect,
  menuHeight: number,
  vw: number,
  vh: number,
): { top: number; left: number; maxHeight: number } {
  const maxWidth = Math.max(80, vw - SAFE * 2);
  const width = Math.min(MENU_WIDTH, maxWidth);
  const spaceAbove = Math.max(0, anchor.top - SAFE - GAP);
  const maxHeight = spaceAbove > 0 ? Math.min(spaceAbove, vh - SAFE * 2) : Math.max(72, vh - SAFE * 2);
  const height = Math.min(menuHeight, maxHeight);
  let top = spaceAbove > 0 ? anchor.top - GAP - height : SAFE;
  if (top < SAFE) top = SAFE;
  if (top + height > vh - SAFE) top = Math.max(SAFE, vh - SAFE - height);
  let left = anchor.left;
  if (left + width > vw - SAFE) left = vw - SAFE - width;
  if (left < SAFE) left = SAFE;
  return { top, left, maxHeight };
}

export function AtMenu({
  open,
  locale,
  query,
  tabs,
  attachments,
  ignoreRef,
  getAnchorRect,
  onSelect,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  query: string;
  tabs: HistoryTab[];
  attachments: AttachmentItem[];
  ignoreRef?: RefObject<HTMLElement | null>;
  getAnchorRect?: () => DOMRect | undefined;
  onSelect: (mention: MentionChip) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [pane, setPane] = useState<AtPane>("tabs");
  const [highlight, setHighlight] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 224, ready: false });

  const filteredTabs = useMemo(() => filterAtTabs(tabs, query), [query, tabs]);
  const filteredAttachments = useMemo(() => filterAtAttachments(attachments, query), [attachments, query]);
  const items: AtMenuItem[] = pane === "tabs" ? filteredTabs : filteredAttachments;
  const count = items.length;
  const searching = query.trim().length > 0;
  const getAnchorRectRef = useRef(getAnchorRect);
  const paneRef = useRef(pane);
  const highlightRef = useRef(highlight);
  const itemsRef = useRef(items);
  const onSelectRef = useRef(onSelect);
  const onCloseRef = useRef(onClose);
  getAnchorRectRef.current = getAnchorRect;
  paneRef.current = pane;
  highlightRef.current = highlight;
  itemsRef.current = items;
  onSelectRef.current = onSelect;
  onCloseRef.current = onClose;

  const pendingCloseRef = useRef(false);

  const pick = (mention: MentionChip, fromKeyboard = false) => {
    if (fromKeyboard) {
      pendingCloseRef.current = true;
      armEnterSuppress();
    } else {
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    }
    onSelectRef.current(mention);
  };

  const confirmHighlight = (event?: Event) => {
    if (pendingCloseRef.current) return;
    if (event && atMenuLock.lastEnter === event) return;
    if (event) atMenuLock.lastEnter = event;
    const chosen = itemsRef.current[highlightRef.current];
    if (!chosen) return;
    if (paneRef.current === "tabs") {
      const tab = (chosen as AtTabMatch).tab;
      pick(
        {
          kind: "tab",
          tabId: tab.tabId,
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
        },
        true,
      );
    } else {
      pick(attachmentToMention((chosen as AtAttachmentMatch).item), true);
    }
  };

  if (open) atMenuLock.confirm = confirmHighlight;

  useEffect(() => {
    if (!open) return;
    setPane("tabs");
    setHighlight(0);
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [pane, query]);

  useLayoutEffect(() => {
    if (!open) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-at-index="${highlight}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [open, highlight, pane, query]);

  useLayoutEffect(() => {
    if (!open) {
      setPos((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const update = () => {
      const menu = rootRef.current;
      const anchor = getAnchorRectRef.current?.();
      if (!menu) return;
      const fallback = new DOMRect(SAFE, window.innerHeight - 120, 0, 0);
      const next = placeMenu(
        anchor && (anchor.top || anchor.left) ? anchor : fallback,
        menu.scrollHeight,
        window.innerWidth,
        window.innerHeight,
      );
      setPos({ ...next, ready: true });
    };
    update();
    const frame = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, pane, query, tabs, attachments]);

  useLayoutEffect(() => {
    if (!open) return;
    openAtMenuLock();
    pendingCloseRef.current = false;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        pendingCloseRef.current = false;
        releaseEnterSuppress();
        closeAtMenuLock();
        onCloseRef.current();
        return;
      }
      if (event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        setPane((current) => (current === "tabs" ? "attachments" : "tabs"));
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        const total = itemsRef.current.length;
        if (total === 0) return;
        setHighlight((index) => (index + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const total = itemsRef.current.length;
        if (total === 0) return;
        setHighlight((index) => (index - 1 + total) % total);
        return;
      }
      if (isEnterKey(event)) {
        blockEnterEvent(event);
        confirmHighlight(event);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!isEnterKey(event) || !pendingCloseRef.current) return;
      pendingCloseRef.current = false;
      releaseEnterSuppress();
      closeAtMenuLock();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keyup", onKeyUp, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keyup", onKeyUp, true);
      if (!pendingCloseRef.current) {
        atMenuLock.confirm = null;
        if (!atMenuLock.suppressSubmit) closeAtMenuLock();
      }
    };
  }, [open]);

  if (!open) return null;

  const emptyKey =
    count === 0
      ? searching
        ? "atNoMatches"
        : pane === "tabs"
          ? "atNoTabs"
          : "atNoAttachments"
      : null;

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-[80] flex w-64 flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl"
      style={{
        top: pos.top,
        left: pos.left,
        maxHeight: pos.maxHeight,
        opacity: pos.ready ? 1 : 0,
      }}
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
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {emptyKey ? (
          <p className="px-2.5 py-1.5 text-[12px] text-[var(--muted)]">{t(locale, emptyKey)}</p>
        ) : pane === "tabs" ? (
          filteredTabs.map((match, index) => {
            const active = index === highlight;
            const { tab } = match;
            return (
              <RippleButton
                key={`${tab.url}-${tab.tabId}`}
                data-at-index={index}
                title={tab.url}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => setHighlight(index)}
                onClick={() =>
                  pick({
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
                <TabFavicon pageUrl={tab.url} favIconUrl={tab.favIconUrl} />
                <HighlightText text={match.label} ranges={match.labelRanges} className="min-w-0 truncate" />
              </RippleButton>
            );
          })
        ) : (
          filteredAttachments.map((match, index) => {
            const active = index === highlight;
            const mention = attachmentToMention(match.item);
            return (
              <RippleButton
                key={match.item.path}
                data-at-index={index}
                title={match.item.path}
                onMouseDown={(event) => event.preventDefault()}
                onPointerEnter={() => setHighlight(index)}
                onClick={() => pick(mention)}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left ${
                  active ? "bg-[var(--hover-strong)]" : ""
                }`}
              >
                <span className="cs-mention-chip shrink-0">
                  <MentionIcon mention={mention} />
                </span>
                <HighlightText
                  text={match.label}
                  ranges={match.labelRanges}
                  className="cs-mention-chip-label min-w-0 truncate text-[11px]"
                />
              </RippleButton>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  );
}
