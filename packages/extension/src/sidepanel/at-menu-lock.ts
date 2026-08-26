/** Synchronous lock so Enter cannot send while the @ menu is open. React state is too late. */
export const atMenuLock = {
  open: false,
  suppressSubmit: false,
  lastEnter: null as Event | null,
  confirm: null as null | ((event?: Event) => void),
};

let guardInstalled = false;
let suppressTimer = 0;

export function isEnterKey(event: {
  key: string;
  code?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return false;
  return event.key === "Enter" || event.code === "Enter" || event.code === "NumpadEnter";
}

export function openAtMenuLock(): void {
  atMenuLock.open = true;
}

export function closeAtMenuLock(): void {
  atMenuLock.open = false;
  atMenuLock.confirm = null;
}

export function shouldBlockSubmit(): boolean {
  return atMenuLock.open || atMenuLock.suppressSubmit;
}

export function blockEnterEvent(event: Event): void {
  event.preventDefault();
  event.stopPropagation();
  if ("stopImmediatePropagation" in event) event.stopImmediatePropagation();
}

export function armEnterSuppress(): void {
  atMenuLock.suppressSubmit = true;
  window.clearTimeout(suppressTimer);
  suppressTimer = window.setTimeout(releaseEnterSuppress, 2000);
}

export function releaseEnterSuppress(): void {
  window.clearTimeout(suppressTimer);
  suppressTimer = 0;
  atMenuLock.suppressSubmit = false;
  atMenuLock.lastEnter = null;
}

/** Always-on window capture. Must not depend on AtMenu effect timing or React re-renders. */
export function installAtMenuGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!isEnterKey(event) || !shouldBlockSubmit()) return;
    blockEnterEvent(event);
    if (event.repeat) return;
    atMenuLock.confirm?.(event);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    if (!isEnterKey(event) || !atMenuLock.suppressSubmit) return;
    releaseEnterSuppress();
  };
  const onBlur = () => {
    if (atMenuLock.suppressSubmit) releaseEnterSuppress();
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", onBlur);
}

if (typeof window !== "undefined") installAtMenuGuard();
