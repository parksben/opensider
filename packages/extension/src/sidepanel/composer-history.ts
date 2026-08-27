import type { AttachmentItem } from "@shared";
import { useCallback, useEffect, useState } from "react";
import { STATE_KEY } from "./persist";

const PREVIOUS_TAB_HISTORY_KEY = "cursor-sidebar/tab-history";
const PREVIOUS_ATTACHMENT_HISTORY_KEY = "cursor-sidebar/attachment-history";
const PREVIOUS_STATE_KEY = "cursor-sidebar/state";

export const TAB_HISTORY_KEY = "opensider/tab-history";
export const ATTACHMENT_HISTORY_KEY = "opensider/attachment-history";
export const ATTACHMENT_HISTORY_LIMIT = 50;
export const TAB_HISTORY_LIMIT = 200;

export type HistoryTab = {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  seenAt: string;
};

function tabKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

/** Prefer a live browser tab when several entries share the same URL. */
export function dedupeHistoryTabs(
  list: HistoryTab[],
  liveTabIds?: ReadonlySet<number>,
): HistoryTab[] {
  const byKey = new Map<string, HistoryTab>();
  for (const item of list) {
    const key = tabKey(item.url);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const existingLive = liveTabIds?.has(existing.tabId) ?? false;
    const incomingLive = liveTabIds?.has(item.tabId) ?? false;
    if (incomingLive && !existingLive) {
      byKey.set(key, item);
      continue;
    }
    if (existingLive && !incomingLive) continue;
    if ((item.seenAt || "") > (existing.seenAt || "")) byKey.set(key, item);
  }
  const kept = new Set(byKey.values());
  return list.filter((item) => kept.has(item)).slice(0, TAB_HISTORY_LIMIT);
}

export function mergeHistoryTab(
  list: HistoryTab[],
  incoming: HistoryTab,
  liveTabIds?: ReadonlySet<number>,
): HistoryTab[] {
  const key = tabKey(incoming.url);
  const next = list.filter((item) => tabKey(item.url) !== key);
  next.unshift(incoming);
  return dedupeHistoryTabs(next, liveTabIds);
}

export function mergeHistoryAttachments(list: AttachmentItem[], incoming: AttachmentItem[]): AttachmentItem[] {
  const next = [...list];
  for (const item of [...incoming].reverse()) {
    const index = next.findIndex((current) => current.path === item.path);
    if (index >= 0) next.splice(index, 1);
    next.unshift(item);
  }
  return next.slice(0, ATTACHMENT_HISTORY_LIMIT);
}

function isHistoryTab(value: unknown): value is HistoryTab {
  if (!value || typeof value !== "object") return false;
  const item = value as HistoryTab;
  return typeof item.url === "string" && item.url.length > 0 && typeof item.title === "string";
}

function isAttachment(value: unknown): value is AttachmentItem {
  if (!value || typeof value !== "object") return false;
  const item = value as AttachmentItem;
  return typeof item.path === "string" && typeof item.name === "string" && typeof item.kind === "string";
}

export async function loadTabHistory(): Promise<HistoryTab[]> {
  const raw = await chrome.storage.local.get([TAB_HISTORY_KEY, PREVIOUS_TAB_HISTORY_KEY]);
  const list = raw[TAB_HISTORY_KEY] ?? raw[PREVIOUS_TAB_HISTORY_KEY];
  return Array.isArray(list) ? dedupeHistoryTabs(list.filter(isHistoryTab)) : [];
}

export async function saveTabHistory(list: HistoryTab[]): Promise<void> {
  await chrome.storage.local.set({ [TAB_HISTORY_KEY]: dedupeHistoryTabs(list).slice(0, TAB_HISTORY_LIMIT) });
}

export async function loadAttachmentHistory(): Promise<AttachmentItem[]> {
  const raw = await chrome.storage.local.get([ATTACHMENT_HISTORY_KEY, PREVIOUS_ATTACHMENT_HISTORY_KEY]);
  const list = raw[ATTACHMENT_HISTORY_KEY] ?? raw[PREVIOUS_ATTACHMENT_HISTORY_KEY];
  return Array.isArray(list) ? list.filter(isAttachment) : [];
}

export async function saveAttachmentHistory(list: AttachmentItem[]): Promise<void> {
  await chrome.storage.local.set({ [ATTACHMENT_HISTORY_KEY]: list.slice(0, ATTACHMENT_HISTORY_LIMIT) });
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

export function useComposerHistory(): {
  tabs: HistoryTab[];
  attachments: AttachmentItem[];
  rememberAttachments: (items: AttachmentItem[]) => void;
} {
  const [tabs, setTabs] = useState<HistoryTab[]>([]);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    let liveTabIds = new Set<number>();

    const refreshLiveIds = async (): Promise<Set<number>> => {
      try {
        const open = await chrome.tabs.query({});
        liveTabIds = new Set(open.map((tab) => tab.id).filter((id): id is number => id != null));
      } catch {
        liveTabIds = new Set();
      }
      return liveTabIds;
    };

    const remember = (tab?: chrome.tabs.Tab) => {
      const item = tab ? historyTabFromChrome(tab) : undefined;
      if (!item) return;
      if (tab?.id != null) liveTabIds.add(tab.id);
      setTabs((current) => {
        const next = mergeHistoryTab(current, item, liveTabIds);
        void saveTabHistory(next);
        return next;
      });
    };

    void (async () => {
      const [storedTabs, storedAttachments, rawState] = await Promise.all([
        loadTabHistory(),
        loadAttachmentHistory(),
        chrome.storage.local.get([STATE_KEY, PREVIOUS_STATE_KEY]),
      ]);
      if (cancelled) return;
      const fromSessions: AttachmentItem[] = [];
      const persisted = (rawState[STATE_KEY] ?? rawState[PREVIOUS_STATE_KEY]) as
        | { sessions?: Array<{ messages?: Array<{ attachments?: AttachmentItem[] }> }> }
        | undefined;
      for (const session of persisted?.sessions ?? []) {
        for (const message of session.messages ?? []) {
          if (Array.isArray(message.attachments)) fromSessions.push(...message.attachments.filter(isAttachment));
        }
      }
      const seeded = mergeHistoryAttachments(fromSessions, storedAttachments);
      setAttachments(seeded);
      void saveAttachmentHistory(seeded);
      let next = storedTabs;
      try {
        const open = await chrome.tabs.query({});
        liveTabIds = new Set(open.map((tab) => tab.id).filter((id): id is number => id != null));
        for (const tab of open) {
          const item = historyTabFromChrome(tab);
          if (item) next = mergeHistoryTab(next, item, liveTabIds);
        }
        next = dedupeHistoryTabs(next, liveTabIds);
      } catch {
        next = dedupeHistoryTabs(next);
      }
      if (cancelled) return;
      setTabs(next);
      void saveTabHistory(next);
    })();

    const onCreated = (tab: chrome.tabs.Tab) => {
      if (tab.id != null) liveTabIds.add(tab.id);
      remember(tab);
    };
    const onUpdated = (
      _id: number,
      change: { url?: string; title?: string; favIconUrl?: string; status?: string },
      tab: chrome.tabs.Tab,
    ) => {
      if (change.url || change.title || change.favIconUrl || change.status === "complete") remember(tab);
    };
    const onActivated = (info: { tabId: number }) => {
      liveTabIds.add(info.tabId);
      void chrome.tabs.get(info.tabId).then(remember).catch(() => undefined);
    };
    const onRemoved = (tabId: number) => {
      liveTabIds.delete(tabId);
      setTabs((current) => {
        const next = dedupeHistoryTabs(current, liveTabIds);
        if (next.length === current.length && next.every((item, index) => item === current[index])) return current;
        void saveTabHistory(next);
        return next;
      });
    };

    void refreshLiveIds();
    chrome.tabs.onCreated.addListener(onCreated);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onActivated.addListener(onActivated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    return () => {
      cancelled = true;
      chrome.tabs.onCreated.removeListener(onCreated);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onActivated.removeListener(onActivated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
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
