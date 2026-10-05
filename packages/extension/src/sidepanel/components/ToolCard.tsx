import { FilePenLine, Globe, LoaderCircle, Search, SquareTerminal, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
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

/**
 * A tool call stays expanded for as long as the **turn** it belongs to is running, so a
 * long chain of reads / edits / commands reads top to bottom instead of each one closing
 * the moment its own result lands (which used to shrink the bubble a step at a time and
 * drag whatever the user was reading around).
 *
 * When the turn ends, every card collapses — the same fold the rest of the process lands
 * in, one line about how long it took. `pinned` keeps a card open afterwards when the
 * user expanded it themselves: they clearly want to follow this one, and snapping it
 * shut throws away what they asked for.
 *
 * `live` is the turn's running state, not the card's own: a card that finished mid-turn
 * has to stay open, otherwise the transcript collapses underneath the user while the
 * agent is still working.
 */
export function ToolCard({ locale, part, live }: { locale: Locale; part: ToolPart; live?: boolean }) {
  const Icon = kindIcon[(part.kind as keyof typeof kindIcon) ?? "other"] ?? Wrench;
  const status = part.status ?? "pending";
  const running = status === "pending" || status === "in_progress";
  const title = toolLiveHeadline(locale, part);
  const hasArgs = part.args != null && part.args !== "";
  const hasResult = part.result != null && part.result !== "";
  const [pinned, setPinned] = useState(false);

  // The turn just ended: drop whatever the run forced open, back to the user's own choice.
  // Running one turn must not decide how the next one behaves.
  useEffect(() => {
    if (!live) setPinned(false);
  }, [live]);

  // Follow the stream while the turn runs: the result of a card that is still running is
  // appended to as it comes in, and the user should be able to read it without scrolling.
  // A card that finished earlier in the same turn holds still (it is not streaming any
  // more, and jumping it to the bottom would hide its arguments).
  const streaming = Boolean(live && running);

  return (
    <TextFold
      label={title}
      paneClass="cs-fold-scroll"
      open={live || pinned ? true : undefined}
      onOpenChange={setPinned}
      follow={streaming}
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
