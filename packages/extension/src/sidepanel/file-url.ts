export function toFileUrl(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (/^file:/i.test(trimmed)) return trimmed;
  const normalized = trimmed.replace(/\\/g, "/");
  const windowsDrive = /^[A-Za-z]:/.test(normalized);
  const rooted = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return `file://${rooted
    .split("/")
    .map((part, index) => {
      if (!part) return "";
      if (windowsDrive && index === 1 && /^[A-Za-z]:$/.test(part)) return part;
      return encodeURIComponent(part);
    })
    .join("/")}`;
}
