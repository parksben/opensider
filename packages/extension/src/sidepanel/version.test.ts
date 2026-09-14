import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compareVersions, isNewer } from "./version.ts";

describe("compareVersions", () => {
  it("compares dotted numbers and ignores the v prefix", () => {
    assert.equal(compareVersions("v0.3.0", "0.2.9"), 1);
    assert.equal(compareVersions("0.2.0", "v0.2.0"), 0);
    assert.equal(compareVersions("0.1", "0.1.1"), -1);
    assert.equal(compareVersions("1.0.0", "1.0"), 0);
  });

  it("treats dev and malformed values as not comparable", () => {
    assert.equal(isNewer("v0.2.0", "dev"), false);
    assert.equal(isNewer("v0.2.0", undefined), false);
    assert.equal(isNewer(undefined, "0.1.0"), false);
    assert.equal(isNewer("v0.2.0-beta.1", "0.1.0"), false);
  });
});

describe("isNewer", () => {
  it("reports only real upgrades", () => {
    assert.equal(isNewer("v0.2.0", "0.1.0"), true);
    assert.equal(isNewer("v0.2.0", "0.2.0"), false);
    assert.equal(isNewer("v0.2.0", "0.3.0"), false);
  });
});
