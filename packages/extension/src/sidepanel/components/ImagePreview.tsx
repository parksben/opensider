import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../i18n";
import { t } from "../i18n";

export function ImagePreview({
  locale,
  name,
  path,
  loadSrc,
  onClose,
}: {
  locale: Locale;
  name: string;
  path: string;
  loadSrc: (path: string) => Promise<string>;
  onClose: () => void;
}) {
  const [src, setSrc] = useState("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setSrc("");
    setReady(false);
    setFailed(false);
    loadSrc(path)
      .then((url) => {
        objectUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, loadSrc]);

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
          {src ? (
            <img
              src={src}
              alt={name}
              onLoad={() => setReady(true)}
              onError={() => setFailed(true)}
              className={`max-h-[100vh] max-w-[80vw] bg-transparent object-contain ${ready ? "" : "hidden"}`}
            />
          ) : null}
          {ready ? null : <LoaderCircle size={28} strokeWidth={2} className="cs-preview-spin text-[var(--text)]" />}
        </>
      )}
    </div>,
    document.body,
  );
}
