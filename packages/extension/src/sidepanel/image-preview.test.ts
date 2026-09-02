import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bytesFromBase64Chunks,
  isAttachedImagePath,
  isPreviewBackdropClose,
  previewPointerDragged,
} from "./image-preview.ts";

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

describe("isPreviewBackdropClose", () => {
  it("closes on the mask, not the image, chrome, or a drag", () => {
    const mask = { closest: () => null };
    const image = { closest: (sel: string) => (sel === "img, .cs-preview-image" ? {} : null) };
    const icon = { closest: (sel: string) => (sel === "[data-preview-chrome]" ? {} : null) };

    assert.equal(isPreviewBackdropClose(mask as never, false), true);
    assert.equal(isPreviewBackdropClose(image as never, false), false);
    assert.equal(isPreviewBackdropClose(icon as never, false), false);
    assert.equal(isPreviewBackdropClose(mask as never, true), false);
    assert.equal(isPreviewBackdropClose(null, false), false);
  });
});

describe("previewPointerDragged", () => {
  it("ignores small jitter and flags a real drag", () => {
    assert.equal(previewPointerDragged({ x: 10, y: 10 }, 12, 11), false);
    assert.equal(previewPointerDragged({ x: 10, y: 10 }, 16, 10), true);
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
