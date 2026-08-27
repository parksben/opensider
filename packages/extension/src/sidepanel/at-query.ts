/** Read inline @-mention search text immediately before the caret. */
export function readAtQuery(range: Range): string | null {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const at = before.lastIndexOf("@");
  if (at < 0 || offset <= at) return null;
  const query = before.slice(at + 1);
  if (query.includes("\n")) return null;
  return query;
}

/** Remove `@` and any inline search text before the caret. */
export function consumeAtBeforeCaret(range: Range): void {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const at = before.lastIndexOf("@");
  if (at < 0 || offset <= at) return;
  range.setStart(node, at);
  range.deleteContents();
}
