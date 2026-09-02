import { hideAgentCursor, isAgentCursorNode } from "./agent-cursor";
import { isPickArmed } from "./page-pick";
import { uniqueCssSelector } from "./selector";

const ROOT_ID = "opensider-picker";

let activeRequest: string | undefined;
let activeHint = "";
let startedAt = 0;
let previousCursor = "";
let host: HTMLElement | undefined;
let box: HTMLElement | undefined;
let observer: MutationObserver | undefined;

function isPickerNode(node: EventTarget | null): boolean {
  return node instanceof Node && Boolean(host && (host === node || host.contains(node)));
}

function mountParent(): Element {
  return document.fullscreenElement ?? document.documentElement;
}

function targetFromPoint(x: number, y: number): Element | undefined {
  const prev = host?.style.pointerEvents;
  if (host) host.style.pointerEvents = "none";
  const stack = document.elementsFromPoint(x, y);
  if (host) host.style.pointerEvents = prev || "auto";
  return stack.find((node) => node instanceof Element && !isPickerNode(node) && !isAgentCursorNode(node));
}

function moveHighlight(el: Element | undefined): void {
  if (!box) return;
  if (!el) {
    box.style.display = "none";
    return;
  }
  const rect = el.getBoundingClientRect();
  box.style.display = "block";
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${Math.max(0, rect.width)}px`;
  box.style.height = `${Math.max(0, rect.height)}px`;
}

function finish(payload: {
  requestId: string;
  selector?: string;
  cancelled?: boolean;
  error?: string;
}): void {
  stopPick();
  void chrome.runtime.sendMessage({ type: "page.picked", ...payload });
}

function onMove(event: PointerEvent): void {
  if (!activeRequest) return;
  moveHighlight(targetFromPoint(event.clientX, event.clientY));
}

function onClick(event: PointerEvent): void {
  if (!activeRequest) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (!isPickArmed(startedAt, Date.now())) return;
  const requestId = activeRequest;
  const el = targetFromPoint(event.clientX, event.clientY);
  if (!el || !requestId) {
    finish({ requestId: requestId ?? "", cancelled: true });
    return;
  }
  finish({ requestId, selector: uniqueCssSelector(el) });
}

function onKey(event: KeyboardEvent): void {
  if (!activeRequest) return;
  if (event.key !== "Escape") return;
  event.preventDefault();
  finish({ requestId: activeRequest, cancelled: true });
}

function onNavigate(): void {
  if (!activeRequest) return;
  mountOverlay();
}

function bind(): void {
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerdown", onClick, true);
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("yt-navigate-start", onNavigate, true);
  document.addEventListener("yt-navigate-finish", onNavigate, true);
  document.addEventListener("fullscreenchange", onNavigate);
}

function unbind(): void {
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerdown", onClick, true);
  window.removeEventListener("keydown", onKey, true);
  document.removeEventListener("yt-navigate-start", onNavigate, true);
  document.removeEventListener("yt-navigate-finish", onNavigate, true);
  document.removeEventListener("fullscreenchange", onNavigate);
}

function watchMount(): void {
  observer?.disconnect();
  const parent = host?.parentElement ?? mountParent();
  observer = new MutationObserver(() => {
    if (!activeRequest || !host) return;
    if (!host.isConnected) mountOverlay();
  });
  observer.observe(parent, { childList: true });
}

function showOverlay(layer: HTMLElement): void {
  if (document.fullscreenElement || typeof layer.showPopover !== "function") {
    layer.removeAttribute("popover");
    return;
  }
  try {
    layer.showPopover();
  } catch {
    layer.removeAttribute("popover");
  }
}

function mountOverlay(): void {
  const requestId = activeRequest;
  const hint = activeHint;
  if (!requestId) return;

  host?.remove();
  host = document.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-opensider-ignore", "true");
  host.setAttribute("popover", "manual");
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:auto;cursor:crosshair;";

  const shadow = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; display: block; position: fixed; inset: 0; cursor: crosshair; }
    .box {
      position: fixed; display: none; pointer-events: none;
      border: 2px solid #d4a054; background: rgba(212,160,84,0.16);
      border-radius: 3px; box-sizing: border-box;
    }
    .banner {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      pointer-events: none; max-width: min(90vw,28rem); padding: 8px 12px;
      border-radius: 999px; background: #14160f; color: #ece6d4;
      border: 1px solid #2c3124; font: 12px/1.4 sans-serif; text-align: center;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
    }
  `;
  box = document.createElement("div");
  box.className = "box";
  const banner = document.createElement("div");
  banner.className = "banner";
  banner.textContent = hint;
  shadow.append(style, box, banner);
  host.addEventListener("pointermove", onMove, true);
  host.addEventListener("pointerdown", onClick, true);
  mountParent().append(host);
  showOverlay(host);
  document.documentElement.style.cursor = "crosshair";
  watchMount();
}

export function stopPick(): void {
  activeRequest = undefined;
  activeHint = "";
  startedAt = 0;
  unbind();
  observer?.disconnect();
  observer = undefined;
  if (host) {
    try {
      host.hidePopover?.();
    } catch {
      // popover may already be gone
    }
    host.remove();
  }
  host = undefined;
  box = undefined;
  document.documentElement.style.cursor = previousCursor;
}

export function startPick(requestId: string, hint: string): boolean {
  if (typeof document !== "undefined" && "prerendering" in document && document.prerendering) return false;
  stopPick();
  hideAgentCursor();
  activeRequest = requestId;
  activeHint = hint;
  startedAt = Date.now();
  previousCursor = document.documentElement.style.cursor;
  mountOverlay();
  bind();
  return true;
}
