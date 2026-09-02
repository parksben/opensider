export const PAGE_PICK_API = "__opensiderPage";
export const PICK_ARM_MS = 200;

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
