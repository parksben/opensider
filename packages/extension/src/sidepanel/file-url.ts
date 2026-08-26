export function toFileUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^file:/i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/\\/g, "/");
  const rooted = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${rooted
    .split("/")
    .map((part) => (part ? encodeURIComponent(part) : ""))
    .join("/")}`;
}
