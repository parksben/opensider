import { FilePenLine, Globe, LoaderCircle, Search, SquareTerminal, Wrench } from "lucide-react";
import type { ToolPart } from "../chat-types";
import type { Locale } from "../i18n";
import { toolTitle } from "../tool-label";
import { TextFold } from "./TextFold";

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
  const running = status === "pending" || status === "in_progress";

  return (
    <TextFold
      label={title}
      paneClass="cs-fold-scroll"
      icon={
        <span className="inline-flex shrink-0 items-center gap-1 text-[var(--muted)]">
          <Icon size={12} strokeWidth={1.75} />
          {running ? <LoaderCircle size={12} className="animate-spin" /> : null}
        </span>
      }
    >
      <div className="space-y-2 text-[11px] leading-relaxed text-[var(--muted)]">
        {args ? <pre className="whitespace-pre-wrap font-mono">{args}</pre> : null}
        {result ? <pre className="whitespace-pre-wrap font-mono">{result}</pre> : null}
      </div>
    </TextFold>
  );
}
