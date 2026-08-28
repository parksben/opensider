import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { RippleButton } from "./RippleButton";

const SAFE = 16;
const GAP = 6;
const DEFAULT_WIDTH = 228;

function placePopover(
  anchor: DOMRect,
  size: { width: number; height: number },
  vw: number,
  vh: number,
): { top: number; left: number; width: number; maxHeight: number } {
  const maxWidth = Math.max(120, vw - SAFE * 2);
  const width = Math.min(Math.max(size.width, 160), maxWidth);
  const maxHeight = Math.max(72, vh - SAFE * 2);
  const height = Math.min(size.height || 0, maxHeight);

  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - height;
  let top = below;
  if (below + height > vh - SAFE && above >= SAFE) top = above;
  if (top < SAFE) top = SAFE;
  if (top + height > vh - SAFE) top = Math.max(SAFE, vh - SAFE - height);

  let left = anchor.right - width;
  if (left < SAFE) left = SAFE;
  if (left + width > vw - SAFE) left = Math.max(SAFE, vw - SAFE - width);

  return { top, left, width, maxHeight };
}

export function ConfirmPopover({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  getAnchorRect,
  ignoreRef,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  getAnchorRect?: () => DOMRect | undefined;
  ignoreRef?: RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const getAnchorRectRef = useRef(getAnchorRect);
  const onCancelRef = useRef(onCancel);
  const onConfirmRef = useRef(onConfirm);
  getAnchorRectRef.current = getAnchorRect;
  onCancelRef.current = onCancel;
  onConfirmRef.current = onConfirm;
  const [pos, setPos] = useState({ top: 0, left: 0, width: DEFAULT_WIDTH, maxHeight: 224, ready: false });

  useLayoutEffect(() => {
    if (!open) {
      setPos((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const update = () => {
      const menu = rootRef.current;
      const anchor = getAnchorRectRef.current?.();
      if (!menu || !anchor) return;
      const next = placePopover(
        anchor,
        { width: Math.max(menu.offsetWidth, DEFAULT_WIDTH), height: menu.scrollHeight },
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
  }, [open, title, description]);

  useLayoutEffect(() => {
    if (!open) return;
    rootRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || ignoreRef?.current?.contains(target)) return;
      onCancelRef.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancelRef.current();
        return;
      }
      if (event.key === "Enter") {
        if (!rootRef.current?.contains(document.activeElement)) return;
        if (event.target instanceof HTMLButtonElement) return;
        event.preventDefault();
        event.stopPropagation();
        onConfirmRef.current();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ignoreRef, open]);

  if (!open) return null;

  return createPortal(
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="false"
      aria-label={title}
      tabIndex={-1}
      className="fixed z-[80] flex flex-col overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] shadow-xl outline-none"
      style={{
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxHeight: pos.maxHeight,
        maxWidth: `calc(100vw - ${SAFE * 2}px)`,
        opacity: pos.ready ? 1 : 0,
      }}
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2.5">
        <p className="text-[12.5px] font-medium text-[var(--text)]">{title}</p>
        {description ? (
          <div className="mt-1 text-[11px] leading-snug text-[var(--muted)]">{description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 justify-end gap-1.5 px-3 py-2">
        <RippleButton
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-[12px] text-[var(--muted)]"
        >
          {cancelLabel}
        </RippleButton>
        <RippleButton
          onClick={onConfirm}
          className="rounded-md bg-[var(--brass)] px-2 py-1 text-[12px] text-[var(--on-brass)] hover:bg-[var(--brass)]"
        >
          {confirmLabel}
        </RippleButton>
      </div>
    </div>,
    document.body,
  );
}
