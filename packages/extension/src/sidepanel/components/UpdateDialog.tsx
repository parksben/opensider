import type { Locale } from "../i18n";
import { t } from "../i18n";
import { hostUpdatePrompt } from "../platform";
import { PromptDialog } from "./PromptDialog";

/**
 * 顶栏更新图标点开的模态窗：先亮出「扩展 / 桥接 / 最新」三个版本，再给一段可复制的
 * 更新提示词。更新动作不在这里做——用户把它发给自己的 AI Agent，由 agent 按 skill 执行。
 */
export function UpdateDialog({
  locale,
  versions,
  onClose,
}: {
  locale: Locale;
  versions: { extension: string; bridge?: string; latest?: string };
  onClose: () => void;
}) {
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);
  const unknown = label("versionUnknown");
  const rows: Array<[string, string]> = [
    [label("versionExtension"), versions.extension || unknown],
    [label("versionBridge"), versions.bridge || unknown],
    [label("versionLatest"), versions.latest || unknown],
  ];

  return (
    <PromptDialog
      locale={locale}
      title={label("updateDialogTitle")}
      hint={label("updateDialogHint")}
      prompt={hostUpdatePrompt(locale)}
      copyLabel={label("copyUpdatePrompt")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-1">
        {rows.map(([name, value]) => (
          <span key={name} className="flex items-center gap-2 text-[12px]">
            <span className="shrink-0 text-[var(--muted)]">{name}</span>
            <span className="min-w-0 flex-1 truncate text-right text-[var(--text)]">{value}</span>
          </span>
        ))}
      </div>
    </PromptDialog>
  );
}
