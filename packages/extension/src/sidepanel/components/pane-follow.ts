/**
 * How close to the bottom (px) of a streamed pane still counts as "following".
 *
 * Smaller than the thread's `STICKY_PX` on purpose: these panes are only ~10 lines tall,
 * so the 96px that suits the transcript would swallow the first half of the box and a
 * user who nudged the scrollbar would be pulled straight back down.
 */
export const PANE_STICKY_PX = 32;

/**
 * Whether a scroll pane should still be pinned to its bottom.
 *
 * A pane with nothing to scroll always follows: there is no "scrolled away" state yet.
 * Otherwise being within `sticky` of the bottom counts as following; being further away
 * means the user went up to read and must not be dragged back.
 *
 * The scroll position is whatever the pane is at *right now*, so this is also what a
 * scroll listener calls to decide whether the follow stays on: a wheel-up that lands
 * outside the sticky band releases it, and a wheel-down back into the band re-arms it.
 */
export function paneFollowsBottom(
  scrollHeight: number,
  clientHeight: number,
  scrollTop: number,
  sticky: number = PANE_STICKY_PX,
): boolean {
  if (scrollHeight <= clientHeight) return true;
  // Clamp: browsers hand back a bogus scrollTop when scrolling past an edge (momentum
  // overscroll, or a pane that just got shorter). Distance from the bottom can go
  // negative that way, and a negative distance is the closest possible to it.
  const distance = scrollHeight - clientHeight - scrollTop;
  return distance <= sticky;
}
