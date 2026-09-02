import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bytesFromBase64Chunks, isAttachedImagePath } from "./image-preview.ts";

describe("isAttachedImagePath", () => {
  it("accepts local absolute paths only", () => {
    assert.equal(isAttachedImagePath("/Users/me/shot.png"), true);
    assert.equal(isAttachedImagePath("C:\\Users\\me\\shot.png"), true);
    assert.equal(isAttachedImagePath("C:/Users/me/shot.png"), true);
  });

  it("rejects urls, relative paths, and empty", () => {
    assert.equal(isAttachedImagePath(""), false);
    assert.equal(isAttachedImagePath("shot.png"), false);
    assert.equal(isAttachedImagePath("https://example.com/a.png"), false);
    assert.equal(isAttachedImagePath("file:///tmp/a.png"), false);
    assert.equal(isAttachedImagePath("html > body > img"), false);
  });
});

describe("bytesFromBase64Chunks", () => {
  it("decodes independently encoded chunks", () => {
    const raw = new TextEncoder().encode("hello-preview");
    const mid = Math.ceil(raw.length / 2);
    const chunks = [raw.slice(0, mid), raw.slice(mid)].map((part) => Buffer.from(part).toString("base64"));
    const bytes = bytesFromBase64Chunks(chunks);
    assert.equal(new TextDecoder().decode(bytes), "hello-preview");
  });
});
