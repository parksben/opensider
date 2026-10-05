import { FilePenLine, Globe, LoaderCircle, Search, SquareTerminal, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import type { ToolPart } from "../chat-types";
import type { Locale } from "../i18n";
import { toolLiveHeadline } from "../tool-label";
import { toolFinished } from "../tool-status";
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
 * A tool call is open while **it** is the one running, and closes the moment it finishes —
 * so a chain of steps reads as "one at a time" instead of a pile of cards that all claim
 * to be running at once. The finished ones stay on screen as single lines; the whole run
 * folds into one line when the turn ends.
 *
 * `live` is only the turn's running state, and it is what allows a card to auto-open. The
 * card's own state comes from `toolFinished` rather than `part.status`, which agents
 * frequently never fill in (see `toolFinished`).
 *
 * `pinned` remembers that the user opened a card by hand, so their reading position
 * survives the run and the fold at the end of it. It is reset whenever this card becomes
 * the running one again: a fresh execution starts from the default, open.
 */
export function ToolCard({ locale, part, live }: { locale: Locale; part: ToolPart; live?: boolean }) {
  const Icon = kindIcon[(part.kind as keyof typeof kindIcon) ?? "other"] ?? Wrench;
  const finished = toolFinished(part);
  const running = Boolean(live) && !finished;
  const title = toolLiveHeadline(locale, part);
  const hasArgs = part.args != null && part.args !== "";
  const hasResult = part.result != null && part.result !== "";
  const [pinned, setPinned] = useState(false);

  // This card started running: drop whatever the user pinned and show it open, the way a
  // freshly executed tool should look. Without this, a card the user collapsed stays
  // collapsed while it runs and the stream is invisible.
  useEffect(() => {
    if (running) setPinned(false);
  }, [running]);

  // While the turn is over the card is settled: the user's own choice stands, so opening one
  // by hand keeps it open for reading.
  const open = running || pinned ? true : undefined;
  // Only the card that is running streams its result; the ones before it in the same turn
  // hold still, and yanking them to the bottom would hide their arguments.
  const follow = running;

  return (
    <TextFold
      label={title}
      paneClass="cs-fold-scroll"
      open={open}
      onOpenChange={setPinned}
      follow={follow}
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
