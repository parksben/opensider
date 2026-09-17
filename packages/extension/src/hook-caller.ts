/**
 * Who is allowed to drive a MAIN-world hook?
 *
 * Both hooks (`native-ui-hook.ts`, `activity-hook.ts`) live in the page's own JS world, so
 * page script can call them just like we do — `chrome.scripting.executeScript` is the only
 * caller that knows the per-tab token, and the token is the only way to tell us apart. The
 * hook never sees the token before its first call, so the first valid-looking caller claims
 * it. A page that wins that race can therefore hold the hook (it is a page on a tab we
 * chose to work with, and holding it only means *its own* tab is not armed/observed — no
 * privilege escapes).
 *
 * `handshake` is what makes that recoverable instead of silent: it reports `authorized`
 * honestly, so the service worker can tell "the page got here first" apart from "nothing is
 * installed" and re-seat the hook (see `reseatPageHook` in `background.ts`).
 */

export type HookHandshake = {
  /** Always true: whoever you are, the hook is there. */
  installed: true;
  /** True when the caller holds the token — i.e. when the caller is the service worker. */
  authorized: boolean;
  /** True when this very call is the one that claimed the token. */
  claimed: boolean;
};

export type CallerGuard = {
  /** Claims the token on the first valid-looking caller, then reports who is who. */
  handshake(caller: unknown): HookHandshake;
  /** True for the token holder; never claims. */
  authorized(candidate: unknown): boolean;
  /** Same as `authorized`, but only for tearing the hook down: releasing must never be the
   * call that claims the token. */
  mayRelease(caller: unknown): boolean;
  /** The claimed token, for tests and for a hook that needs to pass it on. */
  current(): string;
};

/** Tokens are 32 hex chars (`crypto.randomUUID()` without dashes); anything shorter is not a
 * candidate the service worker would ever send, so it must not be able to claim the hook. */
const MIN_TOKEN_LENGTH = 16;

export function createCallerGuard(): CallerGuard {
  let token = "";

  const looksLikeToken = (value: unknown): value is string =>
    typeof value === "string" && value.length >= MIN_TOKEN_LENGTH;

  return {
    handshake(caller: unknown): HookHandshake {
      if (!token) {
        if (!looksLikeToken(caller)) return { installed: true, authorized: false, claimed: false };
        token = caller;
        return { installed: true, authorized: true, claimed: true };
      }
      return { installed: true, authorized: caller === token, claimed: false };
    },
    authorized(candidate: unknown): boolean {
      return token !== "" && candidate === token;
    },
    mayRelease(caller: unknown): boolean {
      return token !== "" && caller === token;
    },
    current(): string {
      return token;
    },
  };
}
