import { ChevronDown, ChevronRight } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { FadeScroll } from "./FadeScroll";

export function TextFold({
  label,
  icon,
  paneClass,
  children,
}: {
  label: string;
  icon?: ReactNode;
  paneClass: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const anchorTop = useRef<number | null>(null);

  const toggle = () => {
    anchorTop.current = toggleRef.current?.getBoundingClientRect().top ?? null;
    setOpen((value) => !value);
  };

  useLayoutEffect(() => {
    if (anchorTop.current == null || !toggleRef.current) return;
    const thread = toggleRef.current.closest(".cs-thread");
    if (!(thread instanceof HTMLElement)) {
      anchorTop.current = null;
      return;
    }
    thread.scrollTop += toggleRef.current.getBoundingClientRect().top - anchorTop.current;
    anchorTop.current = null;
  }, [open]);

  return (
    <div>
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        className="group flex w-full items-center bg-transparent py-0.5 text-left"
      >
        <span className="inline-flex min-w-0 items-center gap-1 text-[12px] text-[var(--muted)]">
          {icon}
          <span className="min-w-0 truncate">{label}</span>
          {open ? (
            <ChevronDown size={12} className="shrink-0" />
          ) : (
            <ChevronRight size={12} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
          )}
        </span>
      </button>
      {open ? <FadeScroll className={paneClass}>{children}</FadeScroll> : null}
    </div>
  );
}
