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
 * "Running" is answered two ways, because no single one is trustworthy:
 *   - `toolFinished`: it has a result (an agent cannot produce one before the tool returns).
 *   - `superseded`: a later tool call was already announced after it. ACP runs tools one at
 *     a time, so that proves this one returned — which is what catches a tool that produced
 *     no output at all (no result, no status, but it did finish).
 *
 * `live` is only the turn's running state, and it is what allows a card to auto-open at
 * all. `override` is the reader's own answer, and it outranks the default: a card that
 * opened itself because it is running can still be closed, and stays closed as the stream
 * keeps landing in it. It is reset whenever this card becomes the running one again, so a
 * fresh execution starts from the default, open.
 */
export function ToolCard({
  locale,
  part,
  live,
  superseded,
}: {
  locale: Locale;
  part: ToolPart;
  live?: boolean;
  superseded?: boolean;
}) {
  const Icon = kindIcon[(part.kind as keyof typeof kindIcon) ?? "other"] ?? Wrench;
  const finished = toolFinished(part);
  const running = Boolean(live) && !finished && !superseded;
  const title = toolLiveHeadline(locale, part);
  const hasArgs = part.args != null && part.args !== "";
  const hasResult = part.result != null && part.result !== "";
  const [override, setOverride] = useState<boolean | null>(null);

  // This card started running: drop whatever the user chose last time and show it open,
  // the way a freshly executed tool should look. Without this, a card the user collapsed
  // stays collapsed while it runs and the stream is invisible.
  useEffect(() => {
    if (running) setOverride(null);
  }, [running]);

  // While the turn runs the card is only ever rendered while it is the newest step, and it
  // opens itself so its stream is visible — unless the reader closed it, in which case
  // that wins (`override`). When the run is over the fold owns the state instead.
  const open = override ?? (live ? true : undefined);
  // Only the card that is running streams its result; the ones before it in the same turn
  // hold still, and yanking them to the bottom would hide their arguments.
  const follow = running;

  return (
    <TextFold
      label={title}
      paneClass="cs-fold-scroll"
      open={open}
      onOpenChange={setOverride}
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
