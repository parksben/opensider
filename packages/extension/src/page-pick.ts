export const PAGE_PICK_API = "__opensiderPage";
export const PICK_ARM_MS = 200;

export const PAGE_API_METHODS = [
  "ping",
  "startPick",
  "stopPick",
  "snapshot",
  "viewport",
  "measure",
  "runCommand",
] as const;

export type PageApiMethod = (typeof PAGE_API_METHODS)[number];

export function isRestrictedUrl(url?: string): boolean {
  if (!url) return false;
  return (
    url.startsWith("chrome://") ||
    url.startsWith("edge://") ||
    url.startsWith("brave://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("https://chrome.google.com/webstore") ||
    url.startsWith("https://chromewebstore.google.com/") ||
    url.startsWith("https://microsoftedge.microsoft.com/addons")
  );
}

export function isPickablePageUrl(url?: string): boolean {
  if (!url) return false;
  if (isRestrictedUrl(url)) return false;
  return url.startsWith("http://") || url.startsWith("https://");
}

export function isPickArmed(startedAt: number, now: number, armMs = PICK_ARM_MS): boolean {
  return now >= startedAt + armMs;
}

export function pickFailureCode(error: unknown): "restricted" | "inject" | string {
  const text = String(error ?? "");
  if (/restricted/i.test(text)) return "restricted";
  if (
    /cannot access|receiving end|not injected|could not inject|cannot execute|frame was removed|no tab with id|the extensions gallery|cannot be scripted/i.test(
      text,
    )
  ) {
    return "inject";
  }
  return text;
}

export function pageToolsAllowed(url?: string): { ok: true } | { ok: false; error: string } {
  if (isRestrictedUrl(url)) {
    return { ok: false, error: "page tools are not allowed on restricted pages (chrome://, extension, or store)" };
  }
  if (!isPickablePageUrl(url)) {
    return { ok: false, error: "page tools only work on http(s) pages" };
  }
  return { ok: true };
}

export function pageCommandError(error: unknown): string {
  const text = String(error ?? "").replace(/^Error:\s*/i, "").trim();
  if (
    /receiving end does not exist|not injected|could not inject|cannot access contents|could not inject the page|frame was removed|cannot be scripted/i.test(
      text,
    )
  ) {
    return "Content script is not ready on this tab. The extension injects automatically; reload the tab if this persists.";
  }
  return text || "page command failed";
}
