import type { BrowserCommand, BrowserResult, CurrentPage, PageMethod } from "@shared";

const MAX_TEXT = 200_000;

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function getMeta(): Record<string, string> {
  const description =
    document.querySelector('meta[name="description"]')?.getAttribute("content") ??
    document.querySelector('meta[property="og:description"]')?.getAttribute("content") ??
    "";
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "";
  return {
    url: location.href,
    title: document.title,
    description,
    canonical,
  };
}

export function getSelectionText(): string {
  return cleanText(window.getSelection()?.toString() ?? "");
}

export function getLinks(): Array<{ text: string; href: string }> {
  const origin = location.origin;
  const seen = new Set<string>();
  const links: Array<{ text: string; href: string }> = [];
  for (const node of document.querySelectorAll("a[href]")) {
    const anchor = node as HTMLAnchorElement;
    if (anchor.origin !== origin) continue;
    const href = anchor.href;
    if (seen.has(href)) continue;
    seen.add(href);
    const text = cleanText(anchor.innerText).slice(0, 120);
    if (!text) continue;
    links.push({ text, href });
    if (links.length >= 50) break;
  }
  return links;
}

export function getOutline(): Array<{ level: number; text: string }> {
  const outline: Array<{ level: number; text: string }> = [];
  for (const node of document.querySelectorAll("h1, h2, h3")) {
    const text = cleanText((node as HTMLElement).innerText);
    if (!text) continue;
    outline.push({ level: Number(node.tagName.slice(1)), text: text.slice(0, 200) });
    if (outline.length >= 40) break;
  }
  return outline;
}

export function queryText(selector: string): string {
  if (!selector || selector.length > 200) {
    throw new Error("selector is required and must be short");
  }
  const node = document.querySelector(selector);
  if (!node) return "";
  return clip(cleanText((node as HTMLElement).innerText ?? ""));
}

export function getReadable(): string {
  const root =
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector("[role='main']") ??
    document.body;
  const clone = root.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll("script, style, noscript, nav, footer, aside, iframe, svg")) {
    node.remove();
  }
  return clip(cleanText(clone.innerText ?? ""));
}

export function extractSnapshot(tabId: number): CurrentPage {
  const meta = getMeta();
  return {
    tabId,
    url: meta.url,
    title: meta.title,
    updatedAt: new Date().toISOString(),
    readable: getReadable(),
  };
}

export function runPageMethod(command: BrowserCommand): BrowserResult {
  try {
    const data = invoke(command.method, command.args?.selector);
    return { id: command.id, ok: true, method: command.method, data };
  } catch (error) {
    return { id: command.id, ok: false, method: command.method, error: String(error) };
  }
}

function invoke(method: PageMethod, selector?: string): unknown {
  switch (method) {
    case "getMeta":
      return getMeta();
    case "getReadable":
      return { text: getReadable() };
    case "getSelection":
      return { text: getSelectionText() };
    case "getLinks":
      return { links: getLinks() };
    case "getOutline":
      return { outline: getOutline() };
    case "queryText":
      if (!selector) throw new Error("queryText requires args.selector");
      return { text: queryText(selector) };
    default:
      throw new Error(`unknown method ${method}`);
  }
}
