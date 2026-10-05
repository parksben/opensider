import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PANE_BOTTOM_EPSILON_PX, paneFollowsBottom } from "./pane-follow.ts";

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

  it("releases the follow the moment the user scrolls up to read", () => {
    // The old 32px band re-armed while they were still inside it, so the next streamed
    // line dragged them back down. Any real offset means they are reading.
    assert.equal(paneFollowsBottom(900, 400, 497), false);
    assert.equal(paneFollowsBottom(900, 400, 100), false);
    assert.equal(paneFollowsBottom(900, 400, 0), false);
  });

  it("picks the follow back up only at the exact bottom", () => {
    assert.equal(paneFollowsBottom(900, 400, 500), true);
    assert.equal(paneFollowsBottom(900, 400, 470), false);
  });

  it("keeps the resumption tolerance at sub-pixel scale", () => {
    // These panes print a line every few hundred milliseconds; anything wider is a tug of
    // war with the reader.
    assert.ok(PANE_BOTTOM_EPSILON_PX <= 2);
  });

  it("honours a caller-supplied epsilon", () => {
    // distance from the bottom is 100 in all of these; only the epsilon decides.
    assert.equal(paneFollowsBottom(900, 400, 400, 200), true);
    assert.equal(paneFollowsBottom(900, 400, 400, 100), true);
    assert.equal(paneFollowsBottom(900, 400, 400, 50), false);
    // 100 away with the default epsilon: released.
    assert.equal(paneFollowsBottom(900, 400, 400), false);
  });

  it("treats a negative distance from the bottom as still following", () => {
    // Overscroll / a pane that just got shorter can make the distance go negative.
    assert.equal(paneFollowsBottom(400, 400, -30), true);
    assert.equal(paneFollowsBottom(900, 400, 600), true);
  });
});
