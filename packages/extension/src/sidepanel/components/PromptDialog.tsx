import { X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeClipboard } from "../clipboard";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";

/**
 * 「把这段提示词发给你的 AI Agent」模态窗的通用外壳：标题 + 可选附加块（如版本行）+
 * 说明 + 等宽提示词 + 复制按钮。更新与卸载都只是往里填词，形状保持一致。
 * 本机不做任何动作——动作由用户的 Agent 按 skill 执行。
 */
export function PromptDialog({
  locale,
  title,
  hint,
  prompt,
  copyLabel,
  children,
  onClose,
}: {
  locale: Locale;
  title: string;
  hint: string;
  prompt: string;
  copyLabel: string;
  /** 插在说明上方的额外内容，例如三个版本行。 */
  children?: ReactNode;
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
    if (!(await writeClipboard(prompt))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-[22rem] flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-xl"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-[13px] font-medium text-[var(--text)]">{title}</span>
          <IconButton
            label={label("previewClose")}
            onClick={onClose}
            className="-mr-1 -mt-1 rounded p-1 text-[var(--muted)] hover:text-[var(--text)]"
          >
            <X size={14} />
          </IconButton>
        </div>

        {children}

        <p className="m-0 text-[12px] leading-relaxed text-[var(--muted)]">{hint}</p>

        <pre className="m-0 max-h-[9rem] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--line)] bg-[color-mix(in_oklab,var(--panel-2)_80%,transparent)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--text)]">
          {prompt}
        </pre>

        <RippleButton
          onClick={() => void copy()}
          className="rounded-md bg-[var(--brass)] px-2.5 py-2 text-center text-[12px] text-[var(--on-brass)]"
        >
          {copied ? label("copiedReply") : copyLabel}
        </RippleButton>
      </div>
    </div>
  );
}
