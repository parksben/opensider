import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { writeClipboard } from "../clipboard";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { hostUpdatePrompt } from "../platform";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

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
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  const label = (key: Parameters<typeof t>[1]) => t(locale, key);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = async () => {
    if (!(await writeClipboard(hostUpdatePrompt(locale)))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const unknown = label("versionUnknown");
  const rows: Array<[string, string]> = [
    [label("versionExtension"), versions.extension || unknown],
    [label("versionBridge"), versions.bridge || unknown],
    [label("versionLatest"), versions.latest || unknown],
  ];

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label("updateDialogTitle")}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[22rem] flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13px] font-medium text-[var(--text)]">{label("updateDialogTitle")}</span>
          <IconButton
            label={label("previewClose")}
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <X size={14} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-1">
          {rows.map(([name, value]) => (
            <span key={name} className="flex items-center gap-2 text-[12px]">
              <span className="shrink-0 text-[var(--muted)]">{name}</span>
              <span className="min-w-0 flex-1 truncate text-right text-[var(--text)]">{value}</span>
            </span>
          ))}
        </div>

        <p className="m-0 text-[12px] leading-relaxed text-[var(--muted)]">{label("updateDialogHint")}</p>

        <pre className="m-0 max-h-[9rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel-2)_80%,transparent)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--text)]">
          {hostUpdatePrompt(locale)}
        </pre>

        <RippleButton
          onClick={() => void copy()}
          className="rounded-md bg-[var(--brass)] px-2.5 py-2 text-center text-[12px] text-[var(--on-brass)]"
        >
          {copied ? label("copiedReply") : label("copyUpdatePrompt")}
        </RippleButton>
      </div>
    </div>
  );
}
