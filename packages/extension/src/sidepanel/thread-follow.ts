import { useCallback, useEffect, useRef, type RefObject } from "react";

/** How close to the bottom (px) still counts as "following" the stream. */
export const STICKY_PX = 96;

/**
 * The thread is `flex-direction: column-reverse`, so `scrollTop === 0` is the
 * bottom and scrolling up makes `scrollTop` negative. Keeping that value while
 * the transcript grows preserves the distance *from the bottom*, which pushes
 * whatever the user is reading upward. When they are not following, add the
 * anchor's on-screen shift back onto `scrollTop` so that line stays put.
 * When they are following, snap to `0`.
 */
export function nextThreadScroll(following: boolean, scrollTop: number, shift: number): number | null {
  if (following) return scrollTop === 0 ? null : 0;
  if (Math.abs(shift) < 1) return null;
  return scrollTop + shift;
}

/**
 * What the body's pinned height should become after measuring it at `height`.
 *
 * The transcript is pinned to the tallest it has been so streaming growth cannot pull the
 * messages above back down. That pin has to follow the body when the body legitimately
 * shrinks — the fold at the end of a turn (every reasoning / tool step collapses into one
 * line) is a shrink of hundreds of pixels, and a pin left at the old height is the blank
 * gap the user sees below the finished reply.
 *
 * - Growing: raise the pin, so the reserve covers the new content.
 * - Shrinking while a turn still runs: keep the pin. The transcript only grows mid-turn,
 *   so a shrink there is a half-applied repaint; the next measurement puts it back.
 * - Shrinking once the turn is over (or a resend truncated the tail): rebase onto the real
 *   height. Zero means the body is gone (empty session), which is "no pin at all".
 */
export function nextBodyPin(pin: number, height: number, settled: boolean): number {
  if (height > pin) return height;
  if (!settled || pin === 0) return pin;
  return Math.max(0, height);
}

/**
 * Follow the bottom while the user is near it. Once they scroll up to read,
 * pin the first visible message so streaming growth does not move it.
 * Returns the function that jumps back to the bottom (send, session switch, the button).
 *
 * `settled` is the running state of the conversation on screen: `false` while a turn
 * streams, `true` once it is over. The flip from one to the other is where the pinned
 * height below is let go — see the effect inside.
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
  /** The pinned body height. Lives in a ref so the release below can rebase it. */
  const peakRef = useRef(0);

  const stick = useCallback((smooth = false) => {
    forceFollow.current = true;
    const node = listRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    if (!smooth && node.scrollTop === 0) forceFollow.current = false;
  }, [listRef]);

  /**
   * `settled` flips once per turn: `false` the moment the user sends, `true` when the
   * answer is done. Watched here rather than inside the reserve below because the
   * reserve is a ResizeObserver callback — it only hears about height *changes*, and a
   * turn that begins while the body is already at its tallest would never be told.
   *
   * Starting a turn: forget the pin so this turn is measured from scratch instead of
   * being capped by the peak of the previous one.
   * Ending a turn: the fold has already landed by then in practice (React repaints the
   * assistant message before the parent drops `isRunning`), so the body is at its real
   * height — rebase the pin onto it. If the fold lands one frame later, the reserve's
   * shrink branch does the same rebase, so both orderings converge.
   */
  const settledRef = useRef(settled);
  useEffect(() => {
    const was = settledRef.current;
    settledRef.current = settled;
    if (settled === was) return;
    const body = listRef.current?.querySelector<HTMLElement>("[data-thread-body]");
    if (!body) return;
    if (settled) {
      // Release the pin and let the body be exactly as tall as it is now. The next turn
      // pins again from here, so the empty gap below the last reply never survives a
      // finished turn.
      body.style.minHeight = "";
      peakRef.current = body.offsetHeight;
    } else {
      body.style.minHeight = "";
      peakRef.current = 0;
    }
  }, [settled, listRef]);

  useEffect(() => {
    if (!active) return;
    const scroller = listRef.current;
    const end = endRef.current;
    if (!scroller || !end) return;
    const body = scroller.querySelector<HTMLElement>("[data-thread-body]");
    if (!body) return;

    // The transcript only ever grows: while a tool call streams, its live step is
    // replaced in place (and the whole process folds at the end of the turn), which
    // would otherwise shrink the body and pull the messages above back down. Pin the
    // tallest the body has been so the height never drops. Blank below is fine — the
    // next content fills it and the follow picks up again. A width change reflows the
    // text, so start the measurement over there. A `resetKey` bump (a resend/edit that
    // truncates the tail) rebuilds this effect, releasing the reserve so the now-shorter
    // transcript does not keep a wall of empty height below the last message.
    // A fresh body (session switch, a resend that truncated the tail, or the reserve
    // coming back from a width change): start the measurement over rather than pin the
    // new transcript to whatever the previous one reached.
    peakRef.current = 0;
    body.style.minHeight = "";
    let width = scroller.clientWidth;
    const reserve = () => {
      if (scroller.clientWidth !== width) {
        // A width change reflows the text, so start the measurement over: the old pin was
        // measured at the old width and may already be wrong.
        width = scroller.clientWidth;
        peakRef.current = 0;
        body.style.minHeight = "";
      }
      const pin = nextBodyPin(peakRef.current, body.offsetHeight, settledRef.current);
      if (pin === peakRef.current) return;
      peakRef.current = pin;
      body.style.minHeight = pin > 0 ? `${pin}px` : "";
    };
    reserve();

    let anchor: HTMLElement | null = null;
    let anchorTop = 0;
    let writing = false;

    const following = () => {
      if (forceFollow.current) return true;
      const root = scroller.getBoundingClientRect();
      const sent = end.getBoundingClientRect();
      return sent.top <= root.bottom + STICKY_PX;
    };

    const capture = () => {
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

    const observer = new ResizeObserver(() => {
      reserve();
      apply();
    });
    observer.observe(body);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", releaseFollow, { passive: true });
    scroller.addEventListener("touchmove", releaseFollow, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", releaseFollow);
      scroller.removeEventListener("touchmove", releaseFollow);
      body.style.minHeight = "";
    };
  }, [active, endRef, listRef, resetKey, sessionId]);

  return stick;
}
