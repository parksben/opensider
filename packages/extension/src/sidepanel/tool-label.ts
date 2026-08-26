import type { ToolPart } from "./chat-types";
import type { Locale, MessageKey } from "./i18n";
import { t } from "./i18n";

const KIND_KEY: Record<string, MessageKey> = {
  read: "toolRead",
  edit: "toolEdit",
  delete: "toolDelete",
  move: "toolMove",
  search: "toolSearch",
  execute: "toolExecute",
  think: "toolThink",
  fetch: "toolFetch",
  other: "toolOther",
};

const TITLE_PREFIXES: Array<[RegExp, MessageKey]> = [
  [/^read(?:ing)?\s+/i, "toolRead"],
  [/^edit(?:ed|ing)?\s+/i, "toolEdit"],
  [/^writ(?:e|ing|ten)\s+/i, "toolEdit"],
  [/^delet(?:e|ed|ing)\s+/i, "toolDelete"],
  [/^mov(?:e|ed|ing)\s+/i, "toolMove"],
  [/^grep(?:\s+for)?\s+/i, "toolSearch"],
  [/^search(?:ed)?(?:\s+for)?\s+/i, "toolSearch"],
  [/^web\s+search\s*/i, "toolSearch"],
  [/^glob\s+/i, "toolSearch"],
  [/^list(?:ed)?(?:\s+directory)?\s*/i, "toolList"],
  [/^ran\s+(?:command\s+)?/i, "toolExecute"],
  [/^run(?:ning)?\s+/i, "toolExecute"],
  [/^shell\s*/i, "toolExecute"],
  [/^execut(?:e|ed|ing)\s+/i, "toolExecute"],
  [/^fetch(?:ed)?\s+/i, "toolFetch"],
  [/^think(?:ing)?\s*/i, "toolThink"],
];

function kindKey(kind?: string): MessageKey | undefined {
  if (!kind) return undefined;
  return KIND_KEY[kind.toLowerCase()];
}

function fromTitle(title: string): { key: MessageKey; detail: string } | undefined {
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  for (const [pattern, key] of TITLE_PREFIXES) {
    const match = pattern.exec(trimmed);
    if (!match) continue;
    return { key, detail: trimmed.slice(match[0].length).trim() };
  }
  const exact = KIND_KEY[trimmed.toLowerCase()];
  if (exact) return { key: exact, detail: "" };
  return undefined;
}

export function toolTitle(locale: Locale, part: ToolPart): string {
  const raw = part.toolName?.trim() ?? "";
  const parsed = fromTitle(raw);
  const key = parsed?.key ?? kindKey(part.kind) ?? "toolOther";
  const label = t(locale, key);
  const detail = parsed?.detail ?? "";
  if (detail) return `${label} ${detail}`;
  if (raw && raw.toLowerCase() !== "tool") return raw;
  return label;
}
