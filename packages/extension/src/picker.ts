import { hideAgentCursor, isAgentCursorNode } from "./agent-cursor";
import { uniqueCssSelector } from "./selector";

const ROOT_ID = "opensider-picker";
const HIGHLIGHT_ID = "opensider-picker-box";
const BANNER_ID = "opensider-picker-banner";

let activeRequest: string | undefined;
let previousCursor = "";

function root(): HTMLElement | null {
  return document.getElementById(ROOT_ID);
}

function isPickerNode(node: EventTarget | null): boolean {
  return node instanceof Node && Boolean(root()?.contains(node));
}

function targetFromPoint(x: number, y: number): Element | undefined {
  const stack = document.elementsFromPoint(x, y);
  return stack.find(
    (node) => node instanceof Element && !isPickerNode(node) && !isAgentCursorNode(node),
  );
}

function moveHighlight(el: Element | undefined): void {
  const box = document.getElementById(HIGHLIGHT_ID);
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

export function stopPick(): void {
  activeRequest = undefined;
  document.removeEventListener("pointermove", onMove, true);
  document.removeEventListener("pointerdown", onClick, true);
  document.removeEventListener("keydown", onKey, true);
  root()?.remove();
  document.documentElement.style.cursor = previousCursor;
}

export function startPick(requestId: string, hint: string): void {
  stopPick();
  hideAgentCursor();
  activeRequest = requestId;

  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483646;pointer-events:none;";

  const box = document.createElement("div");
  box.id = HIGHLIGHT_ID;
  box.style.cssText =
    "position:fixed;display:none;pointer-events:none;border:2px solid #d4a054;background:rgba(212,160,84,0.16);border-radius:3px;box-sizing:border-box;";

  const banner = document.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = hint;
  banner.style.cssText =
    "position:fixed;top:12px;left:50%;transform:translateX(-50%);pointer-events:none;max-width:min(90vw,28rem);padding:8px 12px;border-radius:999px;background:#14160f;color:#ece6d4;border:1px solid #2c3124;font:12px/1.4 sans-serif;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,0.35);";

  host.append(box, banner);
  document.documentElement.append(host);
  previousCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";

  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("pointerdown", onClick, true);
  document.addEventListener("keydown", onKey, true);
}
