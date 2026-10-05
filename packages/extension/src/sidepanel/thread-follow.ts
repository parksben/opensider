import { useCallback, useEffect, useRef, type RefObject } from "react";

/** How close to the bottom (px) still counts as "following" the stream. */
export const STICKY_PX = 96;

/**
 * Whether the transcript should still be pinned to its bottom.
 *
 * Read off `scrollTop`, not off geometry: `scrollTop === 0` *is* the bottom in a
 * `column-reverse` box, so "within STICKY_PX of it" is simply `|scrollTop| <= STICKY_PX`.
 *
 * This used to measure the sentinel's `getBoundingClientRect()` against the scrollport's
 * bottom, which was wrong in a specific and painful way. The transcript used to carry a
 * `min-height` taller than its content, which pushed the sentinel far above the scrollport;
 * the moment the user scrolled up by less than that overshoot the sentinel came back into
 * range and the transcript snapped them to the bottom again — a tug-of-war they had to fight
 * through to read anything.
 *
 * `maxScrollUp` is `-(scrollHeight - clientHeight)`, the furthest up the user can go. Being
 * pinned there counts as following too: there is nothing more to show, and no reason to stop
 * them scrolling back down. It is `null` when the caller has no range to report, which must
 * *not* read as "at the end" — an unmeasured limit makes every position look like the end,
 * which is the same snap-back wearing a different hat.
 */
export function threadFollowsBottom(
  scrollTop: number,
  maxScrollUp: number | null = null,
  sticky: number = STICKY_PX,
): boolean {
  if (Math.abs(scrollTop) <= sticky) return true;
  if (maxScrollUp == null || maxScrollUp === 0) return false;
  return scrollTop <= maxScrollUp;
}

/**
 * Follow the bottom while the user is near it. Once they scroll up to read, streaming
 * growth does not move what they are looking at.
 * Returns the function that jumps back to the bottom (send, session switch, the button).
 *
 * Two mechanisms, and it matters which one does what:
 *
 *   - **Holding still while the user reads** is the browser's job, not ours. The transcript
 *     keeps the default `overflow-anchor: auto`, so when content above, below or inside the
 *     viewport changes size — a tool result streaming in, a step folding away — Chromium
 *     adjusts the scroll offset to keep the anchored element exactly where it was. Measured
 *     over a stream-and-fold sequence, the user's message did not move a single pixel with
 *     this on, and moved 140px with it off. That is the whole of "no jitter".
 *     (It was off for a while, with a hand-rolled `scrollTop` compensation in its place,
 *     which measured as doing nothing at all: appends, removals and folds all leave
 *     `scrollTop` alone, so there was never a shift to compensate for.)
 *
 *   - **Following the newest output while the user is at the bottom** is what this hook
 *     does. A `ResizeObserver` on the transcript snaps to the bottom whenever it grows and
 *     the user is inside the sticky band. Scrolling up on wheel or touch releases the
 *     follow, so reading is never interrupted.
 */
export function useThreadFollow(
  listRef: RefObject<HTMLElement | null>,
  endRef: RefObject<HTMLElement | null>,
  sessionId: string,
  active: boolean,
  resetKey = 0,
  settled = true,
): (smooth?: boolean) => void {
  const forceFollow = useRef(false);

  const stick = useCallback((smooth = false) => {
    forceFollow.current = true;
    const node = listRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    if (!smooth && node.scrollTop === 0) forceFollow.current = false;
  }, [listRef]);

  const settledRef = useRef(settled);
  useEffect(() => {
    // Watched for its transitions, but it changes nothing: the height below is not pinned
    // any more, so a turn ending has nothing to release. Kept as a parameter because
    // callers read naturally as "following while this turn runs", and the reserve it used
    // to drive is documented in TECH_DESIGN as removed.
    settledRef.current = settled;
  }, [settled]);

  useEffect(() => {
    if (!active) return;
    const scroller = listRef.current;
    const end = endRef.current;
    if (!scroller || !end) return;

    const following = () => {
      if (forceFollow.current) return true;
      const range = scroller.scrollHeight - scroller.clientHeight;
      // A pane with nothing to scroll has no "up" to be pinned against; its only position
      // is the bottom, which the sticky band already covers.
      const maxUp = range > 0 ? -range : null;
      if (threadFollowsBottom(scroller.scrollTop, maxUp)) return true;
      // The sentinel is the fallback for the one case the number cannot see: the user
      // scrolled up while the transcript was shorter than the viewport, so `scrollTop` was
      // pinned at 0 by the lack of range, and content has since grown past it.
      const root = scroller.getBoundingClientRect();
      return end.getBoundingClientRect().top <= root.bottom + STICKY_PX;
    };

    const apply = () => {
      if (!following()) return;
      forceFollow.current = false;
      if (scroller.scrollTop === 0) return;
      scroller.scrollTop = 0;
    };

    // Everything that can make the transcript taller. `ResizeObserver` on the body covers
    // reflows of any kind — a tool result arriving, a markdown table finishing its layout —
    // where a MutationObserver would hear about the DOM change but not the height.
    const body = scroller.querySelector<HTMLElement>("[data-thread-body]");
    const observer = new ResizeObserver(apply);
    if (body) observer.observe(body);

    const onScroll = () => {
      if (scroller.scrollTop === 0) forceFollow.current = false;
    };

    const releaseFollow = () => {
      // Wheel / touch are the user telling us they want to look at something else. Without
      // this, the next growth would yank them back to the bottom mid-read.
      forceFollow.current = false;
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", releaseFollow, { passive: true });
    scroller.addEventListener("touchmove", releaseFollow, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", releaseFollow);
      scroller.removeEventListener("touchmove", releaseFollow);
    };
  }, [active, endRef, listRef, resetKey, sessionId]);

  return stick;
}
