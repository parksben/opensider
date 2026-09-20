import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";

/**
 * 全局面板式模态窗的外壳：遮罩 + 居中面板 + 标题栏（一条分隔线 + 关闭钮）。
 *
 * 抽出来的唯一目的是**让所有这类弹窗长得一模一样**：更新 / 卸载（PromptDialog）与
 * 切换 Agent 的确认（ConfirmDialog）都往这里塞内容，样式只有这一份，不会各自漂移。
 * 行为也一致：Esc 关闭、点遮罩关闭（点面板本身不关）。
 */
export function ModalShell({
  locale,
  title,
  onClose,
  children,
}: {
  locale: Locale;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 面板里可能还有别的 Esc 处理（输入框、菜单），别让它们抢走。
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[22rem] flex-col overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--panel)] shadow-xl"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--line)] px-3 py-2.5">
          <span className="min-w-0 truncate text-[12.5px] font-medium text-[var(--text)]">{title}</span>
          <IconButton
            label={t(locale, "previewClose")}
            onClick={onClose}
            className="-mr-0.5 shrink-0 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <X size={14} />
          </IconButton>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
