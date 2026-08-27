import type { AgentInfo } from "@shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { useRipple } from "../useRipple";
import { RippleButton } from "./RippleButton";

export function AgentSelect({
  locale,
  agents,
  selectedId,
  onSelect,
}: {
  locale: Locale;
  agents: AgentInfo[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuBox, setMenuBox] = useState<{ top: number; left: number; width: number }>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = agents.find((item) => item.id === selectedId) ?? agents[0];

  useLayoutEffect(() => {
    if (!open) return;
    const node = rootRef.current;
    if (!node) return;
    const place = () => {
      const box = node.getBoundingClientRect();
      setMenuBox({ top: box.bottom + 6, left: box.left, width: Math.max(box.width, 168) });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
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

  if (!current) return null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        title={t(locale, "switchAgent")}
        aria-label={t(locale, "switchAgent")}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => spawn(event)}
        className="relative flex h-7 max-w-[9.5rem] items-center gap-1 overflow-hidden rounded-full border border-[var(--line)] px-2.5 text-[12px] text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <span className="min-w-0 truncate font-medium">{current.name}</span>
        <ChevronDown size={12} className="shrink-0 text-[var(--muted)]" />
        {ripples.map((ripple) => (
          <span
            key={ripple.id}
            className="cs-ripple"
            style={{ left: ripple.x, top: ripple.y, width: ripple.size, height: ripple.size }}
            onAnimationEnd={() => done(ripple.id)}
          />
        ))}
      </button>
      {open && menuBox
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: menuBox.top, left: menuBox.left, minWidth: menuBox.width }}
              className="fixed z-[70] max-h-64 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl"
            >
              {agents.map((agent) => {
                const active = agent.id === current.id;
                return (
                  <RippleButton
                    key={agent.id}
                    onClick={() => {
                      onSelect(agent.id);
                      setOpen(false);
                    }}
                    className={`flex w-full px-2.5 py-1.5 text-left text-[12.5px] ${
                      active ? "text-[var(--text)]" : "text-[var(--muted)]"
                    }`}
                  >
                    <span className="min-w-0 truncate font-medium">{agent.name}</span>
                  </RippleButton>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
