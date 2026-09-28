import type { Locale } from "../i18n";
import { t } from "../i18n";
import { PromptDialog } from "./PromptDialog";
import { RippleButton } from "./RippleButton";

/**
 * 跨应用续聊：提示词已经复制到剪贴板。模态窗与更新 / 卸载同一套壳，告诉用户
 * 粘贴到另一端；没装另一端时多给一个前往仓库的按钮。
 */
export function ContinueDialog({
  locale,
  title,
  hint,
  prompt,
  installUrl,
  onOpenInstall,
  onClose,
}: {
  locale: Locale;
  title: string;
  hint: string;
  prompt: string;
  /** Set when the other app was not found (or could not be checked). */
  installUrl?: string;
  onOpenInstall: (url: string) => void;
  onClose: () => void;
}) {
  return (
    <PromptDialog
      locale={locale}
      title={title}
      hint={hint}
      prompt={prompt}
      copyLabel={t(locale, "copyContinuePrompt")}
      onClose={onClose}
      extra={
        installUrl ? (
          <RippleButton
            onClick={() => onOpenInstall(installUrl)}
            className="rounded-md border border-[var(--line)] px-2.5 py-1.5 text-center text-[12px] text-[var(--text)]"
          >
            {t(locale, "continueInstall")}
          </RippleButton>
        ) : null
      }
    />
  );
}
