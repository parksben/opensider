/**
 * Page activity: while the side panel is open the page the Agent works on must
 * believe it is visible and focused.
 *
 * Chrome hides a page (`document.visibilityState === "hidden"`) whenever the tab
 * is not the active one of a visible, unoccluded, non-minimised window. Plenty of
 * sites pause themselves on that signal (lazy loading, animation-driven widgets,
 * a "the page is not active" overlay swallowing clicks), and `requestAnimationFrame`
 * stops firing altogether, so page automation stalls in the background.
 *
 * There is no extension API for "pretend this page is visible" — the page-facing
 * surface is all we can rewrite, and it has to be rewritten from the page's own
 * (MAIN) world. That is what the hook does; these are the shared pieces it and the
 * service worker agree on.
 */

/** Global the main-world hook installs. Deliberately ugly, and token-guarded. */
export const PAGE_ACTIVITY_HOOK_KEY = "__opensiderActivity";

/**
 * Events the hook swallows while it is armed: they all tell the page it is being
 * put away, which is exactly the signal we are overriding.
 */
export const PAGE_ACTIVITY_MUTED_EVENTS = [
  "visibilitychange",
  "webkitvisibilitychange",
  "blur",
  "pagehide",
  "freeze",
] as const;

/** Timer fallback interval for `requestAnimationFrame` while the page is really hidden. */
export const PAGE_ACTIVITY_FRAME_MS = 16;

/**
 * How long an arming lasts without being refreshed. The service worker refreshes it every
 * time it touches the tab, so an active Agent never hits this; it only covers the case
 * where the panel goes away without us noticing (crash, browser kill) — pages must not sit
 * there permanently pretending to be visible.
 */
export const PAGE_ACTIVITY_TTL_MS = 15 * 60 * 1000;

export type PageActivityState = {
  armed: boolean;
  /** What the page would see without the hook (the browser's own answer). */
  actualHidden: boolean;
  /** True when the hook had to replace rAF with timers (page really hidden). */
  frameFallback: boolean;
};

export const IDLE_PAGE_ACTIVITY: PageActivityState = {
  armed: false,
  actualHidden: false,
  frameFallback: false,
};

/** Names of the muting patches, used by tests and by the hook's own bookkeeping. */
export function mutedEventSet(): Set<string> {
  return new Set<string>(PAGE_ACTIVITY_MUTED_EVENTS);
}
