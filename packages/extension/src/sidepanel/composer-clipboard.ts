import type { AttachmentItem } from "@shared";

/**
 * Carrying the composer's attachments alongside a copy/cut of the whole composer.
 *
 * The payload deliberately does **not** ride on the clipboard: Chromium only persists a
 * small whitelist of flavours (text/plain, text/html, image/png…) on the system clipboard,
 * so a custom MIME type is gone the moment the paste happens in another document — and it
 * would leak internal markers into other apps. Instead the extension remembers
 * `{text, attachments}` for a short while and restores the attachments when a paste brings
 * back exactly that text: copy the whole composer, paste it into another session, and the
 * files come with it.
 *
 * The DOM-free half lives here so it can be unit tested; the "is everything selected?"
 * check and the storage glue sit with the composer.
 */

export const COMPOSER_CARRY_VERSION = 1;
/** Long enough to switch sessions, short enough that a stale copy cannot surprise anyone. */
export const COMPOSER_CARRY_TTL_MS = 90_000;
/** Enough for any sane draft; also keeps a corrupt store from ballooning state. */
export const MAX_CARRIED_ATTACHMENTS = 50;

/** Kept local so this module stays dependency-free for the Node tests; the test asserts it
 * matches the shared protocol's list. */
export const COMPOSER_ATTACHMENT_KINDS = ["image", "file", "folder", "element"] as const;

export type ComposerCarry = {
  text: string;
  attachments: AttachmentItem[];
  /** When it was remembered (`Date.now()`), for the TTL check. */
  at: number;
};

function isAttachment(value: unknown): value is AttachmentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AttachmentItem>;
  return (
    typeof item.path === "string" &&
    item.path.length > 0 &&
    typeof item.name === "string" &&
    (COMPOSER_ATTACHMENT_KINDS as readonly string[]).includes(String(item.kind))
  );
}

/** Whitespace/NBSP-insensitive text, so "selected everything" and paste comparisons are stable. */
export function normalizeComposerText(value: string): string {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

export function encodeComposerCarry(carry: ComposerCarry): string {
  return JSON.stringify({
    v: COMPOSER_CARRY_VERSION,
    at: carry.at,
    text: carry.text,
    attachments: carry.attachments.slice(0, MAX_CARRIED_ATTACHMENTS).map((item) => ({
      path: item.path,
      name: item.name,
      kind: item.kind,
    })),
  });
}

/** Reads a stored payload back; anything unexpected yields undefined rather than an error. */
export function decodeComposerCarry(raw: string | null | undefined): ComposerCarry | undefined {
  if (!raw) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const payload = parsed as { v?: unknown; at?: unknown; text?: unknown; attachments?: unknown };
  if (payload.v !== COMPOSER_CARRY_VERSION) return undefined;
  if (typeof payload.at !== "number" || typeof payload.text !== "string") return undefined;
  if (!Array.isArray(payload.attachments)) return undefined;
  const attachments = payload.attachments.filter(isAttachment).slice(0, MAX_CARRIED_ATTACHMENTS);
  if (attachments.length === 0) return undefined;
  return { at: payload.at, text: payload.text, attachments };
}

/**
 * Whether a paste should restore the carried attachments: same text, and recent enough that
 * it is plainly the copy the user just made (not a coincidence hours later).
 */
export function composerCarryMatches(
  carry: ComposerCarry | undefined,
  pastedText: string,
  now: number,
): boolean {
  if (!carry || carry.attachments.length === 0) return false;
  if (now - carry.at > COMPOSER_CARRY_TTL_MS || now < carry.at) return false;
  // An attachments-only draft carries empty text; only a paste that brought nothing at all
  // can match that, so image pastes and plain text pastes never trip it.
  return normalizeComposerText(pastedText) === normalizeComposerText(carry.text);
}

/** Appends what is not there yet, by path (the same rule the composer uses everywhere). */
export function mergeAttachmentItems(
  current: AttachmentItem[],
  incoming: AttachmentItem[],
): AttachmentItem[] {
  const seen = new Set(current.map((item) => item.path));
  return [...current, ...incoming.filter((item) => !seen.has(item.path))];
}

/**
 * True when the selection covers the editor's whole content.
 *
 * Compares *rendered* text on both sides (a chip renders as its file name in the editor and
 * in the selection alike) rather than range boundaries: Cmd+A inside a contenteditable
 * selects the text, which does not line up with `selectNodeContents(editor)`'s boundary
 * points, so boundary comparison rejects a genuine select-all. The containment check still
 * keeps a page-wide select-all out.
 */
export function coversWholeEditor(selection: Selection | null, editor: HTMLElement): boolean {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return false;
  const selected = normalizeComposerText(selection.toString());
  const whole = normalizeComposerText(editor.innerText ?? "");
  return selected === whole && (whole.length > 0 || editor.textContent === "");
}
