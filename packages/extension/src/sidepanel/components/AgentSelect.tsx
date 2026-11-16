import type { AgentInfo } from "@shared";
import { Bot } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { COMPOSER_ICON_PX } from "../layout";
import { useRipple } from "../useRipple";
import { RippleButton } from "./RippleButton";

export function AgentSelect({
  locale,
  agents,
  selectedId,
  disabled,
  onSelect,
}: {
  locale: Locale;
  agents: AgentInfo[];
  selectedId: string;
  /** 连接中 / 启动中：钮留在原地（宽度不变，输入框不抖），但不接受点击。 */
  disabled?: boolean;
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
      const width = Math.max(box.width, 168);
      // 这个钮现在住在输入框工具行里，离视口底边很近：下方放不下就向上展开（与其它
      // 输入框下拉同一套定位规则），左右也夹在视口内，绝不把菜单顶出屏幕。
      const height = Math.min(menuRef.current?.offsetHeight ?? 8 + agents.length * 34, 256);
      const below = window.innerHeight - box.bottom - 8;
      const top = below >= height ? box.bottom + 6 : Math.max(8, box.top - height - 6);
      const left = Math.max(8, Math.min(box.left, window.innerWidth - width - 8));
      setMenuBox({ top, left, width });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, agents.length]);

  // 菜单挂上之后再按真实高度校正一次（上面的首次定位只有估算高度）。只在真的放不下
  // 时才改，避免 setState → 重渲染 → setState 的循环。
  useLayoutEffect(() => {
    if (!open || !menuBox) return;
    const node = rootRef.current;
    const menu = menuRef.current;
    if (!node || !menu) return;
    const box = node.getBoundingClientRect();
    const height = Math.min(menu.offsetHeight, 256);
    const below = window.innerHeight - box.bottom - 8;
    const top = below >= height ? box.bottom + 6 : Math.max(8, box.top - height - 6);
    if (Math.abs(top - menuBox.top) > 1) setMenuBox({ ...menuBox, top });
  }, [open, menuBox]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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
    <div ref={rootRef} className="relative min-w-0 shrink">
      {/* 与底部操作行（模式 / 权限）同一套形态：平日无边框无底色，只有 hover / 展开时
          才铺一层胶囊底，图标 + 文案，不带展开箭头。 */}
      <button
        type="button"
        title={t(locale, "switchAgent")}
        aria-label={t(locale, "switchAgent")}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        onPointerDown={(event) => {
          if (!disabled) spawn(event);
        }}
        className={`relative flex h-7 w-fit max-w-[9.5rem] min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-full px-2 text-[11px] hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent ${
          open ? "bg-[var(--hover)] text-[var(--text)]" : "text-[var(--muted)]"
        }`}
      >
        <Bot size={COMPOSER_ICON_PX} className="shrink-0" />
        <span className="min-w-0 truncate">{current.name}</span>
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
