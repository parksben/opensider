import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { RippleButton } from "./RippleButton";

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
};

const MENU_WIDTH = 176;
const ITEM_HEIGHT = 32;

/**
 * 右键小菜单：贴着光标弹出，按视口夹紧，点别处 / `Escape` / 滚动 / 缩放都会关。
 *
 * 只做「一列动作项」这一种形态——消息气泡与图片预览都用它，样式与关闭行为只维护一处。
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [onClose]);

  const height = items.length * ITEM_HEIGHT + 8;
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  return createPortal(
    <div
      role="menu"
      style={{ top, left, width: MENU_WIDTH }}
      className="fixed z-[95] overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel)] py-1 shadow-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item) => (
        <RippleButton
          key={item.id}
          role="menuitem"
          onClick={() => {
            onClose();
            item.onSelect();
          }}
          className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] text-[var(--text)]"
        >
          {item.icon ? <span className="shrink-0 text-[var(--muted)]">{item.icon}</span> : null}
          {item.label}
        </RippleButton>
      ))}
    </div>,
    document.body,
  );
}
