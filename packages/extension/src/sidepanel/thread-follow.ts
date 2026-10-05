import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Sub-pixel slack around the bottom, and nothing more. */
export const FOLLOW_EPSILON_PX = 2;

/** How close to the bottom the "jump to bottom" affordance stays hidden (panel margin). */
export const STICKY_PX = 96;

/**
 * Whether the offset sits at the bottom of a `column-reverse` transcript — `0` is the
 * bottom there, so this is just `|scrollTop| <= epsilon`.
 *
 * The epsilon is sub-pixel slack and nothing else, because the rule this file grew around
 * is that the reader's wheel wins: once they are off the bottom they are reading, and
 * nothing may pull them back. An earlier version followed everything within 96px of the
 * bottom, and another counted "pinned at the far end of the scrollback" as following —
 * both snapped readers back mid-read (measured on the real panel: a reader at -241px
 * dragged to 0 by a single content change). Careful with geometry too: measuring a sentinel
 * against the scrollport's edge went wrong the moment the transcript's height changed,
 * which is why this reads the number that *is* the definition of the bottom.
 */
export function atThreadBottom(scrollTop: number, epsilon: number = FOLLOW_EPSILON_PX): boolean {
  return Math.abs(scrollTop) <= epsilon;
}

/**
 * Hold the transcript still while a turn runs, and jump it back on request.
 * Returns the function that jumps to the bottom (send, session switch, the button).
 *
 * Three rules, in the order they matter:
 *
 *   - **Staying put at the bottom is the browser's job.** A `column-reverse` box at
 *     `scrollTop === 0` pins the pile to its bottom edge, and appends, removals and
 *     resizes there all leave the offset alone (measured: zero displacement for each), so
 *     following needs no per-frame `scrollTo` from us.
 *   - **The reader wins.** The moment the offset leaves the bottom — any wheel, touch, or
 *     keyboard scroll — it is theirs until they come back to it or press the button.
 *     Growth never drags them back; the `ResizeObserver` below only smooths sub-pixel
 *     wobble and serves the forced jumps.
 *   - **`stick()` is the only forced move**, and it stays forced until the offset lands at
 *     the bottom, so the animation it starts is not mistaken for the user scrolling.
 *
 * Why the strictness: the previous version re-armed the follow while the reader was
 * within a 96px band of the bottom, and treated "pinned at the far end of the scrollback"
 * as following too. Frame-by-frame on the real panel that pulled a reader 241px up back
 * to the bottom on the next chunk. Handing control back requires "following" to mean
 * exactly "still at the bottom".
 */
export function useThreadFollow(
  listRef: RefObject<HTMLElement | null>,
  sessionId: string,
  active: boolean,
  resetKey = 0,
): (smooth?: boolean) => void {
  const forceFollow = useRef(false);
  const suspended = useRef(false);

  const stick = useCallback((smooth = false) => {
    const node = listRef.current;
    suspended.current = false;
    if (!node) return;
    if (node.scrollTop === 0) {
      forceFollow.current = false;
      return;
    }
    forceFollow.current = true;
    node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
  }, [listRef]);

  useEffect(() => {
    if (!active) return;
    const scroller = listRef.current;
    if (!scroller) return;
    suspended.current = false;

    const apply = () => {
      const top = scroller.scrollTop;
      if (forceFollow.current) {
        if (top !== 0) scroller.scrollTop = 0;
        return;
      }
      // The reader owns any real offset; only sub-pixel wobble is ours to fix.
      if (suspended.current) return;
      if (!atThreadBottom(top)) return;
      if (top !== 0) scroller.scrollTop = 0;
    };

    // Everything that can make the transcript taller. `ResizeObserver` on the body covers
    // reflows of any kind — a markdown table finishing its layout, a code block opening —
    // where a MutationObserver would hear about the DOM change but not the height.
    const body = scroller.querySelector<HTMLElement>("[data-thread-body]");
    const observer = new ResizeObserver(apply);
    if (body) observer.observe(body);

    const onScroll = () => {
      if (atThreadBottom(scroller.scrollTop)) {
        suspended.current = false;
        forceFollow.current = false;
        return;
      }
      // A `stick()` animation in flight is us, not the reader.
      if (forceFollow.current) return;
      suspended.current = true;
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [active, listRef, resetKey, sessionId]);

  return stick;
}
