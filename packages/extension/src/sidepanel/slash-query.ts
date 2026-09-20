/**
 * Inline `/` search text before the caret, mirroring `at-query.ts`.
 *
 * One deliberate difference from `@`: a slash only starts a skill probe when it sits at the
 * start of a line or right after whitespace. A path typed inside a sentence
 * (`/usr/local/bin`) must stay a path — popping the skill menu there would be pure noise.
 */
export function readSlashQuery(range: Range): string | null {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const slash = before.lastIndexOf("/");
  if (slash < 0 || offset <= slash) return null;
  if (slash > 0 && !isTriggerSpace(before[slash - 1])) return null;
  const query = before.slice(slash + 1);
  if (query.includes("\n")) return null;
  return query;
}

function isTriggerSpace(ch: string | undefined): boolean {
  return ch === " " || ch === "\t" || ch === "\u00a0" || ch === "\n";
}

/** Remove `/` and any inline search text before the caret: the chip replaces them. */
export function consumeSlashBeforeCaret(range: Range): void {
  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return;
  const text = node.textContent ?? "";
  const offset = range.startOffset;
  const before = text.slice(0, offset);
  const slash = before.lastIndexOf("/");
  if (slash < 0 || offset <= slash) return;
  if (slash > 0 && !isTriggerSpace(before[slash - 1])) return;
  range.setStart(node, slash);
  range.deleteContents();
}
