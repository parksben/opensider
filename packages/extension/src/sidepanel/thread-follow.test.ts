import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextThreadScroll, STICKY_PX, threadFollowsBottom } from "./thread-follow.ts";

describe("threadFollowsBottom", () => {
  it("follows while the pane sits at its bottom", () => {
    // 0 is the bottom in a column-reverse box; anything inside the sticky band counts.
    assert.equal(threadFollowsBottom(0), true);
    assert.equal(threadFollowsBottom(-STICKY_PX), true);
    assert.equal(threadFollowsBottom(-20), true);
  });

  it("stops following once the user scrolls up to read", () => {
    assert.equal(threadFollowsBottom(-STICKY_PX - 1), false);
    assert.equal(threadFollowsBottom(-400), false);
    assert.equal(threadFollowsBottom(-901), false);
  });

  it("follows again when the user is pinned against the far end", () => {
    // They scrolled as far up as the content allows. There is nothing more to show and no
    // reason to stop them scrolling back down.
    assert.equal(threadFollowsBottom(-901, -901), true);
    assert.equal(threadFollowsBottom(-2000, -901), true);
    // Not actually at the end: still reading, so the follow stays off.
    assert.equal(threadFollowsBottom(-400, -901), false);
  });

  it("does not read an unmeasured limit as the end", () => {
    // The bug the band exists to avoid: a limit the caller could not measure (nothing to
    // scroll, or not laid out yet) must not make every position look like "at the bottom",
    // or a user scrolling up is dragged straight back.
    assert.equal(threadFollowsBottom(-500, null), false);
    assert.equal(threadFollowsBottom(-500, 0), false);
    // At the actual bottom, with no range to scroll — still following, via the band.
    assert.equal(threadFollowsBottom(0, null), true);
    assert.equal(threadFollowsBottom(0, 0), true);
  });

  it("honours a caller-supplied sticky band", () => {
    assert.equal(threadFollowsBottom(-50, 0, 32), false);
    assert.equal(threadFollowsBottom(-32, 0, 32), true);
  });
});

describe("nextThreadScroll", () => {
  it("snaps to the bottom while following", () => {
    assert.equal(nextThreadScroll(true, 0, 0), null);
    assert.equal(nextThreadScroll(true, -420, 0), 0);
  });

  it("compensates the anchored line by its on-screen shift when not following", () => {
    assert.equal(nextThreadScroll(false, -100, 32), -68);
    // A sub-pixel shift is not worth a scroll write (and would round-trip forever).
    assert.equal(nextThreadScroll(false, -100, 0), null);
    assert.equal(nextThreadScroll(false, -100, 0.4), null);
  });
});

describe("STICKY_PX", () => {
  it("is the distance from the bottom that still counts as following", () => {
    assert.equal(STICKY_PX, 96);
  });
});
