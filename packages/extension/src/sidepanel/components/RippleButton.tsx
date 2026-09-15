import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useRipple } from "../useRipple";

/**
 * 两种按钮材质的 hover：
 * - ghost（默认）：中性半透明覆盖，用于描边 / 透明底的次要按钮；
 * - primary：强调色实心按钮专用——hover 走强调色自身的加深 / 提亮（深色下变亮、
 *   浅色下变深），绝不套中性灰。中性灰覆盖会被读成禁用态。
 */
const PRIMARY_HOVER =
  "hover:bg-[color-mix(in_oklab,var(--brass)_86%,var(--text))] active:bg-[color-mix(in_oklab,var(--brass)_78%,var(--text))]";

export function RippleButton({
  className = "",
  children,
  variant = "ghost",
  onPointerDown,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  /** primary 用于强调色实心按钮（接受计划 / 继续 / 确认等）。 */
  variant?: "ghost" | "primary";
}) {
  const { ripples, spawn, done } = useRipple();
  const tone = variant === "primary" ? PRIMARY_HOVER : "hover:bg-[var(--hover)]";
  return (
    <button
      type="button"
      className={`relative overflow-hidden ${tone} ${className}`}
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
