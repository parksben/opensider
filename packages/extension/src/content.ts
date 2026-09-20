import type { BrowserCommand, BrowserCommandArgs } from "@shared";
import { createControlMark } from "./control-badge";
import { extractSnapshot, measureTarget, measureViewport, runPageMethod } from "./page-api";
import { PAGE_PICK_API } from "./page-pick";
import { startPick, stopPick } from "./picker";
import { acceptSelectionResult, setSelectionGate, startSelectionToolbar } from "./selection-toolbar";

const controlMark = createControlMark(document);

const pageApi = {
  ping: () => true,
  startPick: (requestId: unknown, hint: unknown) =>
    startPick(String(requestId ?? ""), String(hint || "Click an element on the page")),
  stopPick: () => {
    stopPick();
    return true;
  },
  snapshot: (tabId: unknown) => extractSnapshot(Number(tabId ?? -1)),
  viewport: () => measureViewport(),
  measure: (args: unknown) => measureTarget((args ?? {}) as BrowserCommandArgs),
  runCommand: (command: unknown) => runPageMethod(command as BrowserCommand),
  setControlBadge: (on: unknown) => controlMark.set(Boolean(on)),
};

(globalThis as unknown as Record<string, typeof pageApi>)[PAGE_PICK_API] = pageApi;

function isPrerenderDocument(): boolean {
  return typeof document !== "undefined" && "prerendering" in document && Boolean(document.prerendering);
}

// 划词工具条：门控（侧栏开着 + Agent 就绪）由 service worker 算，这里只缓存结果；文案语言
// 直接读侧栏持久化的那份状态（不把面板的 i18n 整个拖进内容脚本——它跑在每个页面上）。
void chrome.storage.local
  .get("opensider/state")
  .then((stored) => {
    const locale = (stored?.["opensider/state"] as { locale?: unknown } | undefined)?.locale;
    startSelectionToolbar(locale === "zh" ? "zh" : "en");
  })
  .catch(() => startSelectionToolbar("en"));
chrome.runtime
  .sendMessage({ type: "selection.gate.get" })
  .then((reply: { enabled?: boolean } | undefined) => setSelectionGate(reply?.enabled === true))
  .catch(() => setSelectionGate(false));

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "selection.gate") {
    setSelectionGate(message.enabled === true);
    sendResponse({ ok: true });
    return true;
  }
  if (
    message?.type === "selection.delta" ||
    message?.type === "selection.done" ||
    message?.type === "selection.failed"
  ) {
    acceptSelectionResult(message);
    sendResponse({ ok: true });
    return true;
  }
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
