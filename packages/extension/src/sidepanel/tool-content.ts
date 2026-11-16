/**
 * Readable tool output.
 *
 * ACP hands a tool's output over in `content`, as a list of content blocks:
 *
 *   [{ type: "content", content: { type: "text", text: "…" } }, …]
 *
 * Passed straight to the card that becomes three levels of shell — `content:` /
 * `type: text` / `text: …` — around what is really one line of terminal output (this is
 * exactly what Hermes sends for every `terminal` / `read` call). So: all-text blocks are
 * joined into one string; the moment a block is anything else (diff, image, resource), the
 * original list is kept, because dropping structure is worse than showing it.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/** `{type:"content", content:X}` is a wrapper; X is what the tool actually produced. */
function unwrapBlock(block: unknown): unknown {
  const record = asRecord(block);
  if (record && record.type === "content" && "content" in record) return record.content;
  return block;
}

function asText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (record?.type === "text" && typeof record.text === "string") return record.text;
  return undefined;
}

export function acpToolOutput(content: unknown): unknown {
  if (!Array.isArray(content) || content.length === 0) return content;
  const texts: string[] = [];
  for (const block of content) {
    const text = asText(unwrapBlock(block));
    if (text === undefined) return content;
    texts.push(text);
  }
  return texts.join("\n");
}
