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
 * Follow the bottom while the user is near it. Once they scroll up to read,
 * pin the first visible message so streaming growth does not move it.
 * Returns the function that jumps back to the bottom (send, session switch, the button).
 */
export function useThreadFollow(
  listRef: RefObject<HTMLElement | null>,
  endRef: RefObject<HTMLElement | null>,
  sessionId: string,
  active: boolean,
): (smooth?: boolean) => void {
  const forceFollow = useRef(false);

  const stick = useCallback((smooth = false) => {
    forceFollow.current = true;
    const node = listRef.current;
    if (!node) return;
    node.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
    if (!smooth && node.scrollTop === 0) forceFollow.current = false;
  }, [listRef]);

  useEffect(() => {
    if (!active) return;
    const scroller = listRef.current;
    const end = endRef.current;
    if (!scroller || !end) return;
    const body = scroller.querySelector<HTMLElement>("[data-thread-body]");
    if (!body) return;

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

    const observer = new ResizeObserver(() => apply());
    observer.observe(body);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("wheel", releaseFollow, { passive: true });
    scroller.addEventListener("touchmove", releaseFollow, { passive: true });
    return () => {
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("wheel", releaseFollow);
      scroller.removeEventListener("touchmove", releaseFollow);
    };
  }, [active, endRef, listRef, sessionId]);

  return stick;
}
