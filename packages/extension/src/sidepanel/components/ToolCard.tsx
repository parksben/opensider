import { FilePenLine, Globe, LoaderCircle, Search, SquareTerminal, Wrench } from "lucide-react";
import type { ToolPart } from "../chat-types";
import type { Locale } from "../i18n";
import { toolLiveHeadline } from "../tool-label";
import { TextFold } from "./TextFold";
import { ToolJsonView } from "./ToolJsonView";

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

export function ToolCard({ locale, part }: { locale: Locale; part: ToolPart }) {
  const Icon = kindIcon[(part.kind as keyof typeof kindIcon) ?? "other"] ?? Wrench;
  const status = part.status ?? "pending";
  const running = status === "pending" || status === "in_progress";
  const title = toolLiveHeadline(locale, part);
  const hasArgs = part.args != null && part.args !== "";
  const hasResult = part.result != null && part.result !== "";

  return (
    <TextFold
      label={title}
      paneClass="cs-fold-scroll"
      icon={
        <span className="inline-flex shrink-0 text-[var(--muted)]">
          {running ? <LoaderCircle size={12} className="animate-spin" /> : <Icon size={12} strokeWidth={1.75} />}
        </span>
      }
    >
      <div className="space-y-2 text-[11px] leading-relaxed text-[var(--muted)]">
        {hasArgs ? <ToolJsonView value={part.args} /> : null}
        {hasResult ? <ToolJsonView value={part.result} /> : null}
      </div>
    </TextFold>
  );
}
