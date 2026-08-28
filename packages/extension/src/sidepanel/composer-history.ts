import type { AttachmentItem } from "@shared";
import { useCallback, useEffect, useState } from "react";
import { STATE_KEY } from "./persist";

const PREVIOUS_TAB_HISTORY_KEY = "cursor-sidebar/tab-history";
const PREVIOUS_ATTACHMENT_HISTORY_KEY = "cursor-sidebar/attachment-history";
const PREVIOUS_STATE_KEY = "cursor-sidebar/state";

export const TAB_HISTORY_KEY = "opensider/tab-history";
export const ATTACHMENT_HISTORY_KEY = "opensider/attachment-history";
export const ATTACHMENT_HISTORY_LIMIT = 20;

export type HistoryTab = {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  seenAt: string;
};

export function dedupeAttachments(list: AttachmentItem[]): AttachmentItem[] {
  const seen = new Set<string>();
  const out: AttachmentItem[] = [];
  for (const item of list) {
    if (!item.path || seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
    if (out.length >= ATTACHMENT_HISTORY_LIMIT) break;
  }
  return out;
}

export function mergeHistoryAttachments(list: AttachmentItem[], incoming: AttachmentItem[]): AttachmentItem[] {
  const next = [...list];
  for (const item of [...incoming].reverse()) {
    const index = next.findIndex((current) => current.path === item.path);
    if (index >= 0) next.splice(index, 1);
    next.unshift(item);
  }
  return dedupeAttachments(next);
}

function isAttachment(value: unknown): value is AttachmentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as AttachmentItem;
  return typeof item.path === "string" && typeof item.name === "string" && typeof item.kind === "string";
}

export async function loadAttachmentHistory(): Promise<AttachmentItem[]> {
  const raw = await chrome.storage.local.get([ATTACHMENT_HISTORY_KEY, PREVIOUS_ATTACHMENT_HISTORY_KEY]);
  const list = raw[ATTACHMENT_HISTORY_KEY] ?? raw[PREVIOUS_ATTACHMENT_HISTORY_KEY];
  return Array.isArray(list) ? dedupeAttachments(list.filter(isAttachment)) : [];
}

export async function saveAttachmentHistory(list: AttachmentItem[]): Promise<void> {
  await chrome.storage.local.set({ [ATTACHMENT_HISTORY_KEY]: dedupeAttachments(list) });
}

export function historyTabFromChrome(tab: chrome.tabs.Tab): HistoryTab | undefined {
  if (tab.id == null) return undefined;
  const url = tab.url || tab.pendingUrl || "";
  if (!url) return undefined;
  return {
    tabId: tab.id,
    title: tab.title || url,
    url,
    favIconUrl: tab.favIconUrl,
    seenAt: new Date().toISOString(),
  };
}

function lastAccessed(tab: chrome.tabs.Tab): number {
  return (tab as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? 0;
}

function liveTabsFrom(open: chrome.tabs.Tab[]): HistoryTab[] {
  return open
    .slice()
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return lastAccessed(b) - lastAccessed(a);
    })
    .map(historyTabFromChrome)
    .filter((item): item is HistoryTab => item != null);
}

async function queryLiveTabs(): Promise<HistoryTab[]> {
  try {
    return liveTabsFrom(await chrome.tabs.query({ windowType: "normal" }));
  } catch {
    return [];
  }
}

export function useComposerHistory(): {
  tabs: HistoryTab[];
  attachments: AttachmentItem[];
  rememberAttachments: (items: AttachmentItem[]) => void;
} {
  const [tabs, setTabs] = useState<HistoryTab[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    const refreshTabs = async () => {
      const next = await queryLiveTabs();
      if (!cancelled) setTabs(next);
    };

    const scheduleTabs = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        void refreshTabs();
      }, 50);
    };

    void (async () => {
      void chrome.storage.local.remove([TAB_HISTORY_KEY, PREVIOUS_TAB_HISTORY_KEY]);
      const [storedAttachments, rawState] = await Promise.all([
        loadAttachmentHistory(),
        chrome.storage.local.get([STATE_KEY, PREVIOUS_STATE_KEY]),
      ]);
      if (cancelled) return;
      const fromSessions: AttachmentItem[] = [];
      const persisted = (rawState[STATE_KEY] ?? rawState[PREVIOUS_STATE_KEY]) as
        | { sessions?: Array<{ updatedAt?: string; messages?: Array<{ attachments?: AttachmentItem[] }> }> }
        | undefined;
      const sessions = [...(persisted?.sessions ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
      for (const session of sessions) {
        for (const message of [...(session.messages ?? [])].reverse()) {
          if (Array.isArray(message.attachments)) {
            fromSessions.push(...[...message.attachments].reverse().filter(isAttachment));
          }
        }
      }
      const seeded = mergeHistoryAttachments(fromSessions, storedAttachments);
      setAttachments(seeded);
      void saveAttachmentHistory(seeded);
      await refreshTabs();
    })();

    chrome.tabs.onCreated.addListener(scheduleTabs);
    chrome.tabs.onUpdated.addListener(scheduleTabs);
    chrome.tabs.onActivated.addListener(scheduleTabs);
    chrome.tabs.onRemoved.addListener(scheduleTabs);
    chrome.tabs.onReplaced.addListener(scheduleTabs);
    chrome.tabs.onAttached.addListener(scheduleTabs);
    chrome.tabs.onDetached.addListener(scheduleTabs);
    chrome.windows.onFocusChanged.addListener(scheduleTabs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      chrome.tabs.onCreated.removeListener(scheduleTabs);
      chrome.tabs.onUpdated.removeListener(scheduleTabs);
      chrome.tabs.onActivated.removeListener(scheduleTabs);
      chrome.tabs.onRemoved.removeListener(scheduleTabs);
      chrome.tabs.onReplaced.removeListener(scheduleTabs);
      chrome.tabs.onAttached.removeListener(scheduleTabs);
      chrome.tabs.onDetached.removeListener(scheduleTabs);
      chrome.windows.onFocusChanged.removeListener(scheduleTabs);
    };
  }, []);

  const rememberAttachments = useCallback((items: AttachmentItem[]) => {
    if (items.length === 0) return;
    setAttachments((current) => {
      const next = mergeHistoryAttachments(current, items);
      void saveAttachmentHistory(next);
      return next;
    });
  }, []);

  return { tabs, attachments, rememberAttachments };
}
