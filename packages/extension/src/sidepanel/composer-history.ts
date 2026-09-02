import { useEffect, useState } from "react";

const STALE_HISTORY_KEYS = [
  "opensider/tab-history",
  "opensider/attachment-history",
  "cursor-sidebar/tab-history",
  "cursor-sidebar/attachment-history",
];

export type HistoryTab = {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
  seenAt: string;
};

function historyTabFromChrome(tab: chrome.tabs.Tab): HistoryTab | undefined {
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

export function useComposerHistory(): { tabs: HistoryTab[] } {
  const [tabs, setTabs] = useState<HistoryTab[]>([]);

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

    void chrome.storage.local.remove(STALE_HISTORY_KEYS);
    void refreshTabs();

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

  return { tabs };
}
