import type { Locale } from "../i18n";
import { t } from "../i18n";
import { hostUninstallPrompt } from "../platform";
import { PromptDialog } from "./PromptDialog";

/**
 * 设置 tab「一键卸载」点开的模态窗：与更新窗同一套壳，只是内容换成卸载提示词。
 * 桥接与本地数据实际上都还在——真正移除由用户的 AI Agent 按 skill 执行，所以这里
 * 只给出提示词，不做任何破坏性动作。
 */
export function UninstallDialog({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);

  return (
    <PromptDialog
      locale={locale}
      title={label("uninstallDialogTitle")}
      hint={label("uninstallDialogHint")}
      prompt={hostUninstallPrompt(locale)}
      copyLabel={label("copyUninstallPrompt")}
      onClose={onClose}
    />
  );
}
