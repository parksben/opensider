import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { HostToExt } from "@shared";
import { connectSidebar } from "../sidepanel/bridge";
import { Markdown } from "../sidepanel/components/Markdown";
import { detectBrowserLocale, readCachedLocale, t, type Locale } from "../sidepanel/i18n";

type Loaded =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "text"; mime: string; text: string }
  | { phase: "binary"; mime: string; url: string };

const params = new URLSearchParams(window.location.search);
const path = params.get("path") ?? "";
const name = params.get("name") || path.split(/[\\/]/).pop() || path;
const locale: Locale = readCachedLocale() ?? detectBrowserLocale();

function extensionOf(value: string): string {
  const base = value.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function baseMime(mime: string): string {
  return mime.split(";")[0].trim().toLowerCase();
}

function isText(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/x-ndjson" ||
    mime === "application/yaml"
  );
}

function errorMessage(error: string): string {
  const lower = error.toLowerCase();
  if (lower.includes("too large")) return t(locale, "previewTooLarge");
  if (lower.includes("empty")) return t(locale, "previewEmpty");
  return t(locale, "previewFailed");
}

function decode(chunks: string[], mime: string): Loaded {
  const raw = chunks.join("");
  if (!raw) return { phase: "error", message: t(locale, "previewEmpty") };
  const bytes = Uint8Array.from(atob(raw), (char) => char.charCodeAt(0));
  if (bytes.length === 0) return { phase: "error", message: t(locale, "previewEmpty") };
  const type = baseMime(mime) || "application/octet-stream";
  if (isText(type)) {
    return { phase: "text", mime: type, text: new TextDecoder("utf-8").decode(bytes) };
  }
  return { phase: "binary", mime: type, url: URL.createObjectURL(new Blob([bytes], { type })) };
}

export function ArtifactPreview() {
  const [state, setState] = useState<Loaded>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const urlRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setState({ phase: "error", message: t(locale, "previewFailed") });
      return;
    }
    let settled = false;
    let received = 0;
    let total = 0;
    let mime = "";
    const chunks: string[] = [];
    const timer = window.setTimeout(() => {
      settled = true;
      setState({ phase: "error", message: t(locale, "previewFailed") });
    }, 20_000);
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      setState({ phase: "error", message });
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        const next = decode(chunks, mime);
        if (next.phase === "binary") {
          if (urlRef.current) URL.revokeObjectURL(urlRef.current);
          urlRef.current = next.url;
        }
        setState(next);
      } catch {
        setState({ phase: "error", message: t(locale, "previewFailed") });
      }
    };

    const requestId = crypto.randomUUID();
    const bridge = connectSidebar((msg: HostToExt) => {
      if (msg.type !== "fs.read" || msg.requestId !== requestId) return;
      if (msg.error) {
        fail(errorMessage(msg.error));
        return;
      }
      if (typeof msg.mime === "string") mime = msg.mime;
      if (typeof msg.total === "number") total = msg.total;
      if (typeof msg.index === "number" && typeof msg.data === "string" && !chunks[msg.index]) {
        chunks[msg.index] = msg.data;
        received += 1;
      }
      if (total > 0 && received >= total) finish();
    }, "preview");
    bridge.send({ type: "fs.read", requestId, path });

    return () => {
      settled = true;
      window.clearTimeout(timer);
      bridge.disconnect();
    };
  }, [attempt]);

  const retry = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = undefined;
    }
    setState({ phase: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    document.title = name ? `${name} · OpenSider` : "OpenSider";
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, []);

  const frame =
    (state.phase === "text" && state.mime === "text/html") ||
    (state.phase === "binary" && (state.mime === "application/pdf" || state.mime.startsWith("video/")));

  let body: ReactNode;
  if (state.phase === "loading") {
    body = <p className="preview-status">{t(locale, "previewLoading")}</p>;
  } else if (state.phase === "error") {
    body = (
      <div className="preview-status">
        <p>{state.message}</p>
        <button type="button" className="preview-retry" onClick={retry}>
          {t(locale, "previewRetry")}
        </button>
      </div>
    );
  } else if (state.phase === "text") {
    const ext = extensionOf(path);
    if (ext === "md" || ext === "markdown" || state.mime === "text/markdown") {
      body = (
        <div className="preview-doc">
          <Markdown text={state.text} />
        </div>
      );
    } else if (state.mime === "text/html") {
      body = <iframe className="preview-frame" sandbox="" srcDoc={state.text} title={name} />;
    } else {
      body = <pre className="preview-text">{state.text}</pre>;
    }
  } else if (state.mime.startsWith("image/")) {
    body = <img className="preview-image" src={state.url} alt={name} />;
  } else if (state.mime === "application/pdf") {
    body = <iframe className="preview-frame" src={state.url} title={name} />;
  } else if (state.mime.startsWith("audio/")) {
    body = <audio className="preview-media" controls src={state.url} />;
  } else if (state.mime.startsWith("video/")) {
    body = <video className="preview-media" controls src={state.url} />;
  } else {
    body = <p className="preview-status">{t(locale, "previewUnsupported")}</p>;
  }

  return (
    <div className="preview-shell">
      <header className="preview-header">
        <div className="preview-title" title={path}>
          {name}
        </div>
        <div className="preview-path" title={path}>
          {path}
        </div>
      </header>
      <main className={`preview-main${frame ? " is-frame" : ""}`}>{body}</main>
    </div>
  );
}
