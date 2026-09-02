const PANEL_SAFE = /^(https:|data:|blob:|file:)/i;

export type FaviconGetURL = (path: string) => string;

function defaultGetURL(): FaviconGetURL | undefined {
  return typeof chrome !== "undefined" ? chrome.runtime?.getURL : undefined;
}

/** Side-panel CSP allows self / data / blob / file / https — not chrome: or http. */
export function isPanelSafeImageUrl(url: string): boolean {
  return PANEL_SAFE.test(url);
}

/** MV3 Favicon API. Requires the `favicon` permission; URL is chrome-extension:// (img-src 'self'). */
export function chromeFaviconUrl(
  pageUrl: string,
  size = 32,
  getURL: FaviconGetURL | undefined = defaultGetURL(),
): string | undefined {
  if (!pageUrl || !getURL) return undefined;
  try {
    const url = new URL(getURL("/_favicon/"));
    url.searchParams.set("pageUrl", pageUrl);
    url.searchParams.set("size", String(size));
    return url.toString();
  } catch {
    return undefined;
  }
}

/** Prefer a CSP-safe chrome.tabs.favIconUrl; otherwise the official _favicon URL for the page. */
export function tabFaviconCandidates(
  pageUrl?: string,
  favIconUrl?: string,
  getURL: FaviconGetURL | undefined = defaultGetURL(),
): string[] {
  const out: string[] = [];
  if (favIconUrl && isPanelSafeImageUrl(favIconUrl)) out.push(favIconUrl);
  const api = pageUrl ? chromeFaviconUrl(pageUrl, 32, getURL) : undefined;
  if (api && !out.includes(api)) out.push(api);
  return out;
}
