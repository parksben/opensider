import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FOLLOW_EPSILON_PX, STICKY_PX, atThreadBottom } from "./thread-follow.ts";

describe("atThreadBottom", () => {
  it("counts the exact bottom and sub-pixel wobble as the bottom", () => {
    // 0 is the bottom in a column-reverse box; a fractional offset is layout noise.
    assert.equal(atThreadBottom(0), true);
    assert.equal(atThreadBottom(-1.5), true);
    assert.equal(atThreadBottom(0.5), true);
  });

  it("counts any real scroll-up as leaving the bottom", () => {
    // The bug this replaced: a 96px band re-armed the follow while the reader was still
    // inside it, so the next chunk snapped them back. The wheel wins outright now.
    assert.equal(atThreadBottom(-3), false);
    assert.equal(atThreadBottom(-50), false);
    assert.equal(atThreadBottom(-241), false);
    assert.equal(atThreadBottom(-4096), false);
  });

  it("honours a caller-supplied epsilon", () => {
    assert.equal(atThreadBottom(-30, 32), true);
    assert.equal(atThreadBottom(-33, 32), false);
    assert.equal(atThreadBottom(-2, 2), true);
    assert.equal(atThreadBottom(-3, 2), false);
  });
});

describe("panel constants", () => {
  it("resumes the follow only at an exact bottom", () => {
    assert.equal(FOLLOW_EPSILON_PX, 2);
  });

  it("keeps the 96px margin the panel uses for the jump-to-bottom affordance", () => {
    assert.equal(STICKY_PX, 96);
  });
});
