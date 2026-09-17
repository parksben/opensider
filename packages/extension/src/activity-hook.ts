import {
  IDLE_PAGE_ACTIVITY,
  PAGE_ACTIVITY_FRAME_MS,
  PAGE_ACTIVITY_HOOK_KEY,
  PAGE_ACTIVITY_TTL_MS,
  mutedEventSet,
  type PageActivityState,
} from "@shared";
import { createActivityShim } from "./activity-shim";
import { createCallerGuard, type HookHandshake } from "./hook-caller";

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

  const guard = createCallerGuard();

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
    // Configurable so `release` can take the hook back out: a tab nobody is working with
    // must look stock again (see `releasePageHooks` in background.ts).
    configurable: true,
    writable: false,
    value: {
      // The service worker calls `api[method](token, ...args)`. `handshake` is how it learns
      // whether it still holds the hook (a page can claim it first, see `hook-caller.ts`).
      handshake(caller: unknown): HookHandshake {
        return guard.handshake(caller);
      },
      set(caller: unknown, enabled: unknown): PageActivityState {
        if (!guard.authorized(caller)) return shim.read();
        return shim.set(Boolean(enabled));
      },
      read(caller: unknown): PageActivityState {
        return guard.authorized(caller) ? shim.read() : IDLE_PAGE_ACTIVITY;
      },
      /** Disarm and uninstall: never claims the token, so only a caller that already proved
       * itself (the service worker) can do it. */
      release(caller: unknown): boolean {
        if (!guard.mayRelease(caller)) return false;
        shim.set(false);
        try {
          delete host[PAGE_ACTIVITY_HOOK_KEY];
        } catch {
          // ignore
        }
        return true;
      },
    },
  });
})();
