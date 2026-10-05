/**
 * How close to the bottom (px) of a streamed pane still counts as "following".
 *
 * Sub-pixel slack, effectively exact: these panes print a line every few hundred
 * milliseconds, so a wider band is a tug of war — the reader nudges up to re-read a line
 * and the next chunk drags them back down. (The old 32px band did exactly that; the
 * thread's follow rule has the same strictness, see `thread-follow`.)
 */
export const PANE_BOTTOM_EPSILON_PX = 2;

/**
 * Whether a scroll pane should still be pinned to its bottom.
 *
 * A pane with nothing to scroll always follows: there is no "scrolled away" state yet.
 * Otherwise being within `epsilon` of the bottom counts as following; anything further
 * means the user went up to read and must not be dragged back.
 *
 * The scroll position is whatever the pane is at *right now*, so this is also what a
 * scroll listener calls to decide whether the follow stays on: scrolling up releases it,
 * and only a return to the exact bottom re-arms it.
 */
export function paneFollowsBottom(
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
  epsilon: number = PANE_BOTTOM_EPSILON_PX,
): boolean {
  if (scrollHeight <= clientHeight) return true;
  // Clamp: browsers hand back a bogus scrollTop when scrolling past an edge (momentum
  // overscroll, or a pane that just got shorter). Distance from the bottom can go
  // negative that way, and a negative distance is the closest possible to it.
  const distance = scrollHeight - clientHeight - scrollTop;
  return distance <= epsilon;
}
