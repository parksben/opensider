import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acceptHostMirror, type StateSnapshot } from "./host-mirror.ts";

/**
 * A state as the panel holds it. `messages` decides whether it "has history" (that is what
 * the recovery path keys on) and `savedAt` is what the age comparisons use.
 */
function state(savedAt: string, messages: unknown[] = [{ role: "user" }], provider = "hermes"): StateSnapshot {
  return { savedAt, sessions: [{ messages }], selectedProviderId: provider } as unknown as StateSnapshot;
}

const sessions = (messages: unknown[] = [{ role: "user" }]) => [{ messages }];

describe("acceptHostMirror", () => {
  it("refuses a mirror while a turn is running", () => {
    // The whole point: a running turn's transcript is deliberately not persisted, so any
    // mirror from disk is behind. Applying it mid-turn wipes live output and reverts the
    // agent the user just switched to.
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:10.000Z"),
        local: state("2026-11-17T09:00:00.000Z"),
        memorySessions: sessions(),
        running: 1,
        wroteAt: Date.parse("2026-11-17T09:00:00.000Z"),
        dirty: false,
      }),
      false,
    );
  });

  it("refuses a mirror we already superseded by our own write", () => {
    // A 59MB state takes seconds to land on the host; its echo can still carry the state
    // from before a switch. Newer-than-our-last-write is the only case worth applying.
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:00.000Z"),
        local: state("2026-11-17T08:00:00.000Z"),
        memorySessions: sessions(),
        running: 0,
        wroteAt: Date.parse("2026-11-17T09:00:05.000Z"),
        dirty: false,
      }),
      false,
    );
  });

  it("refuses a mirror while our own write is still in the debounce window", () => {
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:10.000Z"),
        local: state("2026-11-17T08:00:00.000Z"),
        memorySessions: sessions(),
        running: 0,
        wroteAt: Date.parse("2026-11-17T09:00:00.000Z"),
        dirty: true,
      }),
      false,
    );
  });

  it("takes a genuinely newer mirror (another window wrote it)", () => {
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:10.000Z"),
        local: state("2026-11-17T09:00:00.000Z"),
        memorySessions: sessions(),
        running: 0,
        wroteAt: Date.parse("2026-11-17T09:00:00.000Z"),
        dirty: false,
      }),
      true,
    );
  });

  it("still recovers the sessions after a reinstall", () => {
    // Fresh profile: the panel has an empty session, the host mirror carries the history.
    // This is the one thing the mirror exists for, so it must keep working even though the
    // mirror is older than the empty state the panel just wrote.
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-10T09:00:00.000Z"),
        local: state("2026-11-17T09:00:00.000Z", []),
        memorySessions: sessions([]),
        running: 0,
        wroteAt: Date.parse("2026-11-17T09:00:00.000Z"),
        dirty: false,
      }),
      true,
    );
  });

  it("ignores a mirror with no history at all", () => {
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:10.000Z", []),
        local: state("2026-11-17T09:00:00.000Z"),
        memorySessions: sessions(),
        running: 0,
        wroteAt: 0,
        dirty: false,
      }),
      false,
    );
  });

  it("applies the mirror before anything is hydrated", () => {
    assert.equal(
      acceptHostMirror({
        host: state("2026-11-17T09:00:10.000Z"),
        local: null,
        memorySessions: [],
        running: 0,
        wroteAt: 0,
        dirty: false,
      }),
      true,
    );
  });
});
