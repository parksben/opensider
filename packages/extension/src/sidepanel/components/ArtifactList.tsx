import type { AttachmentItem } from "@shared";
import { ChevronDown, ChevronRight, Eye, File, FileArchive, FileCode, FileSpreadsheet, FileText, Folder, FolderOpen, Image } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "../i18n";
import { t } from "../i18n";
import { IconButton } from "./IconButton";
import { RippleButton } from "./RippleButton";
import { artifactDir } from "../artifact-preview";

function artifactKey(items: AttachmentItem[]): string {
  return items.map((item) => item.path).join("\n");
}

function artifactIcon(item: AttachmentItem) {
  if (item.kind === "folder") return Folder;
  if (item.kind === "image") return Image;
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  if (["md", "txt", "rtf", "pdf", "doc", "docx"].includes(ext)) return FileText;
  if (["xls", "xlsx", "csv", "tsv"].includes(ext)) return FileSpreadsheet;
  if (["zip", "tar", "gz", "tgz", "7z", "rar"].includes(ext)) return FileArchive;
  if (["js", "ts", "tsx", "jsx", "json", "go", "py", "rs", "java", "css", "html", "yml", "yaml", "sh"].includes(ext)) {
    return FileCode;
  }
  return File;
}

export function ArtifactList({
  locale,
  items,
  onReveal,
  onOpenDirectory,
  onPreview,
  canPreview = () => false,
}: {
  locale: Locale;
  items: AttachmentItem[];
  onReveal: (path: string) => void;
  onOpenDirectory?: (path: string) => void;
  onPreview?: (item: AttachmentItem) => void;
  canPreview?: (item: AttachmentItem) => boolean;
}) {
  const [open, setOpen] = useState(true);
  const seen = useRef("");
  const key = artifactKey(items);

  useEffect(() => {
    if (items.length === 0) {
      seen.current = "";
      return;
    }
    if (key !== seen.current) {
      seen.current = key;
      setOpen(true);
    }
  }, [key, items.length]);

  if (items.length === 0) return null;

  const title = t(locale, "artifactList").replace("{count}", String(items.length));
  const directory = artifactDir(items);

  return (
    <section className="mb-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--panel-2)]">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <RippleButton
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-0.5 text-left"
        >
          <span className="min-w-0 truncate text-[12.5px] font-medium tracking-tight">{title}</span>
        </RippleButton>
        {directory && onOpenDirectory ? (
          <IconButton
            label={t(locale, "openArtifactDir")}
            onClick={() => onOpenDirectory(directory)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)]"
          >
            <FolderOpen size={14} />
          </IconButton>
        ) : null}
        <IconButton
          label={open ? t(locale, "collapseArtifacts") : t(locale, "expandArtifacts")}
          onClick={() => setOpen((value) => !value)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)]"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </IconButton>
      </div>
      {open ? (
        <ul className="cs-list-cap border-t border-[var(--line)] py-1">
          {items.map((item) => {
            const Icon = artifactIcon(item);
            return (
              <li
                key={item.path}
                className="group flex items-center gap-1.5 px-2.5 py-1.5"
                title={item.path}
              >
                <Icon size={14} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">{item.name}</span>
                {item.missing ? (
                  <span className="shrink-0 text-[11px] text-[var(--muted)] opacity-70">
                    {t(locale, "artifactMissing")}
                  </span>
                ) : (
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {onPreview && canPreview(item) ? (
                      <IconButton
                        label={t(locale, "previewArtifact")}
                        onClick={() => onPreview(item)}
                        className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)]"
                      >
                        <Eye size={13} />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label={t(locale, "revealArtifact")}
                      onClick={() => onReveal(item.path)}
                      className="flex h-6 w-6 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      <FolderOpen size={13} />
                    </IconButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
