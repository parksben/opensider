import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * One process step inside a running turn — a tool card or a reasoning block — with the
 * hide-and-hold behaviour the transcript is specified around:
 *
 *   - while the step is the one running, it is visible and streams as usual;
 *   - the moment it finishes it becomes invisible **without the layout moving one pixel**.
 *     `visibility: hidden` keeps its box, and the step is rendered in its expanded state
 *     while hidden, so the box it keeps is exactly the height it had when it finished.
 *     This is deliberate: removing that height is what dragged the transcript around in
 *     earlier builds (measured: one close moved it 125px in a single frame);
 *   - the reserved box is given back only after the step has left through the top of the
 *     transcript (`column-reverse` anchored at its bottom edge: a shrink up there changes
 *     nothing visible);
 *   - a finished step is not reviewable while the turn runs. The whole run comes back,
 *     every step in order, behind the worked-for fold when the turn ends.
 */
export function LiveStep({ visible, children }: { visible: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [passed, setPassed] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node || visible || passed) return;
    const scroller = node.closest(".cs-thread");
    if (!(scroller instanceof HTMLElement)) return;
    const check = () => {
      const root = scroller.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      // Release only once the box is buried at least twice its own height above the top of
      // the viewport. Releasing slides everything above the box down by its height; with
      // that much clearance the slide cannot bring anything into view (measured: releasing
      // while merely off-screen dragged a sliver of the reader's message into the frame).
      // Bands that do not clear the bar simply wait — the end-of-turn fold collects
      // whatever is left anyway. The check runs on scroll and on every body resize because
      // a `column-reverse` transcript moves these boxes up by growing BELOW them; an
      // IntersectionObserver alone only fires at the exit and would never see the rest of
      // the journey.
      if (rect.bottom <= root.top - rect.height) setPassed(true);
    };
    check();
    scroller.addEventListener("scroll", check, { passive: true });
    const body = scroller.querySelector("[data-thread-body]");
    const observer = new ResizeObserver(check);
    if (body) observer.observe(body);
    return () => {
      scroller.removeEventListener("scroll", check);
      observer.disconnect();
    };
  }, [visible, passed]);

  if (passed) return null;
  return (
    <div
      ref={ref}
      data-live-step={visible ? "visible" : "hidden"}
      style={visible ? undefined : { visibility: "hidden" }}
    >
      {children}
    </div>
  );
}
