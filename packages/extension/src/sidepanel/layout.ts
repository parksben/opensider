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
 * The reasoning-effort pill's max width at or below MODEL_NARROW_MAIN_PX, in px. That pill
 * sits right of the model picker and only shows when the engine advertises a
 * `thought_level` option (Claude's `Effort`). At 396px there is room for the icon plus a
 * word or two and nothing more: it truncates on one line and never wraps, because a second
 * line would push the composer to two rows.
 */
export const OPTION_NARROW_MAX_PX = 48;

/**
 * Icon size for every button in the composer toolbar row (attach / pick / mention / session
 * mode / permission / reasoning effort / stop / send).
 *
 * One value for all of them on purpose: these sit side by side, so the number in the code is
 * the thing that has to match. Do not size one of them "optically" by hand — a difference in
 * the source is a difference on screen.
 */
export const COMPOSER_ICON_PX = 14;
/**
 * Width at or above which the four composer action buttons (attach / pick / mention / slash)
 * are laid out flat. Below it they collapse into a single plus button that opens them on
 * hover or click: four buttons plus the two pills do not fit in a narrow side panel.
 */
export const COMPOSER_ACTION_FLAT_PX = 600;

/**
 * The skill probe menu's list never gets narrower than this, and the detail panel it shows
 * beside the list is SKILL_DETAIL_PX wide. Below the sum (plus the menu's own 16px safe
 * margins) the detail panel moves under the list instead of beside it.
 */
export const SKILL_LIST_MIN_PX = 224;
export const SKILL_DETAIL_PX = 240;