const CLOSE_LINE =
  /^[ \t]*(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*$/i;
const CLOSE_HEAD =
  /^[ \t]*(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*(?:\n+|$)/i;
const CLOSE_TAIL =
  /(?:\n[ \t]*)?(?:error:[ \t]*)?retriableerror:[ \t]*writableiterable is closed\.?[ \t]*$/i;

export function isBenignStreamCloseText(text: string): boolean {
  return text.includes("WritableIterable is closed");
}

export function isOnlyBenignStreamClose(text: string): boolean {
  if (!isBenignStreamCloseText(text)) return false;
  const trimmed = text.trim();
  if (CLOSE_LINE.test(trimmed)) return true;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return true;
  return stripBenignStreamClose(text).trim() === "";
}

export function stripBenignStreamClose(text: string): string {
  if (!isBenignStreamCloseText(text)) return text;
  let next = text;
  for (;;) {
    const cleaned = next.replace(CLOSE_HEAD, "");
    if (cleaned === next) break;
    next = cleaned;
  }
  for (;;) {
    const cleaned = next.replace(CLOSE_TAIL, "");
    if (cleaned === next) break;
    next = cleaned;
  }
  return next.replace(/[ \t\r\n]+$/, "");
}
