import type { AttachmentItem } from "@shared";

const BROWSER_PREVIEW_EXTS = new Set([
  "md", "markdown", "txt", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml", "toml", "xml",
  "html", "htm", "css", "js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "py", "rs", "java", "c", "h",
  "cpp", "sh", "sql", "ini", "conf", "env",
  "pdf", "svg", "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "avif", "heic", "heif", "tif", "tiff",
  "mp3", "wav", "m4a", "ogg", "mp4", "webm", "mov",
]);

export function canPreviewArtifact(item: AttachmentItem): boolean {
  if (item.missing || item.kind === "folder" || item.kind === "element") return false;
  if (item.kind === "image") return true;
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  return BROWSER_PREVIEW_EXTS.has(ext);
}

export function dirOf(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (cut < 0) return "";
  if (cut === 0) return path.startsWith("/") ? "/" : "";
  if (cut === 2 && path[1] === ":" && /[\\/]/.test(path[2] ?? "")) return path.slice(0, 3);
  return path.slice(0, cut);
}

export function artifactDir(items: AttachmentItem[]): string {
  const first = items.find((item) => !item.missing) ?? items[0];
  if (!first) return "";
  return first.kind === "folder" ? first.path : dirOf(first.path);
}
