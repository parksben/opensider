import {
  NATIVE_UI_HOOK_KEY,
  PERMISSION_NAMES,
  decideDialog,
  defaultDialogPolicy,
  normalizeDialogPolicy,
  pushEvent,
  truncateMessage,
  type DialogPolicy,
  type NativeUiEvent,
  type NativeUiKind,
  type NativeUiSnapshot,
} from "@shared";

/**
 * Main-world shim for the browser UI a page can pop up: `alert` / `confirm` / `prompt`,
 * `print`, `window.open`, and the native file picker behind `<input type=file>`.
 *
 * Registered as a MAIN-world content script at `document_start` (manifest.config.ts), all
 * frames, so the entry points are ours before any page script calls them. Nothing is put on
 * `window` except one non-configurable, token-guarded API — a page must not be able to forge
 * dialog events (they go in front of the Agent) or to switch answering on for itself. The
 * token only ever travels through `chrome.scripting.executeScript` arguments, which the page
 * cannot see.
 *
 * Default behaviour is `observe`: the real dialog still opens, and we record both the call
 * and the answer (including the user's own answer, because a sync call returns it).
 */
(() => {
  const host = window as unknown as Record<string, unknown>;
  if (host[NATIVE_UI_HOOK_KEY]) return;

  let token = "";
  let policy: DialogPolicy = defaultDialogPolicy();
  let events: NativeUiEvent[] = [];
  const permissions: Record<string, string> = {};

  function authorized(candidate: unknown): boolean {
    if (typeof candidate !== "string" || candidate.length < 16) return false;
    if (!token) token = candidate;
    return candidate === token;
  }

  function note(kind: NativeUiKind, message: unknown, extra: Partial<NativeUiEvent> = {}): void {
    events = pushEvent(events, {
      kind,
      message: truncateMessage(message),
      url: location.href,
      at: Date.now(),
      ...extra,
    });
  }

  function refreshPermissions(): void {
    for (const name of PERMISSION_NAMES) {
      try {
        void navigator.permissions
          ?.query?.({ name: name as PermissionName })
          .then((status) => {
            permissions[name] = status.state;
          })
          .catch(() => undefined);
      } catch {
        // unsupported name on this Chrome
      }
    }
  }

  function patchFunction(holder: Record<string, unknown> | undefined, key: string, wrap: (original: AnyFn) => AnyFn): void {
    const original = holder?.[key];
    if (typeof original !== "function") return;
    try {
      holder![key] = wrap(original as AnyFn);
      restores.push({ holder: holder!, key, original });
    } catch {
      // frozen holder — leave the native function alone
    }
  }

  type Restore = { holder: Record<string, unknown>; key: string; original: unknown };
  /** Everything we wrapped, so `release` can put it back the way we found it. */
  const restores: Restore[] = [];

  type AnyFn = (...args: never[]) => unknown;
  const run = (original: AnyFn, self: unknown, args: unknown[]): unknown =>
    (original as (...a: unknown[]) => unknown).apply(self, args);

  patchFunction(window as unknown as Record<string, unknown>, "alert", (original) => {
    return function (this: unknown, ...args: unknown[]) {
      const decision = decideDialog(policy, "alert", Date.now());
      if (!decision.handle) {
        note("alert", args[0]);
        return run(original, this, args);
      }
      note("alert", args[0], { handled: true, answer: null });
      return undefined;
    };
  });

  patchFunction(window as unknown as Record<string, unknown>, "confirm", (original) => {
    return function (this: unknown, ...args: unknown[]) {
      const decision = decideDialog(policy, "confirm", Date.now());
      if (!decision.handle) {
        const answer = Boolean(run(original, this, args));
        note("confirm", args[0], { answer });
        return answer;
      }
      note("confirm", args[0], { handled: true, answer: Boolean(decision.answer) });
      return Boolean(decision.answer);
    };
  });

  patchFunction(window as unknown as Record<string, unknown>, "prompt", (original) => {
    return function (this: unknown, ...args: unknown[]) {
      const decision = decideDialog(policy, "prompt", Date.now());
      if (!decision.handle) {
        const answer = run(original, this, args);
        note("prompt", args[0], { answer: typeof answer === "string" ? truncateMessage(answer, 120) : null });
        return answer;
      }
      const text = typeof decision.answer === "string" ? decision.answer : "";
      note("prompt", args[0], { handled: true, answer: truncateMessage(text, 120) });
      return text;
    };
  });

  // print() and window.open() are never suppressed: the first opens a system surface the user
  // asked for, the second is ordinary navigation. We only record them.
  patchFunction(window as unknown as Record<string, unknown>, "print", (original) => {
    return function (this: unknown, ...args: unknown[]) {
      note("print", "window.print()");
      return run(original, this, args);
    };
  });

  patchFunction(window as unknown as Record<string, unknown>, "open", (original) => {
    return function (this: unknown, ...args: unknown[]) {
      const opened = run(original, this, args);
      const url = typeof args[0] === "string" ? String(args[0]) : "";
      note("popup", url || "window.open()", { blocked: opened == null });
      return opened;
    };
  });

  // <input type=file> opens a modal native picker and freezes the page's JS thread. In
  // answer mode we swallow the call (recording it) so the Agent can keep working and ask the
  // user for the file itself.
  for (const key of ["click", "showPicker"] as const) {
    const proto = HTMLInputElement.prototype as unknown as Record<string, unknown>;
    patchFunction(proto, key, (original) => {
      return function (this: HTMLInputElement, ...args: unknown[]) {
        if (this?.type !== "file") return run(original, this, args);
        const decision = decideDialog(policy, "file-chooser", Date.now());
        const label = this.getAttribute("name") || this.getAttribute("aria-label") || "input[type=file]";
        if (!decision.handle) {
          note("file-chooser", label);
          return run(original, this, args);
        }
        note("file-chooser", label, { handled: true, blocked: true, answer: null });
        return undefined;
      };
    });
  }

  Object.defineProperty(host, NATIVE_UI_HOOK_KEY, {
    // Configurable so `release` can take the hook back out: a tab nobody is working with
    // must look stock again (see `releasePageHooks` in background.ts).
    configurable: true,
    writable: false,
    value: {
      // Both entry points take the caller token first — the service worker calls
      // `api[method](token, ...args)`.
      setPolicy(caller: unknown, raw: unknown): DialogPolicy {
        if (!authorized(caller)) return policy;
        policy = normalizeDialogPolicy(raw, Date.now());
        return policy;
      },
      read(caller: unknown, drain = true): NativeUiSnapshot {
        const snapshot: NativeUiSnapshot = {
          events: [],
          policy,
          ui: {
            visibility: (document.visibilityState as NativeUiSnapshot["ui"]["visibility"]) ?? "unknown",
            fullscreen: Boolean(document.fullscreenElement),
            beforeunload: typeof (window as unknown as { onbeforeunload?: unknown }).onbeforeunload === "function",
            permissions: { ...permissions },
          },
        };
        if (!authorized(caller)) return snapshot;
        snapshot.events = events;
        if (drain) events = [];
        return snapshot;
      },
      /** Unwrap every entry point, forget the buffered events and drop the global. Never
       * learns a token, so only a caller that already proved itself can do it. */
      release(caller: unknown): boolean {
        if (!token || caller !== token) return false;
        for (const entry of restores.splice(0)) {
          try {
            entry.holder[entry.key] = entry.original;
          } catch {
            // ignore
          }
        }
        events = [];
        policy = defaultDialogPolicy();
        try {
          delete host[NATIVE_UI_HOOK_KEY];
        } catch {
          // ignore
        }
        return true;
      },
    },
  });

  refreshPermissions();
  document.addEventListener("visibilitychange", refreshPermissions, true);
})();
