import { useEffect, useRef, useState } from "react";

/**
 * One-way ratchet for the live transcript: turns true once the observed node has scrolled
 * entirely above the transcript's viewport, and never back.
 *
 * Why this exists, and why it is shaped like this: while a turn runs, a finished step is
 * expected to collapse back to its title line (content hidden), but collapsing a step that
 * is still on screen drags everything above it down with it — measured frame by frame on
 * the real panel, a single fold moved the transcript 125px in one frame, and that is the
 * jitter users keep reporting. A `column-reverse` transcript makes the other half of the
 * answer free: it is anchored at its bottom edge, so a shrink *above* the viewport does not
 * move anything the reader can see (the visible window is the last `clientHeight` px of
 * content; removing height above it changes neither those pixels nor the offset). So the
 * rule is: collapse a finished step only after the reader has watched it go past. On
 * screen it stays open; the moment it leaves through the top edge it becomes its one line.
 *
 * The ratchet does not re-open when scrolled back into view: re-expanding under the reader
 * would be the same class of movement on the way down, and the end-of-turn fold is where
 * the transcript is allowed to move things around anyway.
 */
export function usePassedAway<T extends HTMLElement = HTMLDivElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!enabled || !node || passed) return;
    const scroller = node.closest(".cs-thread");
    if (!(scroller instanceof HTMLElement)) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.rootBounds) return;
        // Fully above the scrollport's top edge — the reader can no longer see it, so the
        // collapse that follows is pixel-invisible.
        if (entry.boundingClientRect.bottom <= entry.rootBounds.top) setPassed(true);
      },
      { root: scroller, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [enabled, passed]);

  return { ref, passed };
}
