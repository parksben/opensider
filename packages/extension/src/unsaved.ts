export type UnsavedField = {
  tag: string;
  type?: string;
  name?: string;
  label?: string;
  reason: string;
};

export type UnsavedChanges = {
  dirty: boolean;
  reasons: string[];
  fields: UnsavedField[];
  beforeunload: boolean;
};

const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "file"]);

function fieldLabel(el: Element): string | undefined {
  if (el instanceof HTMLElement) {
    const aria = el.getAttribute("aria-label")?.trim();
    if (aria) return aria.slice(0, 80);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    if (el.id) {
      const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      const text = lab?.textContent?.trim();
      if (text) return text.slice(0, 80);
    }
    const wrapping = el.closest("label")?.textContent?.trim();
    if (wrapping) return wrapping.slice(0, 80);
    const placeholder = "placeholder" in el ? String(el.placeholder || "").trim() : "";
    if (placeholder) return placeholder.slice(0, 80);
    if (el.name) return el.name.slice(0, 80);
  }
  return undefined;
}

function selectChanged(el: HTMLSelectElement): boolean {
  const options = Array.from(el.options);
  if (options.length === 0) return false;
  return options.some((opt) => opt.selected !== opt.defaultSelected);
}

function inputChanged(el: HTMLInputElement): boolean {
  const type = (el.type || "text").toLowerCase();
  if (SKIP_INPUT_TYPES.has(type)) return false;
  if (type === "checkbox" || type === "radio") return el.checked !== el.defaultChecked;
  return el.value !== el.defaultValue;
}

function pushField(fields: UnsavedField[], el: Element, reason: string): void {
  const tag = el.tagName.toLowerCase();
  const type =
    el instanceof HTMLInputElement
      ? el.type
      : el instanceof HTMLSelectElement
        ? "select"
        : el instanceof HTMLTextAreaElement
          ? "textarea"
          : el.getAttribute("contenteditable") != null
            ? "contenteditable"
            : undefined;
  const name =
    el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement
      ? el.name || undefined
      : el.getAttribute("name") || undefined;
  fields.push({
    tag,
    type,
    name,
    label: fieldLabel(el),
    reason,
  });
}

/** Best-effort probe for user-edited, unsubmitted page content. */
export function getUnsavedChanges(): UnsavedChanges {
  const fields: UnsavedField[] = [];
  const reasons = new Set<string>();

  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (!(el instanceof HTMLElement) || el.closest("[data-opensider-ignore]")) continue;
    if (el instanceof HTMLInputElement) {
      if (!inputChanged(el)) continue;
      pushField(fields, el, "value differs from page default");
      reasons.add("form field edited");
      continue;
    }
    if (el instanceof HTMLTextAreaElement) {
      if (el.value === el.defaultValue) continue;
      pushField(fields, el, "value differs from page default");
      reasons.add("form field edited");
      continue;
    }
    if (el instanceof HTMLSelectElement) {
      if (!selectChanged(el)) continue;
      pushField(fields, el, "selection differs from page default");
      reasons.add("form field edited");
    }
  }

  for (const el of document.querySelectorAll("[contenteditable=''], [contenteditable=true]")) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.closest("[data-opensider-ignore], #opensider-agent-cursor")) continue;
    const text = (el.innerText || "").trim();
    if (!text) continue;
    // Heuristic: treat non-empty editors as potentially dirty (many SPAs never set defaultValue).
    pushField(fields, el, "contenteditable has text");
    reasons.add("contenteditable content present");
  }

  const beforeunload = typeof window.onbeforeunload === "function";
  if (beforeunload) reasons.add("page registered beforeunload");

  const list = [...reasons];
  return {
    dirty: list.length > 0,
    reasons: list,
    fields: fields.slice(0, 40),
    beforeunload,
  };
}
