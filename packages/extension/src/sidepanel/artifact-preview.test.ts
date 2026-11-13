import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AttachmentItem } from "@shared";
import { artifactDir, canPreviewArtifact, dirOf } from "./artifact-preview.ts";

function item(path: string, name: string, kind: AttachmentItem["kind"] = "file", missing = false): AttachmentItem {
  return { path, name, kind, missing };
}

describe("canPreviewArtifact", () => {
  it("accepts browser-renderable files", () => {
    assert.equal(canPreviewArtifact(item("/out/plan.md", "plan.md")), true);
    assert.equal(canPreviewArtifact(item("/out/report.pdf", "report.pdf")), true);
    assert.equal(canPreviewArtifact(item("/out/index.html", "index.html")), true);
    assert.equal(canPreviewArtifact(item("/out/main.go", "main.go")), true);
    assert.equal(canPreviewArtifact(item("/out/photo.png", "photo.png", "image")), true);
    assert.equal(canPreviewArtifact(item("/out/demo.mp4", "demo.mp4")), true);
    assert.equal(canPreviewArtifact(item("/out/photo.avif", "photo.avif", "image")), true);
  });

  it("rejects folders, missing files, and non-previewable types", () => {
    assert.equal(canPreviewArtifact(item("/out", "out", "folder")), false);
    assert.equal(canPreviewArtifact(item("/out/plan.md", "plan.md", "file", true)), false);
    assert.equal(canPreviewArtifact(item("/out/plan.docx", "plan.docx")), false);
    assert.equal(canPreviewArtifact(item("/out/bundle.zip", "bundle.zip")), false);
    assert.equal(canPreviewArtifact(item("/out/app.exe", "app.exe")), false);
    assert.equal(canPreviewArtifact(item("/out/photo.heic", "photo.heic", "image")), false);
    assert.equal(canPreviewArtifact(item("/out/scan.tiff", "scan.tiff", "image")), false);
    assert.equal(canPreviewArtifact(item("/out/clip.mov", "clip.mov")), false);
  });
});

describe("artifactDir", () => {
  it("uses the first live item's parent", () => {
    assert.equal(artifactDir([item("/out/a/b.md", "b.md"), item("/out/c.png", "c.png")]), "/out/a");
    assert.equal(artifactDir([item("/out/gone.md", "gone.md", "file", true), item("/out/live.md", "live.md")]), "/out");
  });

  it("opens a folder item itself", () => {
    assert.equal(artifactDir([item("/out/reports", "reports", "folder")]), "/out/reports");
  });

  it("handles windows separators and roots", () => {
    assert.equal(dirOf("C:\\out\\plan.md"), "C:\\out");
    assert.equal(artifactDir([item("C:\\out\\plan.md", "plan.md")]), "C:\\out");
    assert.equal(dirOf("C:\\plan.md"), "C:\\");
    assert.equal(dirOf("/plan.md"), "/");
  });
});
