import { useEffect, useRef } from "react";
import type { Locale } from "../i18n";
import { ModalShell } from "./ModalShell";
import { RippleButton } from "./RippleButton";

/**
 * 全局面板式确认弹窗（只有一个动作需要二次确认时用它）。
 *
 * 与其余模态窗同一套外壳（ModalShell）：遮罩、标题栏、Esc / 点遮罩取消。默认焦点给
 * **取消**——这是高危动作前的确认，别让一个回车就把事情做了。
 *
 * 高危按钮用主题里的语义色 `--bad`（浅色深红、深色亮红，与 `--brass` 一样按主题翻转），
 * 文字色沿用 `--on-brass`（它就是「饱和强调色上的文字」，两种主题下都与 --bad 对比正确），
 * hover 走强调色自身的加深 / 提亮，不套中性灰（见 RippleButton 的说明）。
 */
export function ConfirmDialog({
  locale,
  title,
  message,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  locale: Locale;
  title: string;
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <ModalShell locale={locale} title={title} onClose={onCancel}>
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3">
        <p className="m-0 text-[12px] leading-relaxed text-[var(--text)]">{message}</p>
        <div className="flex shrink-0 justify-end gap-1.5">
          {/* 高危动作前的确认：焦点默认落在「取消」上，别让一个回车就把事情做了。 */}
          <RippleButton
            autoFocus
            onClick={onCancel}
            className="rounded-md border border-[var(--line)] px-2.5 py-1.5 text-[12px] text-[var(--text)]"
          >
            {cancelLabel}
          </RippleButton>
          <RippleButton
            onClick={onConfirm}
            className="rounded-md bg-[var(--bad)] px-2.5 py-1.5 text-[12px] text-[var(--on-brass)] hover:bg-[color-mix(in_oklab,var(--bad)_86%,var(--text))] active:bg-[color-mix(in_oklab,var(--bad)_78%,var(--text))]"
          >
            {confirmLabel}
          </RippleButton>
        </div>
      </div>
    </ModalShell>
  );
}
