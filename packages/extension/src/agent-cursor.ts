export const AGENT_CURSOR_ID = "opensider-agent-cursor";

const CURSOR_SIZE = 28;
const LERP = 0.2;
const SNAP = 2;
const MOVE_MS = 450;
const HIDE_MS = 1600;
const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

type Point = { x: number; y: number };

let host: HTMLElement | undefined;
let shadow: ShadowRoot | undefined;
let cursorEl: HTMLElement | undefined;
let rippleEl: HTMLElement | undefined;
let ringEl: HTMLElement | undefined;
let current: Point | undefined;
let target: Point = { x: 0, y: 0 };
let raf = 0;
let hideTimer = 0;

const STYLE = `
:host { all: initial; }
.layer { position: fixed; inset: 0; pointer-events: none; }
.ring {
  position: fixed; box-sizing: border-box; border-radius: 6px;
  border: 2px solid rgba(57, 182, 255, 0.95);
  background: rgba(189, 69, 251, 0.12);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.35), 0 8px 24px rgba(57, 182, 255, 0.25);
  opacity: 0; transition: opacity 160ms ease;
}
.ring.on { opacity: 1; }
.cursor {
  position: fixed; width: ${CURSOR_SIZE}px; height: ${CURSOR_SIZE}px;
  margin-left: -3px; margin-top: -2px; filter: drop-shadow(0 2px 6px rgba(20, 16, 40, 0.35));
  z-index: 2;
}
.ripple {
  position: absolute; left: 2px; top: 2px; width: 22px; height: 22px;
  border: 3px solid rgba(57, 182, 255, 0.95); border-radius: 50%;
  opacity: 0; transform: scale(0.2);
}
.cursor.clicking .ripple { animation: ripple 320ms ease-out forwards; }
@keyframes ripple {
  0% { transform: scale(0.2); opacity: 0.9; }
  100% { transform: scale(2.4); opacity: 0; }
}
`;

const POINTER = `
<svg viewBox="0 0 24 28" width="${CURSOR_SIZE}" height="${CURSOR_SIZE}" aria-hidden="true">
  <defs>
    <linearGradient id="os-cursor" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#39b6ff"/>
      <stop offset="100%" stop-color="#bd45fb"/>
    </linearGradient>
  </defs>
  <path d="M4.2 2.4 4.2 22.8 10.1 17.4 14.2 26.2 17.6 24.7 13.4 15.7 21.2 15.7Z"
    fill="#fff" stroke="url(#os-cursor)" stroke-width="1.7" stroke-linejoin="round"/>
</svg>
`;

export function isAgentCursorNode(node: Node | null): boolean {
  return Boolean(node instanceof Element && node.closest(`#${AGENT_CURSOR_ID}`));
}

function ensure(): void {
  if (host?.isConnected && shadow && cursorEl && ringEl && rippleEl) return;
  host?.remove();
  host = document.createElement("div");
  host.id = AGENT_CURSOR_ID;
  host.setAttribute("data-opensider-ignore", "true");
  host.setAttribute("aria-hidden", "true");
  host.style.cssText =
    "all:initial;display:block;position:fixed;inset:0;z-index:2147483645;pointer-events:none;opacity:1;transition:opacity 220ms ease;";
  shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const layer = document.createElement("div");
  layer.className = "layer";
  ringEl = document.createElement("div");
  ringEl.className = "ring";
  cursorEl = document.createElement("div");
  cursorEl.className = "cursor";
  rippleEl = document.createElement("div");
  rippleEl.className = "ripple";
  cursorEl.innerHTML = POINTER;
  cursorEl.append(rippleEl);
  layer.append(ringEl, cursorEl);
  shadow.append(style, layer);
  document.documentElement.append(host);
}

function placeCursor(point: Point): void {
  if (!cursorEl) return;
  cursorEl.style.left = `${point.x}px`;
  cursorEl.style.top = `${point.y}px`;
}

function markRing(el: HTMLElement): void {
  if (!ringEl) return;
  const box = el.getBoundingClientRect();
  ringEl.style.left = `${box.left - 3}px`;
  ringEl.style.top = `${box.top - 3}px`;
  ringEl.style.width = `${Math.max(0, box.width + 6)}px`;
  ringEl.style.height = `${Math.max(0, box.height + 6)}px`;
  ringEl.classList.add("on");
}

function scheduleHide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    ringEl?.classList.remove("on");
    if (host) host.style.opacity = "0";
  }, HIDE_MS);
}

function tick(resolve: () => void, started: number): void {
  if (!current) {
    resolve();
    return;
  }
  const nx = current.x + (target.x - current.x) * LERP;
  const ny = current.y + (target.y - current.y) * LERP;
  const done =
    Math.hypot(target.x - nx, target.y - ny) < SNAP || Date.now() - started >= MOVE_MS || REDUCED;
  current = done ? { ...target } : { x: nx, y: ny };
  placeCursor(current);
  if (done) {
    raf = 0;
    resolve();
    return;
  }
  raf = requestAnimationFrame(() => tick(resolve, started));
}

function moveTo(point: Point): Promise<void> {
  ensure();
  if (host) host.style.opacity = "1";
  if (!current) {
    current = REDUCED ? { ...point } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    placeCursor(current);
  }
  target = point;
  if (REDUCED) {
    current = { ...point };
    placeCursor(current);
    return Promise.resolve();
  }
  if (raf) cancelAnimationFrame(raf);
  return new Promise((resolve) => {
    raf = requestAnimationFrame(() => tick(resolve, Date.now()));
  });
}

function flashClick(): void {
  if (!cursorEl) return;
  cursorEl.classList.remove("clicking");
  void cursorEl.offsetWidth;
  cursorEl.classList.add("clicking");
}

export async function pointAt(el: HTMLElement, click = false): Promise<Point> {
  ensure();
  const box = el.getBoundingClientRect();
  const point = {
    x: box.left + Math.max(4, box.width / 2),
    y: box.top + Math.max(4, box.height / 2),
  };
  markRing(el);
  await moveTo(point);
  if (click) {
    flashClick();
    await new Promise((resolve) => setTimeout(resolve, REDUCED ? 40 : 140));
  }
  scheduleHide();
  return point;
}

export function hideAgentCursor(): void {
  window.clearTimeout(hideTimer);
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  host?.remove();
  host = undefined;
  shadow = undefined;
  cursorEl = undefined;
  rippleEl = undefined;
  ringEl = undefined;
  current = undefined;
}
