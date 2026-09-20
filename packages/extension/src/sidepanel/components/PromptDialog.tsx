import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { writeClipboard } from "../clipboard";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { ModalShell } from "./ModalShell";
import { RippleButton } from "./RippleButton";

/**
 * 「把这段提示词发给你的 AI Agent」模态窗的通用外壳：更新与卸载只是往里填词。
 *
 * 观感与其余界面同源：外壳走 ModalShell（与确认弹窗同一套遮罩 / 标题栏 / Esc 行为），
 * 提示词块沿用 BridgeSetup 的「面板里再放一块等宽文本」，按钮沿用设置页那套描边按钮
 * （RippleButton 自带涟漪与 hover 底色），复制后换成对勾 +「已复制」，与消息气泡、
 * BridgeSetup 的复制反馈一致。本机不做任何动作——动作由用户的 Agent 按 skill 执行。
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

  const copy = async () => {
    if (!(await writeClipboard(prompt))) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <ModalShell locale={locale} title={title} onClose={onClose}>
      <div className="flex min-h-0 flex-col gap-2.5 overflow-y-auto px-3 py-3">
        {children}

        <p className="m-0 text-[12px] leading-relaxed text-[var(--muted)]">{hint}</p>

        <div className="rounded-lg border border-[var(--line)] bg-[var(--panel-2)] px-2.5 py-2">
          <pre className="m-0 max-h-[9rem] overflow-y-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--text)]">
            {prompt}
          </pre>
        </div>

        <RippleButton
          onClick={() => void copy()}
          className="rounded-md border border-[var(--line)] px-2.5 py-1.5 text-center text-[12px] text-[var(--text)]"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1 text-[var(--ok)]">
              <Check size={12} />
              {label("copiedReply")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Copy size={12} className="text-[var(--muted)]" />
              {copyLabel}
            </span>
          )}
        </RippleButton>
      </div>
    </ModalShell>
  );
}
