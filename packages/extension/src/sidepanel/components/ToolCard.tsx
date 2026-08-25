import {
  Check,
  CircleAlert,
  FilePenLine,
  Globe,
  LoaderCircle,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { ToolPart } from "../chat-types";
import type { Locale } from "../i18n";
import { toolTitle } from "../tool-label";

const kindIcon = {
  read: Search,
  edit: FilePenLine,
  delete: FilePenLine,
  move: FilePenLine,
  search: Search,
  execute: SquareTerminal,
  think: Wrench,
  fetch: Globe,
  other: Wrench,
} as const;

function preview(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolCard({ locale, part }: { locale: Locale; part: ToolPart }) {
  const Icon = kindIcon[(part.kind as keyof typeof kindIcon) ?? "other"] ?? Wrench;
  const status = part.status ?? "pending";
  const result = preview(part.result);
  const args = preview(part.args);
  const title = toolTitle(locale, part);

  return (
    <details className="my-2 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--code)]">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <Icon size={14} strokeWidth={1.75} className="shrink-0 text-[var(--brass)]" />
        <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--text)]" title={part.toolName}>
          {title}
        </span>
        <StatusGlyph status={status} />
      </summary>
      <div className="space-y-2 border-t border-[var(--line)] px-3 py-2">
        {args ? (
          <pre className="max-h-40 overflow-auto font-mono text-[11px] leading-relaxed text-[var(--muted)]">
            {args}
          </pre>
        ) : null}
        {result ? (
          <pre className="max-h-56 overflow-auto font-mono text-[11px] leading-relaxed text-[var(--text)]">
            {result}
          </pre>
        ) : null}
      </div>
    </details>
  );
}

function StatusGlyph({ status }: { status: string }) {
  if (status === "completed") {
    return <Check size={13} className="text-[var(--ok)]" />;
  }
  if (status === "failed") {
    return <CircleAlert size={13} className="text-[var(--bad)]" />;
  }
  return <LoaderCircle size={13} className="animate-spin text-[var(--brass)]" />;
}
