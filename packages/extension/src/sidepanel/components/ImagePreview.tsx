import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toFileUrl } from "../file-url";
import type { Locale } from "../i18n";
import { t } from "../i18n";

export function ImagePreview({
  locale,
  name,
  path,
  onClose,
}: {
  locale: Locale;
  name: string;
  path: string;
  onClose: () => void;
}) {
  const src = toFileUrl(path);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(!src);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(locale, "previewImage")}
      onClick={onClose}
      className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--overlay)] backdrop-blur-[2px]"
    >
      {failed ? (
        <p className="max-w-[80vw] px-4 text-center text-[13px] text-[var(--text)]">{t(locale, "previewImageFailed")}</p>
      ) : (
        <>
          <img
            src={src}
            alt={name}
            onLoad={() => setReady(true)}
            onError={() => setFailed(true)}
            className={`max-h-[100vh] max-w-[80vw] bg-transparent object-contain ${ready ? "" : "hidden"}`}
          />
          {ready ? null : <LoaderCircle size={28} strokeWidth={2} className="cs-preview-spin text-[var(--text)]" />}
        </>
      )}
    </div>,
    document.body,
  );
}
