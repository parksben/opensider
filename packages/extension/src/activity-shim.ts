import type { PageActivityState } from "@shared";

/**
 * The page-activity mechanism, with everything it touches injected.
 *
 * Extracted from the MAIN-world hook so it can be tested outside a browser (the hook
 * itself is a thin wrapper that hands in the real `document` / `window`). Nothing here
 * reaches for a global.
 *
 * Armed, the page is told it is visible and focused:
 *   - `document.visibilityState` → "visible", `document.hidden` → false, `hasFocus()` → true
 *   - listeners for `visibilitychange` / `blur` / `pagehide` / `freeze` are never called
 *   - `requestAnimationFrame` falls back to a timer while the page is really hidden,
 *     because real rAF callbacks stop in a hidden tab and anything waiting on a frame
 *     would hang
 *
 * Disarming restores the original descriptors and functions. Arming carries a TTL so a
 * panel that disappears without notice cannot leave a page faking visibility forever.
 */

export type ActivityGlobals = {
  document: Document;
  window: Window;
  /** `EventTarget` — the constructor whose prototype carries the listener methods. */
  eventTarget: typeof EventTarget;
  now: () => number;
  frameMs: number;
  ttlMs: number;
  muted: ReadonlySet<string>;
};

export type ActivityShim = {
  set(enabled: boolean): PageActivityState;
  read(): PageActivityState;
};

type AnyFn = (...args: never[]) => unknown;

const IDLE: PageActivityState = { armed: false, actualHidden: false, frameFallback: false };

export function createActivityShim(globals: ActivityGlobals): ActivityShim {
  const { document, window, eventTarget, muted } = globals;
  const now = globals.now;
  const documentProto = Object.getPrototypeOf(document) as unknown as Record<string, unknown>;

  // The browser's own answers, captured before anything is patched.
  let nativeHidden = descriptor(documentProto, "hidden");
  let nativeVisibility = descriptor(documentProto, "visibilityState");
  let nativeHasFocus = documentProto["hasFocus"] as AnyFn | undefined;
  const nativeAdd = eventTarget.prototype.addEventListener;
  const nativeRemove = eventTarget.prototype.removeEventListener;
  const nativeRaf = window.requestAnimationFrame;
  const nativeCancelRaf = window.cancelAnimationFrame;
  const nativeOnVisibility = descriptor(documentProto, "onvisibilitychange");

  let armed = false;
  let expiresAt = 0;
  let frameFallback = false;
  /** rAF ids we handed out as timers, so cancelAnimationFrame can tell them apart. */
  const ourFrames = new Set<number>();
  /** wrapped listener -> original listener. */
  const wrapped = new WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>();
  let onVisibilityHandler: ((ev: Event) => unknown) | null = null;

  function descriptor(proto: Record<string, unknown>, key: string): PropertyDescriptor | undefined {
    try {
      return Object.getOwnPropertyDescriptor(proto, key);
    } catch {
      return undefined;
    }
  }

  function call(fn: AnyFn, self: unknown, args: unknown[]): unknown {
    return (fn as (...a: unknown[]) => unknown).apply(self, args);
  }

  /** Armed *and* within its TTL — everything the shim redirects hinges on this. */
  function live(): boolean {
    if (!armed) return false;
    if (now() < expiresAt) return true;
    armed = false;
    return false;
  }

  function actualHidden(): boolean {
    try {
      if (nativeHidden?.get) return Boolean(nativeHidden.get.call(document));
    } catch {
      // fall back to the redirected value
    }
    return false;
  }

  function patchDocument(): void {
    try {
      Object.defineProperty(documentProto, "hidden", {
        configurable: true,
        enumerable: false,
        get(this: Document) {
          return live() ? false : Boolean(nativeHidden?.get?.call(this));
        },
      });
      Object.defineProperty(documentProto, "visibilityState", {
        configurable: true,
        enumerable: false,
        get(this: Document) {
          if (!live()) return nativeVisibility?.get?.call(this);
          return "visible";
        },
      });
      Object.defineProperty(documentProto, "hasFocus", {
        configurable: true,
        enumerable: false,
        writable: true,
        value: function hasFocus(this: Document) {
          if (live()) return true;
          return typeof nativeHasFocus === "function" ? call(nativeHasFocus, this, []) : true;
        },
      });
    } catch {
      // A frozen prototype costs us the state override; the rest of the shim still helps.
    }
  }

  function restoreDocument(): void {
    for (const [key, original] of [
      ["hidden", nativeHidden],
      ["visibilityState", nativeVisibility],
    ] as const) {
      try {
        if (original) Object.defineProperty(documentProto, key, original);
        else delete documentProto[key];
      } catch {
        // ignore
      }
    }
    try {
      if (typeof nativeHasFocus === "function") {
        Object.defineProperty(documentProto, "hasFocus", {
          configurable: true,
          writable: true,
          enumerable: false,
          value: nativeHasFocus,
        });
      }
    } catch {
      // ignore
    }
    try {
      if (nativeOnVisibility) Object.defineProperty(documentProto, "onvisibilitychange", nativeOnVisibility);
      else if (onVisibilityHandler) {
        Object.defineProperty(documentProto, "onvisibilitychange", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: onVisibilityHandler,
        });
      } else {
        delete documentProto["onvisibilitychange"];
      }
    } catch {
      // ignore
    }
  }

  /** Wraps listeners for the muted types so they are never invoked while armed. */
  function patchListeners(): void {
    eventTarget.prototype.addEventListener = function addEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (!live() || !muted.has(type) || !listener) {
        return nativeAdd.call(this, type, listener as EventListener, options);
      }
      const existing = wrapped.get(listener);
      if (existing) return nativeAdd.call(this, type, existing, options);
      const substitute: EventListener = () => undefined;
      wrapped.set(listener, substitute);
      wrapped.set(substitute, listener);
      return nativeAdd.call(this, type, substitute, options);
    };
    eventTarget.prototype.removeEventListener = function removeEventListener(
      this: EventTarget,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      const swap = listener ? wrapped.get(listener) : undefined;
      return nativeRemove.call(this, type, (swap ?? listener) as EventListener, options);
    };
  }

  function restoreListeners(): void {
    eventTarget.prototype.addEventListener = nativeAdd;
    eventTarget.prototype.removeEventListener = nativeRemove;
  }

  /**
   * `document.onvisibilitychange = fn` bypasses addEventListener, so it gets an accessor
   * of its own: the page's handler is stored and never called while armed.
   */
  function patchOnVisibility(): void {
    try {
      // Whatever the page assigned before we armed stays readable (it is simply never
      // called while armed), so disarming gives the page its handler back intact.
      if (onVisibilityHandler === null) {
        const existing = documentProto["onvisibilitychange"];
        if (typeof existing === "function") onVisibilityHandler = existing as (ev: Event) => unknown;
      }
      Object.defineProperty(documentProto, "onvisibilitychange", {
        configurable: true,
        enumerable: false,
        get() {
          return onVisibilityHandler;
        },
        set(value: unknown) {
          onVisibilityHandler = typeof value === "function" ? (value as (ev: Event) => unknown) : null;
        },
      });
    } catch {
      // ignore
    }
  }

  function patchFrames(): void {
    const timer = window.setTimeout.bind(window);
    const clear = window.clearTimeout.bind(window);
    window.requestAnimationFrame = function requestAnimationFrame(callback: FrameRequestCallback) {
      if (live() && actualHidden()) {
        frameFallback = true;
        const id = timer(() => {
          ourFrames.delete(id);
          callback(now());
        }, globals.frameMs) as unknown as number;
        ourFrames.add(id);
        return id;
      }
      return nativeRaf.call(window, callback);
    };
    window.cancelAnimationFrame = function cancelAnimationFrame(id: number) {
      if (ourFrames.has(id)) {
        ourFrames.delete(id);
        clear(id as unknown as Parameters<typeof clear>[0]);
        return;
      }
      return nativeCancelRaf.call(window, id);
    };
  }

  function restoreFrames(): void {
    for (const id of ourFrames) window.clearTimeout(id);
    ourFrames.clear();
    frameFallback = false;
    window.requestAnimationFrame = nativeRaf;
    window.cancelAnimationFrame = nativeCancelRaf;
  }

  function snapshot(): PageActivityState {
    const active = live();
    return { armed: active, actualHidden: actualHidden(), frameFallback: active ? frameFallback : false };
  }

  // Patched up front so the accessors are ours before a page can read the descriptor;
  // everything they do is a pass-through until `armed` flips.
  patchDocument();
  patchListeners();
  patchOnVisibility();
  patchFrames();

  return {
    set(enabled: boolean): PageActivityState {
      if (enabled) {
        armed = true;
        expiresAt = now() + globals.ttlMs;
        patchDocument();
        patchListeners();
        patchOnVisibility();
        patchFrames();
        return snapshot();
      }
      armed = false;
      expiresAt = 0;
      restoreFrames();
      restoreListeners();
      restoreDocument();
      return snapshot();
    },
    read(): PageActivityState {
      return snapshot();
    },
  };
}

export const IDLE_ACTIVITY_STATE = IDLE;
