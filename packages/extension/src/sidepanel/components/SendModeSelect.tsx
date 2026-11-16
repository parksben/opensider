import { Crosshair, ListOrdered } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { COMPOSER_ICON_PX } from "../layout";
import { useRipple } from "../useRipple";
import { RippleButton } from "./RippleButton";

const OPTIONS = [
  { id: "steer", icon: Crosshair, label: "steerMode" },
  { id: "queue", icon: ListOrdered, label: "queueMode" },
] as const;

/**
 * How a message sent during a running turn should be handled.
 *
 * Sits in the row below the composer next to the Agent-mode and permission pills, so it
 * uses the exact same pill/menu interaction instead of the old segmented control.
 */
export function SendModeSelect({
  locale,
  mode,
  iconOnly,
  onMode,
}: {
  locale: Locale;
  mode: "steer" | "queue";
  iconOnly: boolean;
  onMode: (mode: "steer" | "queue") => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = OPTIONS.find((option) => option.id === mode) ?? OPTIONS[0];
  const CurrentIcon = current.icon;
  const currentLabel = t(locale, current.label);
  const tip = t(locale, "sendModeTip").replace("{mode}", currentLabel);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`relative min-w-0 shrink ${iconOnly ? "" : "min-w-[4.5rem] max-w-full"}`}>
      <button
        type="button"
        title={tip}
        aria-label={tip}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        className={`relative flex h-7 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full text-[11px] text-[var(--muted)] hover:bg-[var(--hover)] ${
          iconOnly ? "w-7 justify-center px-0" : "max-w-full min-w-0 px-2"
        }`}
      >
        <CurrentIcon size={COMPOSER_ICON_PX} className="shrink-0" />
        {iconOnly ? null : <span className="min-w-0 truncate">{currentLabel}</span>}
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="cs-ripple"
            style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
            onAnimationEnd={() => done(ripple.id)}
          />
        ))}
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-[80] mb-1.5 w-40 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            const active = option.id === mode;
            return (
              <RippleButton
                key={option.id}
                onClick={() => {
                  onMode(option.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[12px] ${
                  active ? "bg-[var(--hover-strong)] text-[var(--text)]" : "text-[var(--muted)]"
                }`}
              >
                <Icon size={COMPOSER_ICON_PX} />
                {t(locale, option.label)}
              </RippleButton>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
