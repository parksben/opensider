/** Session column (header + thread + composer, not the history drawer). */
export const COMPACT_MAIN_PX = 348;

/**
 * Width at or below which the two composer pills (session mode and permission) drop their
 * labels and show the icon only.
 *
 * Deliberately separate from COMPACT_MAIN_PX: the pills run out of room much earlier than
 * the rest of the layout, and collapsing them should not drag the other compact
 * behaviours (hidden agent picker, left-aligned title) along with it.
 */
export const ICON_ONLY_MAIN_PX = 448;
