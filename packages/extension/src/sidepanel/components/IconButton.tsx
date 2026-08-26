import { useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRipple } from "../useRipple";

const SAFE = 8;
const GAP = 6;

function placeTooltip(
  anchor: DOMRect,
  tip: { width: number; height: number },
  prefer: "top" | "bottom",
): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const maxLeft = Math.max(SAFE, vw - SAFE - tip.width);
  const maxTop = Math.max(SAFE, vh - SAFE - tip.height);

  const above = anchor.top - tip.height - GAP;
  const below = anchor.bottom + GAP;
  let top = prefer === "top" ? above : below;
  if (prefer === "top" && above < SAFE && below + tip.height <= vh - SAFE) top = below;
  if (prefer === "bottom" && below + tip.height > vh - SAFE && above >= SAFE) top = above;
  top = Math.min(Math.max(top, SAFE), maxTop);

  let left = anchor.left + anchor.width / 2 - tip.width / 2;
  left = Math.min(Math.max(left, SAFE), maxLeft);
  return { top, left };
}

export function IconButton({
  label,
  tooltip,
  side = "bottom",
  ripple = true,
  className = "",
  children,
  onPointerDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tooltip?: ReactNode;
  side?: "top" | "bottom";
  ripple?: boolean;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false });
  const { ripples, spawn, done } = useRipple();

  useLayoutEffect(() => {
    if (!open) {
      setPos((current) => (current.ready ? { ...current, ready: false } : current));
      return;
    }
    const button = buttonRef.current;
    const tip = tipRef.current;
    if (!button || !tip) return;
    const next = placeTooltip(button.getBoundingClientRect(), tip.getBoundingClientRect(), side);
    setPos({ ...next, ready: true });
  }, [open, side, label]);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={label}
      className={`relative overflow-hidden ${ripple ? "hover:bg-[var(--hover)]" : ""} ${className}`}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onPointerDown={(event) => {
        if (ripple && !props.disabled) spawn(event);
        onPointerDown?.(event);
      }}
      {...props}
    >
      {children}
      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          className="cs-ripple"
          style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
          onAnimationEnd={() => done(ripple.id)}
        />
      ))}
      {open
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              className="pointer-events-none fixed z-50 max-w-[calc(100vw-16px)] whitespace-pre-line rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-left text-[11px] text-[var(--text)] shadow-lg"
              style={{
                top: pos.ready ? pos.top : 0,
                left: pos.ready ? pos.left : 0,
                opacity: pos.ready ? 1 : 0,
              }}
            >
              {tooltip ?? label}
            </span>,
            document.body,
          )
        : null}
    </button>
  );
}
