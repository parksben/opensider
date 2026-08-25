import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  label,
  side = "bottom",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  side?: "top" | "bottom";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={`group/icon relative ${className}`}
      {...props}
    >
      {children}
      <span
        className={`pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--line)] bg-[var(--panel)] px-2 py-1 text-[11px] text-[var(--text)] opacity-0 shadow-lg transition-opacity group-hover/icon:opacity-100 ${
          side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
