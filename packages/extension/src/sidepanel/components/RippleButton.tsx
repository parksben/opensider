import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useRipple } from "../useRipple";

export function RippleButton({
  className = "",
  children,
  onPointerDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  const { ripples, spawn, done } = useRipple();
  return (
    <button
      type="button"
      className={`relative overflow-hidden hover:bg-[var(--hover)] ${className}`}
      onPointerDown={(event) => {
        if (!props.disabled) spawn(event);
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
    </button>
  );
}
