import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eventCanChangeActiveTab,
  isClosedCurrentTab,
  pageSyncTargetTabId,
  resolveActiveTab,
  shouldClearCurrentPage,
  type SyncWindow,
} from "./tab-sync.ts";

const beforeClose: SyncWindow[] = [
  {
    id: 1,
    focused: true,
    tabs: [
      { id: 10, active: true, windowId: 1, url: "https://a.example", title: "A" },
      { id: 20, active: false, windowId: 1, url: "https://b.example", title: "B" },
    ],
  },
];

const afterCloseCurrent: SyncWindow[] = [
  {
    id: 1,
    focused: true,
    tabs: [{ id: 20, active: true, windowId: 1, url: "https://b.example", title: "B" }],
  },
];

describe("close current tab then Chrome activates another", () => {
  it("treats onRemoved of the current tab as an active-tab change", () => {
    assert.equal(eventCanChangeActiveTab("removed"), true);
    assert.equal(isClosedCurrentTab(10, 10), true);
    assert.equal(isClosedCurrentTab(10, 20), false);
  });

  it("resolves the replacement tab, not the closed tabId", () => {
    assert.equal(resolveActiveTab(beforeClose)?.id, 10);
    assert.equal(pageSyncTargetTabId(afterCloseCurrent), 20);
    assert.notEqual(pageSyncTargetTabId(afterCloseCurrent), 10);
  });

  it("clears current.json when it still points at the closed tab", () => {
    assert.equal(shouldClearCurrentPage(10, [20]), true);
    assert.equal(shouldClearCurrentPage(20, [20]), false);
    assert.equal(shouldClearCurrentPage(undefined, [20]), false);
  });

  it("does not drop a trailing resolve after close when onActivated never fires", () => {
    // Chrome may emit only onRemoved. The trailing debounce must re-read windows
    // and still land on B, never keep writing A.
    const closedTabId = 10;
    assert.equal(isClosedCurrentTab(closedTabId, 10), true);
    const later = pageSyncTargetTabId(afterCloseCurrent);
    assert.equal(later, 20);
    assert.equal(shouldClearCurrentPage(closedTabId, [20]), true);
  });
});

describe("other active-tab changes", () => {
  it("follows the focused window, not a stale preferred window that just closed", () => {
    const windows: SyncWindow[] = [
      {
        id: 2,
        focused: true,
        tabs: [{ id: 30, active: true, windowId: 2, url: "https://c.example", title: "C" }],
      },
    ];
    assert.equal(resolveActiveTab(windows, 1)?.id, 30);
    assert.equal(eventCanChangeActiveTab("focusChanged"), true);
    assert.equal(eventCanChangeActiveTab("replaced"), true);
    assert.equal(eventCanChangeActiveTab("moved"), true);
  });
});
