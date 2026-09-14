import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { writeClipboard } from "../clipboard";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { hostInstallPrompt } from "../platform";
import { IconButton } from "./IconButton";

export function BridgeSetup({ locale }: { locale: Locale }) {
  const prompt = hostInstallPrompt(locale);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copyPrompt = async () => {
    const ok = await writeClipboard(prompt);
    setCopied(ok);
    if (!ok) return;
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-5 py-8">
      <div className="flex w-full max-w-[22rem] flex-col items-center gap-5">
        <p className="text-center text-[13px] leading-relaxed text-[var(--muted)]">
          {t(locale, "bridgeHint")}
        </p>
        <div className="flex w-full flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-3">
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11.5px] leading-relaxed text-[var(--text)]">
            {prompt}
          </pre>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--muted)]">{t(locale, "bridgeCopyPrompt")}</span>
            <IconButton
              label={copied ? t(locale, "copiedReply") : t(locale, "copyReply")}
              onClick={() => void copyPrompt()}
              className={`rounded p-1 ${copied ? "text-[var(--ok)]" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </div>
        </div>
      </div>
    </div>
  );
}
