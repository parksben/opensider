import type { BrowserCommand, BrowserCommandArgs, BrowserResult, ClipRect, CurrentPage, FormFieldArg, PageMethod } from "@shared";
import { pointAt } from "./agent-cursor";
import {
  cleanText,
  collectOptions,
  describeElement,
  findElement,
  implicitRole,
  interactiveText,
  locateElements,
  locateField,
  peekInteractive,
  preferFillable,
  refreshInteractive,
} from "./interactive";

const MAX_TEXT = 200_000;

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
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

export function measureTarget(args: BrowserCommandArgs): ClipRect {
  const el = findElement(args);
  el.scrollIntoView({ block: "center", inline: "nearest" });
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

async function prepare(el: HTMLElement, click = false): Promise<Point> {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  return pointAt(el, click);
}

type Point = { x: number; y: number };

async function clickElement(el: HTMLElement): Promise<void> {
  await prepare(el, true);
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const target = hit instanceof HTMLElement && el.contains(hit) ? hit : el;
  const pointerOpts: PointerEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    pointerType: "mouse",
    view: window,
  };
  const mouseOpts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
    view: window,
  };
  target.dispatchEvent(new PointerEvent("pointerover", pointerOpts));
  target.dispatchEvent(new PointerEvent("pointerenter", { ...pointerOpts, bubbles: false }));
  target.dispatchEvent(new MouseEvent("mouseover", mouseOpts));
  target.dispatchEvent(new MouseEvent("mouseenter", { ...mouseOpts, bubbles: false }));
  target.dispatchEvent(new PointerEvent("pointerdown", pointerOpts));
  target.dispatchEvent(new MouseEvent("mousedown", mouseOpts));
  if ("focus" in el) el.focus({ preventScroll: true });
  target.dispatchEvent(new PointerEvent("pointerup", pointerOpts));
  target.dispatchEvent(new MouseEvent("mouseup", mouseOpts));
  target.click();
}

function nativeValueSetter(el: HTMLInputElement | HTMLTextAreaElement): ((value: string) => void) | undefined {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  return Object.getOwnPropertyDescriptor(proto, "value")?.set;
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const tracker = (el as HTMLInputElement & { _valueTracker?: { setValue?: (value: string) => void } })._valueTracker;
  tracker?.setValue?.("");
  const setter = nativeValueSetter(el);
  if (setter) setter.call(el, value);
  else el.value = value;
}

async function fillTextField(el: HTMLInputElement | HTMLTextAreaElement, value: string, append: boolean): Promise<void> {
  await prepare(el, true);
  el.focus({ preventScroll: true });
  const next = append ? `${el.value}${value}` : value;
  el.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: append ? "insertText" : "insertReplacementText",
      data: value,
    }),
  );
  setNativeValue(el, next);
  el.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      composed: true,
      data: value,
      inputType: append ? "insertText" : "insertReplacementText",
    }),
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function fillContentEditable(el: HTMLElement, value: string, append: boolean): Promise<void> {
  await prepare(el, true);
  el.focus({ preventScroll: true });
  const next = append ? `${el.innerText ?? ""}${value}` : value;
  const allowed = el.dispatchEvent(
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      inputType: append ? "insertText" : "insertReplacementText",
      data: value,
    }),
  );
  if (allowed) {
    el.innerText = next;
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        composed: true,
        inputType: append ? "insertText" : "insertReplacementText",
        data: value,
      }),
    );
  }
  if (!append && cleanText(el.innerText ?? "") !== cleanText(value)) {
    const doc = el.ownerDocument;
    const selection = doc.getSelection();
    const range = doc.createRange();
    range.selectNodeContents(el);
    selection?.removeAllRanges();
    selection?.addRange(range);
    doc.execCommand("insertText", false, value);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

async function selectByValueOrText(el: HTMLSelectElement, value: string): Promise<void> {
  const exact = [...el.options].find((opt) => opt.value === value);
  const byText = [...el.options].find((opt) => cleanText(opt.text).toLowerCase() === value.trim().toLowerCase());
  const contains = [...el.options].find((opt) => cleanText(opt.text).toLowerCase().includes(value.trim().toLowerCase()));
  const option = exact ?? byText ?? contains;
  if (!option) {
    const shown = [...el.options]
      .slice(0, 12)
      .map((opt) => opt.text.trim() || opt.value)
      .filter(Boolean)
      .join(", ");
    throw new Error(`no <option> matching ${JSON.stringify(value)}${shown ? ` (have: ${shown})` : ""}`);
  }
  await prepare(el, true);
  el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function findVisibleOption(value: string, scope: ParentNode = document): HTMLElement | undefined {
  const needle = value.trim().toLowerCase();
  if (!needle) return undefined;
  const nodes = [
    ...scope.querySelectorAll("[role=option], [role=menuitem], [role=treeitem], li[role], [data-value]"),
  ];
  const visible = nodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
  return (
    visible.find((node) => cleanText(node.innerText).toLowerCase() === needle) ??
    visible.find((node) => cleanText(node.innerText).toLowerCase().includes(needle))
  );
}

async function fillCombobox(el: HTMLElement, value: string): Promise<void> {
  await clickElement(el);
  await sleep(180);
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    await fillTextField(active, value, false);
    await sleep(120);
  } else if (active instanceof HTMLElement && active.isContentEditable) {
    await fillContentEditable(active, value, false);
    await sleep(120);
  }
  const option =
    findVisibleOption(value, el.ownerDocument) ??
    findVisibleOption(value) ??
    findVisibleOption(value, el.parentElement ?? el);
  if (option) {
    await clickElement(option);
    await sleep(80);
    return;
  }
  if (active instanceof HTMLElement) {
    pressKey(active, "Enter");
    return;
  }
  throw new Error(`opened the dropdown but found no option matching ${JSON.stringify(value)}`);
}

async function setChecked(el: HTMLElement, next: boolean): Promise<void> {
  const current =
    el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
      ? el.checked
      : el.getAttribute("aria-checked") === "true";
  if (current !== next) {
    await clickElement(el);
    await sleep(50);
  }
}

async function fillWidget(el: HTMLElement, value: string, append: boolean): Promise<void> {
  const target = preferFillable(el);

  if (target instanceof HTMLInputElement && target.type === "file") {
    throw new Error("file inputs cannot be filled from page tools; the user must pick a file");
  }

  const role = implicitRole(target);
  if (role === "checkbox" || role === "switch") {
    await setChecked(target, /^(true|1|yes|on|checked)$/i.test(value));
    return;
  }
  if (role === "radio") {
    if (!/^(false|0|off|unchecked)$/i.test(value)) await clickElement(target);
    return;
  }
  if (target instanceof HTMLSelectElement) {
    await selectByValueOrText(target, value);
    return;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    await fillTextField(target, value, append);
    return;
  }
  if (target.isContentEditable) {
    await fillContentEditable(target, value, append);
    return;
  }
  if (role === "combobox" || role === "listbox" || target.getAttribute("aria-haspopup")) {
    await fillCombobox(target, value);
    return;
  }
  throw new Error(`element is not fillable (role=${role}, tag=${target.tagName.toLowerCase()})`);
}

function pressKey(el: HTMLElement, key: string): void {
  const opts: KeyboardEventInit = { key, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent("keydown", opts));
  el.dispatchEvent(new KeyboardEvent("keypress", opts));
  el.dispatchEvent(new KeyboardEvent("keyup", opts));
  if (key === "Enter" && el instanceof HTMLFormElement) {
    el.requestSubmit();
  }
}

function afterAction() {
  const snap = refreshInteractive();
  return { interactive: snap.text, count: snap.count };
}

export function extractSnapshot(tabId: number): CurrentPage {
  refreshInteractive();
  const meta = getMeta();
  return {
    tabId,
    url: meta.url,
    title: meta.title,
    updatedAt: new Date().toISOString(),
    readable: getReadable(),
    interactive: interactiveText(),
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
    case "getInteractive": {
      const snap = refreshInteractive();
      return { count: snap.count, text: interactiveText(), elements: snap.elements };
    }
    case "getSelection":
      return { text: getSelectionText() };
    case "getLinks":
      return { links: getLinks() };
    case "getOutline":
      return { outline: getOutline() };
    case "queryText":
      return { text: clip(cleanText(findElement(args).innerText ?? "")) };
    case "queryAll": {
      if (args.index == null && !args.selector && !args.text && !args.label && !args.name) {
        const snap = peekInteractive().count ? peekInteractive() : refreshInteractive();
        return { count: snap.count, elements: snap.elements };
      }
      const all = locateElements(args);
      return { count: all.length, elements: all.slice(0, 40).map((el) => describeElement(el)) };
    }
    case "getAttribute":
      if (!args.attribute) throw new Error("getAttribute requires args.attribute");
      return { value: findElement(args).getAttribute(args.attribute) };
    case "getValue": {
      const el = preferFillable(findElement(args));
      return describeElement(el);
    }
    case "exists": {
      const all = locateElements(args);
      return { found: all.length > 0, count: all.length };
    }
    case "click": {
      const el = findElement(args);
      await clickElement(el);
      await sleep(80);
      return { clicked: describeElement(el), ...afterAction() };
    }
    case "dblclick": {
      const el = findElement(args);
      await clickElement(el);
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      await sleep(80);
      return { clicked: describeElement(el), ...afterAction() };
    }
    case "hover": {
      const el = findElement(args);
      const point = await prepare(el, false);
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, view: window };
      el.dispatchEvent(new PointerEvent("pointerover", { ...opts, pointerType: "mouse" }));
      el.dispatchEvent(new MouseEvent("mouseover", opts));
      el.dispatchEvent(new MouseEvent("mouseenter", { ...opts, bubbles: false }));
      return { hovered: describeElement(el) };
    }
    case "focus": {
      const el = findElement(args);
      await prepare(el, false);
      el.focus();
      return { focused: describeElement(el) };
    }
    case "fill": {
      if (args.value == null && args.text == null) throw new Error("fill requires args.value");
      const el = preferFillable(findElement(args));
      await fillWidget(el, args.value ?? args.text ?? "", false);
      return { filled: true, target: describeElement(el), ...afterAction() };
    }
    case "type": {
      if (args.text == null && args.value == null) throw new Error("type requires args.text");
      const el = preferFillable(findElement(args));
      await fillWidget(el, args.text ?? args.value ?? "", true);
      return { typed: true, target: describeElement(el), ...afterAction() };
    }
    case "clear": {
      const el = preferFillable(findElement(args));
      await fillWidget(el, "", false);
      return { cleared: true, target: describeElement(el), ...afterAction() };
    }
    case "fillForm":
      return fillForm(args.fields);
    case "select": {
      if (args.value == null) throw new Error("select requires args.value");
      const el = preferFillable(findElement(args));
      await fillWidget(el, args.value, false);
      return { selected: describeElement(el), options: collectOptions(el), ...afterAction() };
    }
    case "check": {
      const el = preferFillable(findElement(args));
      const role = implicitRole(el);
      if (!["checkbox", "radio", "switch"].includes(role) && !(el instanceof HTMLInputElement)) {
        throw new Error("check requires a checkbox, radio, or switch");
      }
      await setChecked(el, args.checked ?? true);
      return { checked: describeElement(el), ...afterAction() };
    }
    case "press": {
      const key = args.key;
      if (!key) throw new Error("press requires args.key");
      const el =
        args.index != null || args.selector || args.text || args.label
          ? findElement(args)
          : (document.activeElement as HTMLElement | null);
      if (!el) throw new Error("nothing is focused");
      await prepare(el, false);
      pressKey(el, key);
      await sleep(80);
      return { key, ...afterAction() };
    }
    case "scroll":
      if (args.index != null || args.selector || args.text || args.label) {
        await prepare(findElement(args), false);
        return { scrolled: "element" };
      }
      window.scrollBy(args.x ?? 0, args.y ?? 600);
      return { scrolled: "window", x: args.x ?? 0, y: args.y ?? 600 };
    case "scrollIntoView":
      await prepare(findElement(args), false);
      return { scrolled: "element" };
    case "waitFor": {
      const timeout = Math.min(Math.max(args.timeoutMs ?? 8000, 200), 20_000);
      const start = Date.now();
      while (Date.now() - start < timeout) {
        try {
          if (locateElements(args).length > 0) {
            return { found: true, elapsedMs: Date.now() - start };
          }
        } catch {
          // locator may fail until the node exists
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

async function fillForm(fields?: FormFieldArg[]): Promise<unknown> {
  if (!fields?.length) throw new Error("fillForm requires args.fields");
  refreshInteractive();
  const resolved = fields.map((field, i) => {
    try {
      return { field, el: locateField(field), error: undefined as string | undefined };
    } catch (error) {
      return { field, el: undefined as HTMLElement | undefined, error: `fields[${i}]: ${String(error)}` };
    }
  });
  const results: Array<Record<string, unknown>> = [];
  for (const item of resolved) {
    if (!item.el) {
      results.push({ ok: false, error: item.error, field: item.field });
      continue;
    }
    try {
      const value = item.field.value ?? item.field.text ?? "";
      if (item.field.checked != null) await setChecked(item.el, item.field.checked);
      else await fillWidget(item.el, value, false);
      results.push({ ok: true, target: describeElement(item.el) });
    } catch (error) {
      results.push({ ok: false, error: String(error), field: item.field });
    }
  }
  const failed = results.filter((row) => !row.ok).length;
  return {
    filled: results.length - failed,
    failed,
    results,
    ...afterAction(),
  };
}

export { findElement };
