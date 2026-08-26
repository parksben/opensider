import type { BrowserCommand, BrowserCommandArgs, BrowserResult, ClipRect, CurrentPage, PageMethod } from "@shared";

const MAX_TEXT = 200_000;
const SELECTOR_MAX = 300;

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function matchesText(el: Element, text?: string): boolean {
  if (!text) return true;
  return cleanText((el as HTMLElement).innerText ?? "").toLowerCase().includes(text.toLowerCase());
}

function collectCandidates(args: BrowserCommandArgs): HTMLElement[] {
  const selector = args.selector?.trim();
  if (selector) {
    if (selector.length > SELECTOR_MAX) throw new Error("selector is too long");
    return [...document.querySelectorAll(selector)].filter((el) => matchesText(el, args.text)) as HTMLElement[];
  }
  if (args.text) {
    const preferred = document.querySelectorAll(
      "a, button, [role='button'], input, textarea, select, label, summary, [onclick]",
    );
    const hits = [...preferred].filter((el) => matchesText(el, args.text)) as HTMLElement[];
    if (hits.length > 0) return hits;
    return [...document.querySelectorAll("h1, h2, h3, h4, p, li, span, div")]
      .filter((el) => matchesText(el, args.text))
      .slice(0, 40) as HTMLElement[];
  }
  throw new Error("args.selector or args.text is required");
}

export function measureTarget(args: BrowserCommandArgs): ClipRect {
  const el = findElement(args);
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  const box = el.getBoundingClientRect();
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(window.innerWidth, box.x + box.width);
  const bottom = Math.min(window.innerHeight, box.y + box.height);
  const width = right - left;
  const height = bottom - top;
  if (width < 2 || height < 2) {
    throw new Error("element is not visible in the viewport");
  }
  return {
    x: left,
    y: top,
    width,
    height,
    dpr: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

export function measureViewport(): ClipRect {
  return {
    x: 0,
    y: 0,
    width: window.innerWidth,
    height: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  };
}

function findElement(args: BrowserCommandArgs): HTMLElement {
  const list = collectCandidates(args);
  const index = args.nth ?? 0;
  const el = list[index];
  if (!el) {
    throw new Error(`no matching element (matches=${list.length}, nth=${index})`);
  }
  return el;
}

function describe(el: HTMLElement): Record<string, string | undefined> {
  const href = el instanceof HTMLAnchorElement ? el.href : el.getAttribute("href") ?? undefined;
  return {
    tag: el.tagName.toLowerCase(),
    text: cleanText(el.innerText ?? "").slice(0, 160),
    href,
    name: el.getAttribute("name") ?? undefined,
    type: el.getAttribute("type") ?? undefined,
    id: el.id || undefined,
  };
}

function highlight(el: HTMLElement): void {
  const previous = el.style.outline;
  el.style.outline = "2px solid #d4a054";
  window.setTimeout(() => {
    el.style.outline = previous;
  }, 700);
}

function mouse(el: HTMLElement, type: string): void {
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      composed: true,
    }),
  );
}

function clickElement(el: HTMLElement): void {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  if ("focus" in el) el.focus();
  mouse(el, "pointerdown");
  mouse(el, "mousedown");
  mouse(el, "pointerup");
  mouse(el, "mouseup");
  el.click();
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: value, inputType: "insertText" }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillElement(el: HTMLElement, value: string, append: boolean): void {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  highlight(el);
  el.focus();
  if (el instanceof HTMLSelectElement) {
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const next = append ? `${el.value}${value}` : value;
    setNativeValue(el, next);
    return;
  }
  if (el.isContentEditable) {
    if (!append) el.textContent = "";
    el.textContent = `${el.textContent ?? ""}${value}`;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
    return;
  }
  throw new Error("element is not fillable");
}

function pressKey(el: HTMLElement, key: string): void {
  const opts = { key, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keypress", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
  if (key === "Enter" && el instanceof HTMLFormElement) {
    el.requestSubmit();
  }
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

export async function runPageMethod(command: BrowserCommand): Promise<BrowserResult> {
  try {
    const data = await invoke(command.method, command.args ?? {});
    return { id: command.id, ok: true, method: command.method, data };
  } catch (error) {
    return { id: command.id, ok: false, method: command.method, error: String(error) };
  }
}

async function invoke(method: PageMethod, args: BrowserCommandArgs): Promise<unknown> {
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
      return { text: clip(cleanText(findElement(args).innerText ?? "")) };
    case "queryAll": {
      const all = collectCandidates(args);
      return { count: all.length, elements: all.slice(0, 30).map(describe) };
    }
    case "getAttribute":
      if (!args.attribute) throw new Error("getAttribute requires args.attribute");
      return { value: findElement(args).getAttribute(args.attribute) };
    case "getValue": {
      const el = findElement(args);
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        return { value: el.value };
      }
      return { value: cleanText(el.innerText ?? "") };
    }
    case "exists": {
      const all = collectCandidates(args);
      return { found: all.length > 0, count: all.length };
    }
    case "click": {
      const el = findElement(args);
      clickElement(el);
      return { clicked: describe(el) };
    }
    case "dblclick": {
      const el = findElement(args);
      clickElement(el);
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      return { clicked: describe(el) };
    }
    case "hover": {
      const el = findElement(args);
      el.scrollIntoView({ block: "center", inline: "nearest" });
      highlight(el);
      mouse(el, "pointerover");
      mouse(el, "mouseover");
      mouse(el, "mouseenter");
      return { hovered: describe(el) };
    }
    case "focus": {
      const el = findElement(args);
      el.scrollIntoView({ block: "center", inline: "nearest" });
      el.focus();
      return { focused: describe(el) };
    }
    case "fill":
      if (args.value == null && args.text == null) throw new Error("fill requires args.value");
      fillElement(findElement(args), args.value ?? args.text ?? "", false);
      return { filled: true };
    case "type":
      if (args.text == null && args.value == null) throw new Error("type requires args.text");
      fillElement(findElement(args), args.text ?? args.value ?? "", true);
      return { typed: true };
    case "clear":
      fillElement(findElement(args), "", false);
      return { cleared: true };
    case "select": {
      const el = findElement(args);
      if (!(el instanceof HTMLSelectElement)) throw new Error("select requires a <select>");
      if (args.value == null) throw new Error("select requires args.value");
      fillElement(el, args.value, false);
      return { selected: el.value };
    }
    case "check": {
      const el = findElement(args);
      if (!(el instanceof HTMLInputElement) || (el.type !== "checkbox" && el.type !== "radio")) {
        throw new Error("check requires a checkbox or radio");
      }
      const next = args.checked ?? true;
      if (el.checked !== next) clickElement(el);
      return { checked: el.checked };
    }
    case "press": {
      const key = args.key;
      if (!key) throw new Error("press requires args.key");
      const el = args.selector || args.text ? findElement(args) : (document.activeElement as HTMLElement | null);
      if (!el) throw new Error("nothing is focused");
      pressKey(el, key);
      return { key };
    }
    case "scroll":
      if (args.selector || args.text) {
        findElement(args).scrollIntoView({ block: "center", inline: "nearest" });
        return { scrolled: "element" };
      }
      window.scrollBy(args.x ?? 0, args.y ?? 600);
      return { scrolled: "window", x: args.x ?? 0, y: args.y ?? 600 };
    case "scrollIntoView":
      findElement(args).scrollIntoView({ block: "center", inline: "nearest" });
      return { scrolled: "element" };
    case "waitFor": {
      const timeout = Math.min(Math.max(args.timeoutMs ?? 8000, 200), 20_000);
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (collectCandidates(args).length > 0) {
          return { found: true, elapsedMs: Date.now() - start };
        }
        await sleep(150);
      }
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    case "navigate":
    case "goBack":
    case "goForward":
    case "reload":
    case "screenshot":
    case "screenshotElement":
    case "listTabs":
    case "switchTab":
    case "openTab":
    case "moveTabsToWindow":
      throw new Error(`${method} is handled by the extension service worker`);
    default:
      throw new Error(`unknown method ${method}`);
  }
}
