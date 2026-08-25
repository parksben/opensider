import { extractSnapshot, runPageMethod } from "./page-api";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "page.snapshot") {
    sendResponse(extractSnapshot(message.tabId ?? -1));
    return true;
  }
  if (message?.type === "browser.command" && message.command) {
    sendResponse(runPageMethod(message.command));
    return true;
  }
  return false;
});
