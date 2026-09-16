import {
  IDLE_PAGE_ACTIVITY,
  PAGE_ACTIVITY_FRAME_MS,
  PAGE_ACTIVITY_HOOK_KEY,
  PAGE_ACTIVITY_TTL_MS,
  mutedEventSet,
  type PageActivityState,
} from "@shared";
import { createActivityShim } from "./activity-shim";

/**
 * Page activity hook (MAIN world, `document_start`, all frames).
 *
 * The mechanism lives in `activity-shim.ts` (no globals of its own, so it can be tested
 * outside a browser); this file is just the plumbing: hand the shim the page's real
 * objects and expose it through one non-configurable, token-guarded global.
 *
 * Same trust model as the native UI hook: the token only ever arrives through
 * `chrome.scripting.executeScript` arguments, which page script cannot read, so a page
 * cannot flip its own forced-visibility state.
 */
(() => {
  const host = window as unknown as Record<string, unknown>;
  if (host[PAGE_ACTIVITY_HOOK_KEY]) return;

  let token = "";

  function authorized(candidate: unknown): boolean {
    if (typeof candidate !== "string" || candidate.length < 16) return false;
    if (!token) token = candidate;
    return candidate === token;
  }

  const shim = createActivityShim({
    document,
    window,
    eventTarget: EventTarget,
    now: () => Date.now(),
    frameMs: PAGE_ACTIVITY_FRAME_MS,
    ttlMs: PAGE_ACTIVITY_TTL_MS,
    muted: mutedEventSet(),
  });

  Object.defineProperty(host, PAGE_ACTIVITY_HOOK_KEY, {
    configurable: false,
    writable: false,
    value: {
      // The service worker calls `api[method](token, ...args)`.
      set(caller: unknown, enabled: unknown): PageActivityState {
        if (!authorized(caller)) return shim.read();
        return shim.set(Boolean(enabled));
      },
      read(caller: unknown): PageActivityState {
        return authorized(caller) ? shim.read() : IDLE_PAGE_ACTIVITY;
      },
    },
  });
})();
