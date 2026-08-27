import type { AgentInfo } from "@shared";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { useRipple } from "../useRipple";
import { AgentMark } from "./AgentMark";

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
  const rootRef = useRef<HTMLDivElement>(null);
  const { ripples, spawn, done } = useRipple();
  const current = agents.find((item) => item.id === selectedId) ?? agents[0];

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
        className="relative flex h-7 max-w-[9.5rem] items-center gap-1.5 overflow-hidden rounded-full border border-[var(--line)] px-1.5 pr-2 text-[12px] text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <AgentMark mark={current.mark} name={current.name} size={18} />
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
      {open ? (
        <div className="absolute left-0 top-full z-30 mt-1.5 max-h-64 w-52 overflow-y-auto rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl">
          {agents.map((agent) => {
            const active = agent.id === current.id;
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  onSelect(agent.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] hover:bg-[var(--hover)] ${
                  active ? "text-[var(--text)]" : "text-[var(--muted)]"
                }`}
              >
                <AgentMark mark={agent.mark} name={agent.name} size={20} />
                <span className="min-w-0 truncate font-medium">{agent.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
