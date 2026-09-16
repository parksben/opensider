// Native browser UI (JS dialogs and friends): shared types plus the policy logic.
//
// Page scripts talk to the browser through `alert` / `confirm` / `prompt` / `print` /
// `window.open` / `<input type=file>.click()`. Those calls block the page's own JS thread,
// so they are the one kind of "browser UI" a page can pop up while the Agent is driving it.
// Chrome gives extensions no API for browser chrome, but these entry points are plain page
// JS, which means a main-world shim can observe them — and, with a policy that is already
// on hand, answer them synchronously.
//
// Everything here is pure so it can be tested without a browser; the shim itself lives in
// `native-ui-hook.ts` and the service-worker side in `background.ts`.

export const NATIVE_UI_KINDS = ["alert", "confirm", "prompt", "print", "popup", "file-chooser"] as const;
export type NativeUiKind = (typeof NATIVE_UI_KINDS)[number];

/** How the hook dealt with one call. */
export type NativeUiEvent = {
  kind: NativeUiKind;
  /** Human-readable text: dialog message, prompt text, popup url, file input name. */
  message: string;
  /** Frame url the call came from. */
  url: string;
  at: number;
  /** True when we answered it instead of showing the native dialog. */
  handled?: boolean;
  /** What the page received: the user's answer when we only observed, ours when handled. */
  answer?: string | boolean | null;
  /** file-chooser: the native picker was suppressed. popup: the browser blocked it. */
  blocked?: boolean;
};

export type DialogPolicy = {
  mode: "observe" | "answer";
  /** answer mode: value handed back to `confirm`. */
  confirm: boolean;
  /** answer mode: text handed back to `prompt` ("" = accept with no text). */
  promptText: string;
  /** answer mode: dismiss `alert` without showing it (there is nothing to decide). */
  alert: "dismiss" | "observe";
  /** answer mode auto-reverts to observe after this (ms epoch). */
  expiresAt?: number;
};

export const DEFAULT_POLICY_MS = 120_000;
export const NATIVE_UI_EVENT_LIMIT = 50;
export const NATIVE_UI_HOOK_KEY = "__opensiderNativeUi";

export function defaultDialogPolicy(): DialogPolicy {
  return { mode: "observe", confirm: false, promptText: "", alert: "dismiss" };
}

/** Anything the Agent sends goes through here: unknown shapes become the safe default. */
export function normalizeDialogPolicy(raw: unknown, now: number): DialogPolicy {
  const source = (raw ?? {}) as Record<string, unknown>;
  const policy = defaultDialogPolicy();
  if (source.mode === "answer") policy.mode = "answer";
  if (typeof source.confirm === "boolean") policy.confirm = source.confirm;
  if (typeof source.promptText === "string") policy.promptText = source.promptText.slice(0, 400);
  if (source.alert === "observe") policy.alert = "observe";
  if (policy.mode === "answer") {
    const raw = source.expiresAt;
    const expires = typeof raw === "number" && Number.isFinite(raw) ? raw : now + DEFAULT_POLICY_MS;
    // Cap how long an answer policy can stay armed; a timestamp already in the past stays in
    // the past, which is how a caller turns answering back off without re-sending the mode.
    policy.expiresAt = Math.min(expires, now + 30 * 60_000);
  }
  return policy;
}

/** An answer policy stops applying once it expired, so a user's later dialogs are untouched. */
export function policyAnswers(policy: DialogPolicy, now: number): boolean {
  if (policy.mode !== "answer") return false;
  return policy.expiresAt == null || policy.expiresAt > now;
}

export type DialogDecision =
  | { handle: false }
  | { handle: true; answer: string | boolean | null };

/**
 * What the shim should do with one call. `observe` always returns `handle: false`, which is
 * what keeps us from changing page behaviour unless the Agent asked for it.
 */
export function decideDialog(policy: DialogPolicy, kind: NativeUiKind, now: number): DialogDecision {
  if (kind === "print" || kind === "popup") return { handle: false };
  if (!policyAnswers(policy, now)) return { handle: false };
  switch (kind) {
    case "alert":
      return policy.alert === "dismiss" ? { handle: true, answer: undefined as never } : { handle: false };
    case "confirm":
      return { handle: true, answer: policy.confirm };
    case "prompt":
      return { handle: true, answer: policy.promptText };
    case "file-chooser":
      // The native picker is modal and stops the page's JS thread: suppressing it is the
      // whole point, the Agent gets an event and can ask the user for a path instead.
      return { handle: true, answer: null };
    default:
      return { handle: false };
  }
}

export function truncateMessage(text: unknown, max = 300): string {
  const line = String(text ?? "").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Keep a bounded, newest-last list — the same shape the host writes to disk. */
export function pushEvent(list: NativeUiEvent[], event: NativeUiEvent, limit = NATIVE_UI_EVENT_LIMIT): NativeUiEvent[] {
  const next = [...list, event];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

export function isNativeUiKind(value: unknown): value is NativeUiKind {
  return typeof value === "string" && (NATIVE_UI_KINDS as readonly string[]).includes(value);
}

/** What the shim returns to the service worker on a pull (`getNativeUi`). */
export type NativeUiSnapshot = {
  events: NativeUiEvent[];
  policy: DialogPolicy;
  ui: {
    visibility: "visible" | "hidden" | "prerender" | "unknown";
    fullscreen: boolean;
    beforeunload: boolean;
    permissions: Record<string, string>;
  };
};

export const PERMISSION_NAMES = [
  "geolocation",
  "notifications",
  "camera",
  "microphone",
  "clipboard-read",
  "clipboard-write",
] as const;
