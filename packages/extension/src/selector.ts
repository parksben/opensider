function safeCount(selector: string): number {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
}

function attrSelector(tag: string, name: string, value: string): string {
  return `${tag}[${name}=${JSON.stringify(value)}]`;
}

export function uniqueCssSelector(el: Element): string {
  if (el.id && safeCount(`#${CSS.escape(el.id)}`) === 1) {
    return `#${CSS.escape(el.id)}`;
  }

  const tag = el.tagName.toLowerCase();
  const testid = el.getAttribute("data-testid");
  if (testid && safeCount(attrSelector(tag, "data-testid", testid)) === 1) {
    return attrSelector(tag, "data-testid", testid);
  }
  const name = el.getAttribute("name");
  if (name && safeCount(attrSelector(tag, "name", name)) === 1) {
    return attrSelector(tag, "name", name);
  }

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === Node.ELEMENT_NODE) {
    const nodeTag = node.tagName.toLowerCase();
    if (node.id && safeCount(`#${CSS.escape(node.id)}`) === 1) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const parent = node.parentElement;
    if (!parent) {
      parts.unshift(nodeTag);
      break;
    }
    const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
    const part =
      siblings.length > 1 ? `${nodeTag}:nth-of-type(${siblings.indexOf(node) + 1})` : nodeTag;
    parts.unshift(part);
    node = parent;
    if (nodeTag === "html") break;
  }

  const selector = parts.join(" > ");
  return selector || tag;
}
