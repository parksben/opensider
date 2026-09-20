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

/**
 * At or below this width the model picker's max width drops to MODEL_NARROW_MAX_PX.
 * The composer row has five controls by then, and the model name is the one label that can
 * give ground without hiding a control.
 */
export const MODEL_NARROW_MAIN_PX = 396;

/**
 * The model picker's max width at or below MODEL_NARROW_MAIN_PX, in px (the normal cap is
 * 9.5rem = 152px). Kept as a number rather than a Tailwind class so the value has exactly
 * one home in the code; a third of the usual cap (51px) was tried and read as too narrow.
 */
export const MODEL_NARROW_MAX_PX = 80;

/**
 * Icon size for every button in the composer toolbar row (attach / pick / mention / session
 * mode / permission / stop / send).
 *
 * One value for all of them on purpose: these sit side by side, so the number in the code is
 * the thing that has to match. Do not size one of them "optically" by hand — a difference in
 * the source is a difference on screen.
 */
export const COMPOSER_ICON_PX = 14;
