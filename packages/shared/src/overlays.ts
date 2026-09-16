/**
 * Page-level overlays: the modal / drawer / popup layers a site puts up *itself*.
 *
 * These are not browser dialogs (that is `native-ui-hook.ts`'s job), but they are the
 * reason an Agent concludes "the button did nothing": the click worked, and the result came
 * up as a layer on top of the page. Detection lives here so the Agent can be told about it
 * right after an action, and can ask any time.
 *
 * The decision itself is a pure function of a few style/attribute facts, so it can be unit
 * tested; `collectOverlays` is the DOM glue.
 */

export type OverlayProbe = {
  tag: string;
  role?: string | null;
  ariaModal?: boolean;
  dialogOpen?: boolean;
  position?: string | null;
  zIndex?: number;
  width?: number;
  height?: number;
  /** How much of the viewport the element covers (0..1). */
  coverage?: number;
};

export type OverlayVerdict = {
  overlay: boolean;
  /** Almost certainly a modal layer rather than a small floating panel. */
  modal: boolean;
  reason: string;
};

export type OverlayReport = {
  role: string;
  label: string;
  text: string;
  zIndex: number;
  /** Fraction of the viewport covered (0..1, rounded to two decimals downstream). */
  coverage: number;
  modal: boolean;
  /** True when the rest of the page looks disabled behind it. */
  backgroundInert: boolean;
  at: number;
};

export type OverlaySnapshot = {
  overlays: OverlayReport[];
  /** True when at least one overlay is a modal layer. */
  modal: boolean;
};

/** Floating layers at or above this z-index are candidates; below is ordinary page chrome. */
export const OVERLAY_MIN_Z_INDEX = 100;
/** A floating layer has to cover this much of the viewport to count as an overlay. */
export const OVERLAY_MIN_COVERAGE = 0.2;
/** …and this much to read as a modal one. */
export const MODAL_MIN_COVERAGE = 0.6;

const MODAL_ROLES = new Set(["dialog", "alertdialog"]);

/**
 * Decides whether one candidate element is an overlay. Attributes and geometry only —
 * no DOM access, so it is cheap to test exhaustively.
 */
export function judgeOverlay(probe: OverlayProbe): OverlayVerdict {
  const role = (probe.role ?? "").toLowerCase();
  if (MODAL_ROLES.has(role)) {
    return { overlay: true, modal: true, reason: `role=${role}` };
  }
  if (probe.ariaModal) {
    return { overlay: true, modal: true, reason: "aria-modal" };
  }
  if (probe.tag.toLowerCase() === "dialog" && probe.dialogOpen) {
    return { overlay: true, modal: true, reason: "dialog[open]" };
  }
  const floating = probe.position === "fixed" || probe.position === "absolute";
  const coverage = probe.coverage ?? 0;
  const zIndex = probe.zIndex ?? 0;
  if (floating && zIndex >= OVERLAY_MIN_Z_INDEX && coverage >= OVERLAY_MIN_COVERAGE) {
    return {
      overlay: true,
      modal: coverage >= MODAL_MIN_COVERAGE,
      reason: `${probe.position} z=${zIndex} coverage=${coverage.toFixed(2)}`,
    };
  }
  return { overlay: false, modal: false, reason: "not a layer" };
}

/** Short, stable description of an overlay set, for "did anything change?" checks. */
export function overlaySignature(snapshot: OverlaySnapshot): string {
  return snapshot.overlays
    .map((item) => `${item.role}|${item.label}|${Math.round(item.coverage * 100)}`)
    .sort()
    .join("\n");
}

