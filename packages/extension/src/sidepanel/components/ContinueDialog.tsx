import type { Locale } from "../i18n";
import { t } from "../i18n";
import { PromptDialog } from "./PromptDialog";

/**
 * 在其他 Agent 中继续：提示词已经复制到剪贴板。模态窗与更新 / 卸载同一套壳，
 * 告诉用户粘贴到另一个 Agent 的会话里。
 */
export function ContinueDialog({
  locale,
  title,
  hint,
  prompt,
  onClose,
}: {
  locale: Locale;
  title: string;
  hint: string;
  prompt: string;
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
    />
  );
}
