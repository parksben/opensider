import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { detectDesktopOs, hostInstallScript } from "../platform";
import { IconButton } from "./IconButton";

async function writeClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.left = "-9999px";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    field.remove();
    if (!ok) throw new Error("copy failed");
  }
}

export function BridgeSetup({ locale }: { locale: Locale }) {
  const script = hostInstallScript();
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const copyScript = async () => {
    try {
      await writeClipboard(script);
      setCopied(true);
      window.clearTimeout(copiedTimer.current);
      copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-5 py-8">
      <div className="flex w-full max-w-[22rem] flex-col items-center gap-5">
        <p className="text-center text-[13px] leading-relaxed text-[var(--muted)]">
          {t(locale, detectDesktopOs() === "windows" ? "bridgeHintWindows" : "bridgeHint")}
        </p>
        <div className="flex w-full flex-col gap-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-3">
          <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-relaxed text-[var(--text)]">
            {script}
          </pre>
          <div className="flex justify-end">
            <IconButton
              label={copied ? t(locale, "copiedReply") : t(locale, "copyReply")}
              onClick={() => void copyScript()}
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
