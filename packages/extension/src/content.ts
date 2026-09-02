import { extractSnapshot, measureTarget, measureViewport, runPageMethod } from "./page-api";
import { PAGE_PICK_API } from "./page-pick";
import { startPick, stopPick } from "./picker";

const pageApi = {
  ping: () => true,
  startPick: (requestId: unknown, hint: unknown) =>
    startPick(String(requestId ?? ""), String(hint || "Click an element on the page")),
  stopPick: () => {
    stopPick();
    return true;
  },
};

(globalThis as unknown as Record<string, typeof pageApi>)[PAGE_PICK_API] = pageApi;

function isPrerenderDocument(): boolean {
  return typeof document !== "undefined" && "prerendering" in document && Boolean(document.prerendering);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.ping") {
    sendResponse({ ok: !isPrerenderDocument() });
    return true;
  }
  if (message?.type === "page.pick") {
    if (isPrerenderDocument()) {
      sendResponse({ ok: false, error: "prerender" });
      return true;
    }
    startPick(String(message.requestId ?? ""), String(message.hint ?? "Click an element on the page"));
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "page.pick.cancel") {
    stopPick();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "page.snapshot") {
    sendResponse(extractSnapshot(message.tabId ?? -1));
    return true;
  }
  if (message?.type === "page.viewport") {
    sendResponse({ ok: true, rect: measureViewport() });
    return true;
  }
  if (message?.type === "page.measure") {
    try {
      sendResponse({ ok: true, rect: measureTarget(message.args ?? {}) });
    } catch (error) {
      sendResponse({ ok: false, error: String(error) });
    }
    return true;
  }
  if (message?.type === "browser.command" && message.command) {
    void runPageMethod(message.command).then(sendResponse);
    return true;
  }
  return false;
});
