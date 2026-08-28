import type { ChatPart, ToolPart } from "./chat-types";
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
  [/^web\s*fetch(?:ing)?\s*/i, "toolFetch"],
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

export function toolLabel(locale: Locale, part: ToolPart): string {
  const raw = part.toolName?.trim() ?? "";
  const parsed = fromTitle(raw);
  const key = parsed?.key ?? kindKey(part.kind) ?? "toolOther";
  if (key === "toolOther" && raw && raw.toLowerCase() !== "tool") {
    return raw.split(/\s+/)[0] || raw;
  }
  return t(locale, key);
}

const KIND_ARG_KEYS: Record<string, string[]> = {
  fetch: ["url", "uri", "href", "endpoint"],
  read: ["path", "file", "filePath", "file_path", "targetFile", "target_file", "filename"],
  edit: ["path", "file", "filePath", "file_path", "targetFile", "target_file", "filename"],
  delete: ["path", "file", "filePath", "file_path", "targetFile", "filename"],
  move: ["path", "from", "source", "file", "filePath"],
  search: ["query", "pattern", "q", "search", "glob"],
  execute: ["command", "cmd", "script"],
};

const COMMON_ARG_KEYS = [
  "url",
  "uri",
  "href",
  "path",
  "file",
  "filePath",
  "file_path",
  "targetFile",
  "target_file",
  "command",
  "cmd",
  "query",
  "pattern",
  "selector",
  "label",
  "index",
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function derivePrimaryArg(part: ToolPart): string {
  if (typeof part.args === "string" && part.args.trim()) return part.args.trim();
  const record = asRecord(part.args);
  if (!record) return fromTitle(part.toolName?.trim() ?? "")?.detail ?? "";
  const kind = (part.kind ?? "").toLowerCase();
  const fromKind = firstString(record, KIND_ARG_KEYS[kind] ?? []);
  if (fromKind) return fromKind;
  const fromCommon = firstString(record, COMMON_ARG_KEYS);
  if (fromCommon) return fromCommon;
  const locations = record.locations;
  if (Array.isArray(locations)) {
    for (const item of locations) {
      const nested = asRecord(item);
      const found = nested ? firstString(nested, COMMON_ARG_KEYS) : "";
      if (found) return found;
    }
  }
  for (const value of Object.values(record)) {
    if (typeof value === "string" && value.trim()) return value.trim();
    const nested = asRecord(value);
    if (!nested) continue;
    const found = firstString(nested, COMMON_ARG_KEYS);
    if (found) return found;
  }
  return fromTitle(part.toolName?.trim() ?? "")?.detail ?? "";
}

export function toolPrimaryArg(part: ToolPart): string {
  if (part.primaryArg?.trim()) return part.primaryArg.trim();
  return derivePrimaryArg(part);
}

export function withPrimaryArg(part: ToolPart): ToolPart {
  const derived = derivePrimaryArg(part);
  const primary = derived || part.primaryArg?.trim() || "";
  if (!primary || part.primaryArg === primary) return part;
  return { ...part, primaryArg: primary };
}

export function stampToolParts(content: ChatPart[]): ChatPart[] {
  let changed = false;
  const next = content.map((part) => {
    if (part.type !== "tool-call") return part;
    const stamped = withPrimaryArg(part);
    if (stamped !== part) changed = true;
    return stamped;
  });
  return changed ? next : content;
}

export function toolLiveHeadline(locale: Locale, part: ToolPart): string {
  const name = toolLabel(locale, part);
  const primary = toolPrimaryArg(part);
  return primary ? `${name}：${primary}` : name;
}
