export type LinkPage = {
  tabId: number;
  url: string;
};

function pageHost(url: string): string | undefined {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return undefined;
  }
}

export function samePageDomain(href: string, pageUrl?: string): boolean {
  if (!pageUrl) return false;
  const left = pageHost(href);
  const right = pageHost(pageUrl);
  return Boolean(left && right && left === right);
}

export function resolveHttpUrl(href: string, pageUrl?: string): string | undefined {
  try {
    const url = new URL(href, pageUrl || undefined);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

export async function openAgentLink(href: string, page?: LinkPage, forceNewTab = false): Promise<void> {
  const target = resolveHttpUrl(href, page?.url);
  if (!target) return;
  if (!forceNewTab && page?.tabId && samePageDomain(target, page.url)) {
    try {
      await chrome.tabs.update(page.tabId, { url: target, active: true });
      return;
    } catch {
      // tab may be gone
    }
  }
  await chrome.tabs.create({ url: target, active: true });
}
