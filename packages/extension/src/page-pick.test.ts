import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isPickablePageUrl,
  isPickArmed,
  isRestrictedUrl,
  pickFailureCode,
  PICK_ARM_MS,
} from "./page-pick.ts";

describe("YouTube and other http(s) pages are pickable", () => {
  it("does not treat YouTube watch / share / embed hosts as restricted system pages", () => {
    const urls = [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ&t=12s",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ];
    for (const url of urls) {
      assert.equal(isRestrictedUrl(url), false, url);
      assert.equal(isPickablePageUrl(url), true, url);
    }
  });

  it("still blocks real system and store pages", () => {
    assert.equal(isRestrictedUrl("chrome://extensions"), true);
    assert.equal(isPickablePageUrl("chrome://extensions"), false);
    assert.equal(isRestrictedUrl("chrome-extension://abcdef/sidepanel.html"), true);
    assert.equal(isPickablePageUrl("https://chromewebstore.google.com/detail/foo"), false);
    assert.equal(isPickablePageUrl("https://microsoftedge.microsoft.com/addons/detail/foo"), false);
  });

  it("does not treat a missing URL as a blocked system page", () => {
    assert.equal(isRestrictedUrl(undefined), false);
    assert.equal(isRestrictedUrl(""), false);
    assert.equal(isPickablePageUrl(undefined), false);
  });
});

describe("pick arming and failure codes", () => {
  it("ignores clicks during the arm window", () => {
    assert.equal(isPickArmed(1000, 1000 + PICK_ARM_MS - 1), false);
    assert.equal(isPickArmed(1000, 1000 + PICK_ARM_MS), true);
  });

  it("maps injection / no-receiver failures to a stable inject code", () => {
    assert.equal(pickFailureCode("Could not establish connection. Receiving end does not exist."), "inject");
    assert.equal(pickFailureCode("Error: Cannot access contents of the page"), "inject");
    assert.equal(pickFailureCode("not injected"), "inject");
    assert.equal(pickFailureCode("restricted"), "restricted");
    assert.equal(pickFailureCode("something else"), "something else");
  });
});
