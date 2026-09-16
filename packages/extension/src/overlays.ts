import {
  judgeOverlay,
  type OverlayProbe,
  type OverlayReport,
  type OverlaySnapshot,
} from "@shared";

/**
 * Page-level overlays, DOM side.
 *
 * The rules live in `@shared/overlays` (pure, unit tested); this file only gathers the
 * candidates: visible elements with dialog-ish roles/attributes, floating layers high
 * enough and large enough to be a layer rather than page chrome, open shadow roots and
 * same-origin frames included.
 */

// --- DOM side ---------------------------------------------------------------------------

const MAX_OVERLAYS = 8;

function displayed(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) {
    return false;
  }
  const box = el.getBoundingClientRect();
  return box.width >= 2 && box.height >= 2;
}

function probeOf(el: HTMLElement): OverlayProbe {
  const style = window.getComputedStyle(el);
  const box = el.getBoundingClientRect();
  const viewport = Math.max(1, window.innerWidth * window.innerHeight);
  const role = el.getAttribute("role") ?? (el.tagName.toLowerCase() === "dialog" ? "dialog" : null);
  return {
    tag: el.tagName,
    role,
    ariaModal: el.getAttribute("aria-modal") === "true",
    dialogOpen: el.hasAttribute("open"),
    position: style.position,
    zIndex: Number.parseInt(style.zIndex, 10) || 0,
    width: box.width,
    height: box.height,
    coverage: Math.min(1, (box.width * box.height) / viewport),
  };
}

function labelOf(el: HTMLElement): string {
  const labelled = el.getAttribute("aria-label") ?? el.getAttribute("aria-labelledby") ?? "";
  if (labelled.trim()) return labelled.trim().slice(0, 120);
  const heading = el.querySelector("h1, h2, h3, [role=heading]");
  const text = (heading?.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.slice(0, 120);
}

function textOf(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** True when the page behind the overlay has been taken out of play. */
function backgroundInert(el: HTMLElement): boolean {
  const parent = el.parentElement ?? document.body;
  if (parent.hasAttribute("inert") || parent.getAttribute("aria-hidden") === "true") return true;
  return Boolean(document.querySelector("body > [inert], body > [aria-hidden='true']"));
}

/** Visible modal / floating layers, covering open shadow roots and same-origin frames. */
export function collectOverlays(root: Document = document): OverlaySnapshot {
  const overlays: OverlayReport[] = [];
  const seen = new Set<string>();
  const walk = (scope: Document | ShadowRoot) => {
    for (const node of scope.querySelectorAll<HTMLElement>("*")) {
      if (overlays.length >= MAX_OVERLAYS) return;
      // Our own cursor and picker layers live in closed shadows, but be explicit anyway.
      if (node.closest("#opensider-agent-cursor, #opensider-picker")) continue;
      if (!displayed(node)) continue;
      const probe = probeOf(node);
      const verdict = judgeOverlay(probe);
      if (!verdict.overlay) continue;
      const key = `${probe.tag}|${verdict.reason}|${Math.round(probe.width ?? 0)}x${Math.round(probe.height ?? 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      overlays.push({
        role: (node.getAttribute("role") ?? node.tagName.toLowerCase()).slice(0, 40),
        label: labelOf(node),
        text: textOf(node),
        zIndex: probe.zIndex ?? 0,
        coverage: Math.round((probe.coverage ?? 0) * 100) / 100,
        modal: verdict.modal,
        backgroundInert: backgroundInert(node),
        at: Date.now(),
      });
    }
    for (const node of scope.querySelectorAll<HTMLElement>("*")) {
      if (node.shadowRoot) walk(node.shadowRoot);
    }
  };
  walk(root);
  // Same-origin iframes (a modal often lives inside one).
  for (const frame of Array.from(root.querySelectorAll("iframe"))) {
    try {
      const inner = frame.contentDocument;
      if (inner?.documentElement) walk(inner);
    } catch {
      // cross-origin: not readable, skip
    }
  }
  overlays.sort((a, b) => b.coverage - a.coverage || b.zIndex - a.zIndex);
  return { overlays: overlays.slice(0, MAX_OVERLAYS), modal: overlays.some((item) => item.modal) };
}
