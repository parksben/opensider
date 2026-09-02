export type SyncTab = {
  id?: number;
  active?: boolean;
  windowId?: number;
  url?: string;
  title?: string;
  favIconUrl?: string;
};

export type SyncWindow = {
  id?: number;
  focused?: boolean;
  tabs?: SyncTab[];
};

export type ActiveTabEvent =
  | "activated"
  | "removed"
  | "replaced"
  | "focusChanged"
  | "updated"
  | "created"
  | "moved"
  | "attached"
  | "detached"
  | "windowCreated"
  | "windowRemoved";

/** Events that can change which tab is the browser's active tab. */
export function eventCanChangeActiveTab(event: ActiveTabEvent): boolean {
  return (
    event === "activated" ||
    event === "removed" ||
    event === "replaced" ||
    event === "focusChanged" ||
    event === "attached" ||
    event === "detached" ||
    event === "windowRemoved" ||
    event === "created" ||
    event === "moved"
  );
}

/** Pick the active tab in the focused (or preferred) normal window. */
export function resolveActiveTab(
  windows: SyncWindow[],
  preferredWindowId?: number,
): SyncTab | undefined {
  const usable = windows.filter((win) => win.id != null && (win.tabs?.length ?? 0) > 0);
  if (usable.length === 0) return undefined;

  const preferred =
    preferredWindowId != null && preferredWindowId >= 0
      ? usable.find((win) => win.id === preferredWindowId)
      : undefined;
  const focused = usable.find((win) => win.focused);
  const win = preferred ?? focused ?? usable[0];
  return win.tabs?.find((tab) => tab.active && tab.id != null) ?? win.tabs?.find((tab) => tab.id != null);
}

export function isClosedCurrentTab(currentTabId: number | undefined, removedTabId: number): boolean {
  return currentTabId != null && currentTabId === removedTabId;
}

export function shouldClearCurrentPage(
  currentTabId: number | undefined,
  openTabIds: number[],
): boolean {
  return currentTabId != null && currentTabId > 0 && !openTabIds.includes(currentTabId);
}

/** After debounce, resolve the live active tab — never reuse a just-closed event tabId. */
export function pageSyncTargetTabId(
  windows: SyncWindow[],
  preferredWindowId?: number,
): number | undefined {
  return resolveActiveTab(windows, preferredWindowId)?.id;
}
