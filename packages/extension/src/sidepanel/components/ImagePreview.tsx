import { LoaderCircle, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TransformComponent, TransformWrapper, useControls } from "react-zoom-pan-pinch";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { isPreviewBackdropClose, previewPointerDragged } from "../image-preview";
import { IconButton } from "./IconButton";

const CHROME_CLASS = "cs-preview-chrome";

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const chromeBtn = "flex h-7 w-7 items-center justify-center rounded-md text-[var(--text)]";

function PreviewChrome({
  locale,
  onClose,
  children,
}: {
  locale: Locale;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      data-preview-chrome
      className={`${CHROME_CLASS} absolute right-3 top-3 z-[2] flex items-center gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] p-0.5 shadow-lg`}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
      <IconButton side="bottom" label={t(locale, "previewClose")} onClick={onClose} className={chromeBtn}>
        <X size={14} />
      </IconButton>
    </div>
  );
}

function PreviewTools({ locale, onClose }: { locale: Locale; onClose: () => void }) {
  const { zoomIn, zoomOut, resetTransform } = useControls();
  return (
    <PreviewChrome locale={locale} onClose={onClose}>
      <IconButton side="bottom" label={t(locale, "previewZoomIn")} onClick={() => zoomIn()} className={chromeBtn}>
        <ZoomIn size={14} />
      </IconButton>
      <IconButton side="bottom" label={t(locale, "previewZoomOut")} onClick={() => zoomOut()} className={chromeBtn}>
        <ZoomOut size={14} />
      </IconButton>
      <IconButton side="bottom" label={t(locale, "previewReset")} onClick={() => resetTransform()} className={chromeBtn}>
        <RotateCcw size={14} />
      </IconButton>
      <span aria-hidden className="mx-0.5 h-4 w-px bg-[var(--line)]" />
    </PreviewChrome>
  );
}

function PreviewStage({
  locale,
  name,
  src,
  onClose,
}: {
  locale: Locale;
  name: string;
  src: string;
  onClose: () => void;
}) {
  const motionOff = reduceMotion();
  return (
    <div className="absolute inset-0">
      <TransformWrapper
        minScale={0.25}
        maxScale={8}
        centerOnInit
        centerZoomedOut
        wheel={{ step: 0.12, excluded: [CHROME_CLASS] }}
        pinch={{ excluded: [CHROME_CLASS] }}
        panning={{ velocityDisabled: true, excluded: [CHROME_CLASS] }}
        doubleClick={{ mode: "zoomIn", animationTime: motionOff ? 0 : 200, excluded: [CHROME_CLASS] }}
        zoomAnimation={{ disabled: motionOff, animationTime: motionOff ? 0 : 200 }}
        velocityAnimation={{ disabled: true }}
      >
        <PreviewTools locale={locale} onClose={onClose} />
        <TransformComponent
          wrapperClass="cs-preview-stage"
          contentClass="cs-preview-image"
          wrapperStyle={{ width: "100%", height: "100%" }}
        >
          <img
            src={src}
            alt={name}
            draggable={false}
            className="max-h-[100vh] max-w-[80vw] select-none bg-transparent object-contain"
          />
        </TransformComponent>
      </TransformWrapper>
    </div>
  );
}

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
  const pointer = useRef<{ x: number; y: number; dragged: boolean } | null>(null);

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
      className="fixed inset-0 z-[90] bg-[var(--overlay)] backdrop-blur-[2px]"
      onPointerDown={(event) => {
        pointer.current = { x: event.clientX, y: event.clientY, dragged: false };
      }}
      onPointerMove={(event) => {
        if (!pointer.current || pointer.current.dragged) return;
        if (previewPointerDragged(pointer.current, event.clientX, event.clientY)) {
          pointer.current.dragged = true;
        }
      }}
      onClick={(event) => {
        const dragged = pointer.current?.dragged ?? false;
        pointer.current = null;
        if (isPreviewBackdropClose(event.target, dragged)) onClose();
      }}
    >
      {failed ? (
        <>
          <PreviewChrome locale={locale} onClose={onClose} />
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-[13px] text-[var(--text)]">
            {t(locale, "previewImageFailed")}
          </p>
        </>
      ) : src && ready ? (
        <PreviewStage locale={locale} name={name} src={src} onClose={onClose} />
      ) : (
        <>
          <PreviewChrome locale={locale} onClose={onClose} />
          {src ? (
            <img
              src={src}
              alt=""
              className="hidden"
              onLoad={() => setReady(true)}
              onError={() => setFailed(true)}
            />
          ) : null}
          <LoaderCircle size={28} strokeWidth={2} className="cs-preview-spin absolute inset-0 m-auto text-[var(--text)]" />
        </>
      )}
    </div>,
    document.body,
  );
}
