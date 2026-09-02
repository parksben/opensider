import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chromeFaviconUrl, isPanelSafeImageUrl, tabFaviconCandidates } from "./tab-favicon.ts";

const getURL = (path: string) => `chrome-extension://testid${path}`;

describe("isPanelSafeImageUrl", () => {
  it("allows schemes already in side-panel img-src", () => {
    assert.equal(isPanelSafeImageUrl("https://www.youtube.com/favicon.ico"), true);
    assert.equal(isPanelSafeImageUrl("data:image/png;base64,abc"), true);
    assert.equal(isPanelSafeImageUrl("blob:https://example.com/1"), true);
    assert.equal(isPanelSafeImageUrl("file:///tmp/icon.png"), true);
  });

  it("rejects chrome: and http favicons blocked by CSP", () => {
    assert.equal(isPanelSafeImageUrl("chrome://favicon/https://github.com"), false);
    assert.equal(isPanelSafeImageUrl("chrome://favicon2/?pageUrl=https%3A%2F%2Fgithub.com"), false);
    assert.equal(isPanelSafeImageUrl("http://example.com/favicon.ico"), false);
  });
});

describe("chromeFaviconUrl", () => {
  it("builds the MV3 _favicon URL from the page URL", () => {
    const src = chromeFaviconUrl("https://github.com/", 32, getURL);
    assert.equal(src, "chrome-extension://testid/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2F&size=32");
  });

  it("returns undefined without getURL or pageUrl", () => {
    assert.equal(chromeFaviconUrl("https://github.com/", 32, undefined), undefined);
    assert.equal(chromeFaviconUrl("", 32, getURL), undefined);
  });
});

describe("tabFaviconCandidates", () => {
  it("uses a https favIconUrl first, then _favicon", () => {
    assert.deepEqual(tabFaviconCandidates("https://github.com/", "https://github.githubassets.com/favicons/favicon.svg", getURL), [
      "https://github.githubassets.com/favicons/favicon.svg",
      "chrome-extension://testid/_favicon/?pageUrl=https%3A%2F%2Fgithub.com%2F&size=32",
    ]);
  });

  it("skips chrome:// favIconUrl and falls back to _favicon", () => {
    assert.deepEqual(tabFaviconCandidates("https://www.youtube.com/", "chrome://favicon/https://www.youtube.com/", getURL), [
      "chrome-extension://testid/_favicon/?pageUrl=https%3A%2F%2Fwww.youtube.com%2F&size=32",
    ]);
  });

  it("is empty when nothing is displayable", () => {
    assert.deepEqual(tabFaviconCandidates(undefined, "chrome://favicon/x"), []);
  });
});
