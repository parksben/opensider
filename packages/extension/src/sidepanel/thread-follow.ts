import { useCallback, useEffect, useRef, type RefObject } from "react";

/** How close to the bottom (px) still counts as "following" the stream. */
export const STICKY_PX = 96;

/**
 * The thread is `flex-direction: column-reverse`, so `scrollTop === 0` is the bottom and
 * scrolling up makes `scrollTop` negative. Keeping that value while the transcript grows
 * preserves the distance *from the bottom*, which pushes whatever the user is reading
 * upward. When they are not following, add the anchor's on-screen shift back onto
 * `scrollTop` so that line stays put. When they are following, snap to `0`.
 */
export function nextThreadScroll(following: boolean, scrollTop: number, shift: number): number | null {
  if (following) return scrollTop === 0 ? null : 0;
  if (Math.abs(shift) < 1) return null;
  return scrollTop + shift;
}

/**
 * Whether the transcript should still be pinned to its bottom.
 *
 * Read off `scrollTop`, not off geometry: `scrollTop === 0` *is* the bottom in a
 * `column-reverse` box, so "within STICKY_PX of it" is simply `|scrollTop| <= STICKY_PX`.
 *
 * This used to measure the sentinel's `getBoundingClientRect()` against the scrollport's
 * bottom, which was wrong in a specific and painful way. While a turn ran the transcript
 * carried a `min-height` taller than its content, which pushed the sentinel far above the
 * scrollport while `scrollTop` was still 0; the moment the user scrolled up by less than
 * that overshoot the sentinel came back into range and the transcript snapped them to the
 * bottom again — a tug-of-war they had to fight through to read anything.
 *
 * `maxScrollUp` is `-(scrollHeight - clientHeight)`, the furthest up the user can go. Being
 * pinned there counts as following too: there is nothing more to show, and no reason to
 * stop them scrolling back down.
 */
export function threadFollowsBottom(
  scrollTop: number,
  maxScrollUp: number | null = null,
  sticky: number = STICKY_PX,
): boolean {
  if (Math.abs(scrollTop) <= sticky) return true;
  // Only when a real limit is supplied. `null` (or a limit that is still 0 because the
  // caller has not measured) must not read as "pinned to the end": an unmeasured limit
  // makes every position look like the end, which re-creates the snap-back the sticky band
  // exists to avoid.
  if (maxScrollUp == null || maxScrollUp === 0) return false;
  return scrollTop <= maxScrollUp;
}

/**
 * Follow the bottom while the user is near it. Once they scroll up to read, pin the first
 * visible message so streaming growth does not move it.
 * Returns the function that jumps back to the bottom (send, session switch, the button).
 *
 * `settled` is the running state of the conversation on screen: `false` while a turn
 * streams, `true` once it is over. It no longer changes any height — the reserve that used
 * to be pinned around it is gone, see below.
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

  /**
   * `settled` is watched for its transitions and no longer touches the height.
   *
   * It used to pin the body to the tallest it had been, so a turn's streaming tool steps
   * (replaced in place) and the fold at the end of it (everything becomes one line) could
   * not shrink the body and drag earlier messages back down. Measured in a real browser,
   * that pin was the reason scrolling up fought the user: the pinned height lands entirely
   * *above* the messages, so they scrolled through dead space before reaching anything,
   * and with a long enough process they could reach the top and see no message at all. It
   * also pushed the sentinel out of the scrollport, which kept the "am I at the bottom"
   * test answering yes and snapping them back.
   *
   * The DOM needs no such prop. `column-reverse` anchors `scrollTop` to the newest content,
   * and appending, removing or resizing rows left `scrollTop` alone in measurement, so the
   * transcript now rides on its own natural height.
   */
  const settledRef = useRef(settled);
  useEffect(() => {
    settledRef.current = settled;
  }, [settled]);

  useEffect(() => {
    if (!active) return;
    const scroller = listRef.current;
    if (!scroller) return;

    const following = () => {
      if (forceFollow.current) return true;
      const range = scroller.scrollHeight - scroller.clientHeight;
      // A pane with nothing to scroll has no "up" to be pinned against; its only position
      // is the bottom, which the sticky band already covers.
      const maxUp = range > 0 ? -range : null;
      return threadFollowsBottom(scroller.scrollTop, maxUp);
    };

    /**
     * Keep the message under the reader's eyes where it is when the content around it
     * changes size. Appends, removals and height changes above the reader all held
     * `scrollTop` by themselves in measurement; what does move is a step that collapses
     * *below* the reading position, which pulls the following content up and slides the
     * reader's line down the screen. Correcting by that shift is what makes the fold at the
     * end of a turn read as "the process above me folded" instead of "I was moved".
     *
     * `writing` stops the correction feeding itself: setting `scrollTop` fires `scroll`.
     */
    let anchor: HTMLElement | null = null;
    let anchorTop = 0;
    let writing = false;

    const body = scroller.querySelector<HTMLElement>("[data-thread-body]");
    const capture = () => {
      if (!body) return;
      const root = scroller.getBoundingClientRect();
      anchor = null;
      for (const el of body.querySelectorAll<HTMLElement>("[data-thread-anchor]")) {
        const rect = el.getBoundingClientRect();
        if (rect.bottom > root.top + 4) {
          anchor = el;
          anchorTop = rect.top;
          return;
        }
      }
    };

    const apply = () => {
      if (writing) return;
      if (following()) {
        anchor = null;
        const next = nextThreadScroll(true, scroller.scrollTop, 0);
        if (next == null) {
          forceFollow.current = false;
          return;
        }
        writing = true;
        scroller.scrollTop = next;
        writing = false;
        if (scroller.scrollTop === 0) forceFollow.current = false;
        return;
      }
      if (!anchor || !anchor.isConnected) {
        capture();
        return;
      }
      const shift = anchor.getBoundingClientRect().top - anchorTop;
      const next = nextThreadScroll(false, scroller.scrollTop, shift);
      if (next == null) return;
      writing = true;
      scroller.scrollTop = next;
      writing = false;
      anchorTop = anchor.getBoundingClientRect().top;
    };

    const onScroll = () => {
      if (scroller.scrollTop === 0) forceFollow.current = false;
      if (writing) return;
      if (following()) anchor = null;
      else capture();
    };

    const releaseFollow = () => {
      forceFollow.current = false;
    };

    // Content changes are what need the anchor correction; a MutationObserver catches every
    // kind of it (a tool result arriving, a fold, a markdown table finishing its layout)
    // where a ResizeObserver on the body would only hear about the box resizing.
    const observer = new MutationObserver(apply);
    if (body) {
      observer.observe(body, { childList: true, subtree: true, characterData: true });
      capture();
      apply();
    }
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", releaseFollow, { passive: true });
    scroller.addEventListener("touchmove", releaseFollow, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", releaseFollow);
      scroller.removeEventListener("touchmove", releaseFollow);
    };
  }, [active, resetKey, sessionId]);

  return stick;
}
