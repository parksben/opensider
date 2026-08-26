import { LoaderCircle, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";

export function ImagePreview({
  locale,
  name,
  src,
  error,
  onClose,
}: {
  locale: Locale;
  name: string;
  src?: string;
  error?: boolean;
  onClose: () => void;
}) {
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
      <IconButton
        side="bottom"
        label={t(locale, "closePreview")}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full text-[var(--text)] hover:bg-[var(--hover)]"
      >
        <X size={16} />
      </IconButton>
      {error ? (
        <p className="max-w-[80vw] px-4 text-center text-[13px] text-[var(--text)]">{t(locale, "previewImageFailed")}</p>
      ) : src ? (
        <img
          src={src}
          alt={name}
          onClick={(event) => event.stopPropagation()}
          className="max-h-[100vh] max-w-[80vw] bg-transparent object-contain"
        />
      ) : (
        <LoaderCircle size={22} className="animate-spin text-[var(--muted)]" />
      )}
    </div>,
    document.body,
  );
}
