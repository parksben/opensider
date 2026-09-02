import { File, Folder } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { FsPickMode } from "@shared";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { RippleButton } from "./RippleButton";

const SAFE = 16;
const GAP = 6;
const MENU_WIDTH = 228;

function placeAbove(
  anchor: DOMRect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
): { top: number; left: number; width: number; maxHeight: number } {
  const maxWidth = Math.max(120, vw - SAFE * 2);
  const width = Math.min(Math.max(size.width, 160), maxWidth);
  const maxHeight = Math.max(72, vh - SAFE * 2);
  const height = Math.min(size.height || 0, maxHeight);
  let top = anchor.top - GAP - height;
  if (top < SAFE) top = SAFE;
  if (top + height > vh - SAFE) top = Math.max(SAFE, vh - SAFE - height);
  let left = anchor.left;
  if (left + width > vw - SAFE) left = Math.max(SAFE, vw - SAFE - width);
  if (left < SAFE) left = SAFE;
  return { top, left, width, maxHeight };
}

export function AttachMenu({
  open,
  locale,
  getAnchorRect,
  ignoreRef,
  onPick,
  onClose,
}: {
  open: boolean;
  locale: Locale;
  getAnchorRect?: () => DOMRect | undefined;
  ignoreRef?: RefObject<HTMLElement | null>;
  onPick: (mode: Extract<FsPickMode, "files" | "folders">) => void;
  onClose: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const getAnchorRectRef = useRef(getAnchorRect);
  const onCloseRef = useRef(onClose);
  getAnchorRectRef.current = getAnchorRect;
  onCloseRef.current = onClose;
  const [pos, setPos] = useState({ top: 0, left: 0, width: MENU_WIDTH, maxHeight: 224, ready: false });

  useLayoutEffect(() => {
    if (!open) {
      setPos((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const update = () => {
      const menu = rootRef.current;
      const anchor = getAnchorRectRef.current?.();
      if (!menu || !anchor) return;
      const next = placeAbove(
        anchor,
        { width: Math.max(menu.offsetWidth, MENU_WIDTH), height: menu.scrollHeight },
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
  }, [open, locale]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      onCloseRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ignoreRef, open]);

  if (!open) return null;

  const items = [
    { mode: "files" as const, icon: File, label: t(locale, "pickFiles") },
    { mode: "folders" as const, icon: Folder, label: t(locale, "pickFolders") },
  ];

  return createPortal(
    <div
      ref={rootRef}
      role="menu"
      className="fixed z-[80] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        maxWidth: `calc(100vw - ${SAFE * 2}px)`,
        opacity: pos.ready ? 1 : 0,
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <RippleButton
            key={item.mode}
            role="menuitem"
            onClick={() => onPick(item.mode)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            <Icon size={14} />
            {item.label}
          </RippleButton>
        );
      })}
    </div>,
    document.body,
  );
}
