import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextBodyPin, nextThreadScroll, STICKY_PX } from "./thread-follow.ts";

describe("nextBodyPin", () => {
  it("pins the body on the first measurement and raises the pin as it grows", () => {
    // No pin yet: this measurement becomes the pin, whatever it says.
    assert.equal(nextBodyPin(null, 200, true), 200);
    assert.equal(nextBodyPin(null, 200, false), 200);
    // Growing mid-turn raises the pin, so the reserve covers the new content.
    assert.equal(nextBodyPin(200, 500, false), 500);
    assert.equal(nextBodyPin(500, 620, true), 620);
  });

  it("keeps a shrink to itself mid-turn, so a half-applied repaint cannot lose the reserve", () => {
    // Streaming only ever grows the body; a smaller measurement there is transient.
    assert.equal(nextBodyPin(800, 300, false), 800);
    assert.equal(nextBodyPin(800, 799, false), 800);
  });

  it("drops the pin entirely once the turn is over, so the fold leaves no blank gap", () => {
    // The turn ended and every reasoning / tool step collapsed into one line: the body is
    // now much shorter. Dropping the pin (not re-pinning to the smaller height) is what
    // keeps the list from ending in empty space — the measured height comes from a
    // subtree `content-visibility` may still be skipping, so it can read high.
    assert.equal(nextBodyPin(1200, 340, true), null);
    assert.equal(nextBodyPin(1200, 1200, true), null);
    assert.equal(nextBodyPin(1200, 0, true), null);
  });

  it("stays unpinned when the body is gone or has not laid out", () => {
    assert.equal(nextBodyPin(null, 0, true), null);
    assert.equal(nextBodyPin(null, 0, false), null);
    assert.equal(nextBodyPin(400, 0, true), null);
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
