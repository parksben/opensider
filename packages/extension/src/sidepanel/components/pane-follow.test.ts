import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PANE_STICKY_PX, paneFollowsBottom } from "./pane-follow.ts";

describe("paneFollowsBottom", () => {
  it("follows a pane that has nothing to scroll", () => {
    // Nothing has overflowed yet, so there is no "scrolled away" state to be in.
    assert.equal(paneFollowsBottom(400, 400, 0), true);
    assert.equal(paneFollowsBottom(100, 400, 0), true);
  });

  it("follows while the pane sits at its bottom", () => {
    assert.equal(paneFollowsBottom(900, 400, 500), true);
    // A couple of pixels off still counts: rounding in `scrollTop` should not drop it.
    assert.equal(paneFollowsBottom(900, 400, 499), true);
  });

  it("releases the follow once the user scrolls up to read", () => {
    // Far more than PANE_STICKY_PX above the bottom: they went back to read.
    assert.equal(paneFollowsBottom(900, 400, 100), false);
    assert.equal(paneFollowsBottom(900, 400, 0), false);
  });

  it("picks the follow back up when they return near the bottom", () => {
    const bottom = 500;
    const back = bottom - 20;
    assert.equal(paneFollowsBottom(900, 400, back), true);
  });

  it("keeps the sticky band small enough not to swallow a short pane", () => {
    // These panes are ~10 lines tall. 96px (the transcript's band) would cover most of
    // one, so a nudge of the scrollbar would snap straight back down.
    assert.ok(PANE_STICKY_PX < 48);
  });

  it("honours a caller-supplied band", () => {
    // distance from the bottom is 100 in both cases; only the band decides.
    assert.equal(paneFollowsBottom(900, 400, 400, 200), true);
    assert.equal(paneFollowsBottom(900, 400, 400, 100), true);
    assert.equal(paneFollowsBottom(900, 400, 400, 50), false);
    // 100 away with the default 32px band: released.
    assert.equal(paneFollowsBottom(900, 400, 400), false);
  });

  it("treats a negative distance from the bottom as still following", () => {
    // Overscroll / a pane that just got shorter can make the distance go negative.
    assert.equal(paneFollowsBottom(400, 400, -30), true);
    assert.equal(paneFollowsBottom(900, 400, 600), true);
  });
});
