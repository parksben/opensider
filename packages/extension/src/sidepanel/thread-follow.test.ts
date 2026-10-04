import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nextBodyPin, nextThreadScroll, STICKY_PX } from "./thread-follow.ts";

describe("nextBodyPin", () => {
  it("raises the pin as the transcript grows", () => {
    assert.equal(nextBodyPin(200, 500, true), 500);
    assert.equal(nextBodyPin(500, 620, false), 620);
  });

  it("keeps a shrink to itself mid-turn, so a half-applied repaint cannot lose the reserve", () => {
    // Streaming only ever grows the body; a smaller measurement there is transient.
    assert.equal(nextBodyPin(800, 300, false), 800);
    assert.equal(nextBodyPin(800, 799, false), 800);
  });

  it("releases the pin once the turn is over, so the fold leaves no blank gap", () => {
    // The turn ended and every reasoning / tool step collapsed into one line: the body is
    // now much shorter and the pin has to follow it, or the list ends with empty space.
    assert.equal(nextBodyPin(1200, 340, true), 340);
    assert.equal(nextBodyPin(1200, 1200, true), 1200);
  });

  it("drops the pin entirely when the body is gone", () => {
    assert.equal(nextBodyPin(1200, 0, true), 0);
    // Nothing pinned yet: a zero measurement must not start a pin of its own.
    assert.equal(nextBodyPin(0, 0, true), 0);
    assert.equal(nextBodyPin(0, 0, false), 0);
  });

  it("keeps a shrink from an unpinned body unpinned", () => {
    assert.equal(nextBodyPin(0, 400, true), 400);
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
