import type { BrowserCommandArgs, FormFieldArg } from "@shared";
import { uniqueCssSelector } from "./selector";

const MAX_ITEMS = 250;
const MAX_TEXT = 80_000;
const OPTION_CAP = 8;

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input:not([type=hidden])",
  "textarea",
  "select",
  "summary",
  "[contenteditable]",
  "[contenteditable=true]",
  "[role=button]",
  "[role=link]",
  "[role=textbox]",
  "[role=searchbox]",
  "[role=combobox]",
  "[role=listbox]",
  "[role=option]",
  "[role=checkbox]",
  "[role=radio]",
  "[role=switch]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=menuitemcheckbox]",
  "[role=menuitemradio]",
  "[role=slider]",
  "[role=spinbutton]",
  "[role=treeitem]",
  "[aria-haspopup]",
].join(",");

const WIDGET_CLASS = /\b(ant-select|el-select|el-input|n-select|n-input|arco-select|arco-input|semi-select|chakra-select|MuiSelect|MuiInput|SelectTrigger|combobox)\b/i;

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "listbox",
  "option",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "slider",
  "spinbutton",
  "treeitem",
]);

export type InteractivePublic = {
  index: number;
  role: string;
  tag: string;
  label: string;
  name?: string;
  type?: string;
  value?: string;
  placeholder?: string;
  checked?: boolean;
  disabled?: boolean;
  required?: boolean;
  expanded?: boolean;
  inViewport: boolean;
  options?: string[];
  selector?: string;
};

type InteractiveItem = InteractivePublic & { el: HTMLElement };

export type InteractiveSnapshot = {
  count: number;
  text: string;
  elements: InteractivePublic[];
};

let indexed: InteractiveItem[] = [];

function clip(text: string, max = MAX_TEXT): string {
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

export function cleanText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function short(value: string | null | undefined, max = 80): string | undefined {
  if (!value) return undefined;
  const text = cleanText(value).replace(/\s+/g, " ");
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function rootsFrom(root: Document | ShadowRoot): Array<Document | ShadowRoot> {
  const out: Array<Document | ShadowRoot> = [root];
  for (const node of root.querySelectorAll("*")) {
    if (node.shadowRoot) out.push(...rootsFrom(node.shadowRoot));
  }
  return out;
}

function walkRoots(doc: Document): Array<Document | ShadowRoot> {
  const out = rootsFrom(doc);
  for (const frame of doc.querySelectorAll("iframe")) {
    try {
      const child = frame.contentDocument;
      if (child) out.push(...walkRoots(child));
    } catch {
      // cross-origin
    }
  }
  return out;
}

function isDisplayed(el: HTMLElement): boolean {
  if (el.closest("[hidden], [inert]")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.opacity === "0" && !(el instanceof HTMLInputElement)) return false;
  const box = el.getBoundingClientRect();
  if (box.width < 2 && box.height < 2) return false;
  if (el.getClientRects().length === 0) return false;
  return true;
}

function isFullPageCatcher(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  if (tag !== "div" && tag !== "span") return false;
  if (el.getAttribute("role")) return false;
  const box = el.getBoundingClientRect();
  return box.width > window.innerWidth * 0.9 && box.height > window.innerHeight * 0.9;
}

export function implicitRole(el: HTMLElement): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  if (el instanceof HTMLInputElement) {
    const type = (el.type || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (type === "submit" || type === "button" || type === "reset" || type === "image") return "button";
    if (type === "file") return "button";
    return "textbox";
  }
  if (el instanceof HTMLTextAreaElement) return "textbox";
  if (el instanceof HTMLSelectElement) return "combobox";
  if (el instanceof HTMLAnchorElement) return "link";
  if (el instanceof HTMLButtonElement || el.tagName === "SUMMARY") return "button";
  if (el.isContentEditable) return "textbox";
  return el.tagName.toLowerCase();
}

function labeledControl(el: HTMLElement): HTMLElement | undefined {
  if (el instanceof HTMLLabelElement) {
    const control = el.control;
    if (control instanceof HTMLElement) return control;
  }
  const id = el.getAttribute("for");
  if (id) {
    const found = el.ownerDocument.getElementById(id);
    if (found instanceof HTMLElement) return found;
  }
  return undefined;
}

function labelFromFor(el: HTMLElement): string | undefined {
  if (!el.id) return undefined;
  const label = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
  return label instanceof HTMLElement ? short(label.innerText) : undefined;
}

function wrappingLabel(el: HTMLElement): string | undefined {
  const label = el.closest("label");
  if (!(label instanceof HTMLElement) || label === el) return undefined;
  const clone = label.cloneNode(true) as HTMLElement;
  for (const nested of clone.querySelectorAll("input, textarea, select, button")) nested.remove();
  return short(clone.innerText);
}

function labelledBy(el: HTMLElement): string | undefined {
  const ids = el.getAttribute("aria-labelledby");
  if (!ids) return undefined;
  const parts = ids
    .split(/\s+/)
    .map((id) => el.ownerDocument.getElementById(id))
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => cleanText(node.innerText))
    .filter(Boolean);
  return short(parts.join(" "));
}

export function controlLabel(el: HTMLElement): string {
  return (
    short(el.getAttribute("aria-label")) ??
    labelledBy(el) ??
    labelFromFor(el) ??
    wrappingLabel(el) ??
    short(el.getAttribute("placeholder")) ??
    short(el.getAttribute("title")) ??
    short(el.getAttribute("alt")) ??
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? short(el.getAttribute("name") ?? el.id)
      : undefined) ??
    short(visibleOwnText(el), 60) ??
    ""
  );
}

function visibleOwnText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return "";
  }
  const clone = el.cloneNode(true) as HTMLElement;
  for (const nested of clone.querySelectorAll("script, style, noscript, svg")) nested.remove();
  return cleanText(clone.innerText ?? "");
}

function currentValue(el: HTMLElement): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === "checkbox" || el.type === "radio") return undefined;
    if (el.type === "password" && el.value) return "••••";
    return short(el.value, 120);
  }
  if (el instanceof HTMLTextAreaElement) return short(el.value, 120);
  if (el instanceof HTMLSelectElement) {
    const option = el.selectedOptions[0];
    return short(option?.text ?? el.value, 120);
  }
  if (el.isContentEditable) return short(el.innerText, 120);
  return short(el.getAttribute("aria-valuetext") ?? el.getAttribute("value"), 120);
}

function isChecked(el: HTMLElement): boolean | undefined {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return el.checked;
  const aria = el.getAttribute("aria-checked");
  if (aria === "true") return true;
  if (aria === "false") return false;
  return undefined;
}

function isDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) {
    return el.disabled;
  }
  return el.getAttribute("aria-disabled") === "true" || el.hasAttribute("disabled");
}

export function collectOptions(el: HTMLElement): string[] | undefined {
  if (el instanceof HTMLSelectElement) {
    const texts = [...el.options].map((opt) => cleanText(opt.text)).filter(Boolean);
    return texts.length ? texts.slice(0, OPTION_CAP) : undefined;
  }
  const listId = el.getAttribute("aria-controls") ?? el.getAttribute("aria-owns");
  const list = listId ? el.ownerDocument.getElementById(listId) : null;
  const root = list ?? el;
  const options = [...root.querySelectorAll("[role=option], option")].map((node) =>
    cleanText((node as HTMLElement).innerText),
  );
  const unique = [...new Set(options.filter(Boolean))];
  return unique.length ? unique.slice(0, OPTION_CAP) : undefined;
}

function inViewport(el: HTMLElement): boolean {
  const box = el.getBoundingClientRect();
  return box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
}

function safeSelector(el: HTMLElement): string | undefined {
  try {
    const selector = uniqueCssSelector(el);
    return selector.length > 240 ? undefined : selector;
  } catch {
    return undefined;
  }
}

function toPublic(item: InteractiveItem): InteractivePublic {
  const { el: _el, ...pub } = item;
  return pub;
}

function buildItem(el: HTMLElement, index: number): InteractiveItem {
  const checked = isChecked(el);
  const value = currentValue(el);
  const placeholder = short(el.getAttribute("placeholder"));
  const name = short(el.getAttribute("name") ?? undefined, 60);
  const type = el instanceof HTMLInputElement ? el.type : undefined;
  const expanded = el.getAttribute("aria-expanded");
  const required =
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.required
      : el.getAttribute("aria-required") === "true") || undefined;
  return {
    index,
    el,
    role: implicitRole(el),
    tag: el.tagName.toLowerCase(),
    label: controlLabel(el),
    name,
    type,
    value,
    placeholder,
    checked,
    disabled: isDisabled(el) || undefined,
    required: required || undefined,
    expanded: expanded === "true" ? true : expanded === "false" ? false : undefined,
    inViewport: inViewport(el),
    options: collectOptions(el),
    selector: safeSelector(el),
  };
}

function isSemanticControl(el: HTMLElement): boolean {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement ||
    el.isContentEditable ||
    INTERACTIVE_ROLES.has(el.getAttribute("role") ?? "")
  );
}

function shouldKeep(el: HTMLElement, all: Set<HTMLElement>): boolean {
  if (!isDisplayed(el) || isFullPageCatcher(el)) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  const control = labeledControl(el);
  if (control && all.has(control)) return false;
  let parent: HTMLElement | null = el.parentElement;
  while (parent) {
    if (all.has(parent) && !isSemanticControl(el)) return false;
    parent = parent.parentElement;
  }
  return true;
}

function queryAllSafe(scope: ParentNode, selector: string): Element[] {
  try {
    return [...scope.querySelectorAll(selector)];
  } catch {
    return [];
  }
}

function gatherCandidates(root: Document): HTMLElement[] {
  const found = new Set<HTMLElement>();
  for (const scope of walkRoots(root)) {
    for (const node of queryAllSafe(scope, INTERACTIVE_SELECTOR)) {
      if (node instanceof HTMLElement) found.add(node);
    }
    for (const node of queryAllSafe(scope, "[class]")) {
      if (node instanceof HTMLElement && WIDGET_CLASS.test(node.className)) found.add(node);
    }
  }
  return [...found];
}

export function collectInteractive(root: Document = document): InteractiveItem[] {
  const raw = gatherCandidates(root);
  const set = new Set(raw);
  const kept = raw.filter((el) => shouldKeep(el, set)).slice(0, MAX_ITEMS);
  return kept.map((el, i) => buildItem(el, i + 1));
}

export function formatInteractiveMarkdown(items: InteractiveItem[] | InteractivePublic[]): string {
  if (items.length === 0) return "_No interactive controls on this page._";
  const lines = items.map((item) => {
    const bits: string[] = [`[${item.index}]`, item.role];
    if (item.label) bits.push(JSON.stringify(item.label));
    if (item.type && item.type !== "text" && item.role === "textbox") bits.push(`type=${item.type}`);
    if (item.name && item.name !== item.label) bits.push(`name=${item.name}`);
    if (item.checked === true) bits.push("checked");
    if (item.checked === false) bits.push("unchecked");
    if (item.value) bits.push(`value=${JSON.stringify(item.value)}`);
    else if (item.role === "textbox" || item.role === "searchbox" || item.role === "combobox") bits.push("empty");
    if (item.placeholder && item.placeholder !== item.label) bits.push(`placeholder=${JSON.stringify(item.placeholder)}`);
    if (item.required) bits.push("required");
    if (item.disabled) bits.push("disabled");
    if (item.expanded === true) bits.push("expanded");
    if (item.expanded === false) bits.push("collapsed");
    if (!item.inViewport) bits.push("offscreen");
    if (item.options?.length) bits.push(`options=${item.options.join(" | ")}`);
    return bits.join(" ");
  });
  const scrolled = Math.round(
    (window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight)) * 100,
  );
  const header = `Viewport ${window.innerWidth}×${window.innerHeight} · page ${document.documentElement.scrollWidth}×${document.documentElement.scrollHeight} · scrolled ${scrolled}% · ${items.length} controls`;
  return clip(`${header}\n\n${lines.join("\n")}`);
}

export function refreshInteractive(): InteractiveSnapshot {
  indexed = collectInteractive();
  return snapshotOf(indexed);
}

export function peekInteractive(): InteractiveSnapshot {
  if (indexed.length === 0) return refreshInteractive();
  return snapshotOf(indexed);
}

function snapshotOf(items: InteractiveItem[]): InteractiveSnapshot {
  return {
    count: items.length,
    text: formatInteractiveMarkdown(items),
    elements: items.map(toPublic),
  };
}

function sameIdentity(a: InteractiveItem, b: InteractiveItem): boolean {
  if (a.el === b.el) return true;
  if (a.selector && a.selector === b.selector) return true;
  return a.role === b.role && Boolean(a.label) && a.label === b.label && a.name === b.name;
}

export function resolveIndex(index: number): HTMLElement {
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("args.index is 1-based (see browser/interactive.md)");
  }
  if (indexed.length === 0) refreshInteractive();
  const item = indexed[index - 1];
  if (!item) {
    throw new Error(`no interactive control at index ${index} (have ${indexed.length}; re-read browser/interactive.md)`);
  }
  if (item.el.isConnected) return item.el;
  const fresh = collectInteractive();
  const match = fresh.find((candidate) => sameIdentity(candidate, item));
  if (match) {
    indexed = fresh;
    return match.el;
  }
  throw new Error(`index ${index} is stale; re-read browser/interactive.md`);
}

function matchesQuery(item: InteractiveItem, query: string): boolean {
  const q = query.toLowerCase();
  return [item.label, item.placeholder, item.name, item.value, item.selector]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(q));
}

export function matchInteractive(query: string, name?: string): HTMLElement[] {
  const items = indexed.length > 0 ? indexed : collectInteractive();
  if (name) {
    const exact = items.filter((item) => item.name?.toLowerCase() === name.toLowerCase());
    if (exact.length) return exact.map((item) => item.el);
  }
  return items.filter((item) => matchesQuery(item, query)).map((item) => item.el);
}

function matchesText(el: Element, text?: string): boolean {
  if (!text) return true;
  const hay = `${controlLabel(el as HTMLElement)} ${cleanText((el as HTMLElement).innerText ?? "")}`.toLowerCase();
  return hay.includes(text.toLowerCase());
}

export function locateElements(args: BrowserCommandArgs): HTMLElement[] {
  if (args.index != null) return [resolveIndex(args.index)];

  const selector = args.selector?.trim();
  if (selector) {
    if (selector.length > 300) throw new Error("selector is too long");
    return [...document.querySelectorAll(selector)].filter((el) => matchesText(el, args.text ?? args.label)) as HTMLElement[];
  }

  if (args.label || args.name) {
    const hits = matchInteractive(args.label ?? args.name ?? "", args.name);
    if (hits.length) return hits;
  }

  if (args.text) {
    const labeled = matchInteractive(args.text);
    if (labeled.length) return labeled;
    const preferred = document.querySelectorAll(
      "a, button, [role='button'], input, textarea, select, label, summary, [onclick], [role='textbox'], [role='combobox']",
    );
    const hits = [...preferred].filter((el) => matchesText(el, args.text)) as HTMLElement[];
    if (hits.length > 0) return hits;
    return [...document.querySelectorAll("h1, h2, h3, h4, p, li, span, div")]
      .filter((el) => matchesText(el, args.text))
      .slice(0, 40) as HTMLElement[];
  }

  throw new Error("args.index, args.selector, args.label, args.name, or args.text is required");
}

export function findElement(args: BrowserCommandArgs): HTMLElement {
  const list = locateElements(args);
  const nth = args.nth ?? 0;
  const el = list[nth];
  if (!el) {
    throw new Error(`no matching element (matches=${list.length}, nth=${nth})`);
  }
  return el;
}

export function preferFillable(el: HTMLElement): HTMLElement {
  if (isFillable(el)) return el;
  const fromLabel = labeledControl(el);
  if (fromLabel && isFillable(fromLabel)) return fromLabel;
  const nested = el.querySelector(
    "input:not([type=hidden]), textarea, select, [contenteditable=''], [contenteditable=true], [role=textbox], [role=combobox]",
  );
  if (nested instanceof HTMLElement) return nested;
  return el;
}

export function isFillable(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement && el.type !== "hidden" && el.type !== "file") return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el.isContentEditable) return true;
  const role = implicitRole(el);
  return ["textbox", "searchbox", "combobox", "listbox", "slider", "spinbutton", "checkbox", "radio", "switch"].includes(
    role,
  );
}

export function describeElement(el: HTMLElement, index?: number): InteractivePublic {
  const found = indexed.find((item) => item.el === el);
  return buildItem(el, index ?? found?.index ?? 0);
}

export function locateField(field: FormFieldArg): HTMLElement {
  return preferFillable(
    findElement({
      index: field.index,
      selector: field.selector,
      text: field.text,
      label: field.label,
      name: field.name,
    }),
  );
}

export function iframeNotes(doc: Document = document): string[] {
  const notes: string[] = [];
  for (const frame of doc.querySelectorAll("iframe")) {
    const src = frame.src || "(no src)";
    try {
      if (frame.contentDocument) notes.push(`iframe ${src} (same-origin, controls indexed)`);
      else notes.push(`iframe ${src} (empty)`);
    } catch {
      notes.push(`iframe ${src} (cross-origin, cannot operate)`);
    }
  }
  return notes;
}

export function interactiveText(): string {
  const snap = peekInteractive();
  const notes = iframeNotes();
  return notes.length ? `${snap.text}\n\n${notes.join("\n")}` : snap.text;
}
