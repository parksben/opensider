import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { promisify } from "node:util";
import { classifyPath } from "./pick.ts";

const execFileAsync = promisify(execFile);

const MAX_BASE64 = 700_000;
const MAX_EDGE = 2560;
const MAX_FILE_BYTES = 40 * 1024 * 1024;
const SIPS = "/usr/bin/sips";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
};

const BROWSER_OK = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/bmp",
  "image/x-icon",
  "image/avif",
]);

async function sipsJpeg(src: string, edge: number, quality: number): Promise<Buffer> {
  const out = join(tmpdir(), `cursor-sidebar-preview-${process.pid}-${Date.now()}.jpg`);
  try {
    await execFileAsync(
      SIPS,
      ["-s", "format", "jpeg", "-s", "formatOptions", String(quality), "-Z", String(edge), src, "--out", out],
      { timeout: 30_000 },
    );
    return readFileSync(out);
  } finally {
    try {
      unlinkSync(out);
    } catch {
      // ignore
    }
  }
}

export async function readImagePreview(path: string): Promise<{ mime: string; imageBase64: string }> {
  const item = classifyPath(path);
  if (item.kind !== "image") throw new Error("not an image");
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error("file not found");
  const size = statSync(path).size;
  if (size <= 0) throw new Error("empty file");
  if (size > MAX_FILE_BYTES) throw new Error("image is too large to preview");

  const mime = MIME[extname(path).toLowerCase()];
  const raw = readFileSync(path);
  const rawB64 = raw.toString("base64");
  if (mime && BROWSER_OK.has(mime) && rawB64.length <= MAX_BASE64) {
    return { mime, imageBase64: rawB64 };
  }
  if (!existsSync(SIPS)) throw new Error("cannot convert image for preview");

  let edge = MAX_EDGE;
  let quality = 70;
  let jpeg = await sipsJpeg(path, edge, quality);
  let encoded = jpeg.toString("base64");
  while (encoded.length > MAX_BASE64 && (edge > 640 || quality > 40)) {
    if (encoded.length > MAX_BASE64 * 1.4) edge = Math.max(640, Math.round(edge * 0.7));
    else quality = Math.max(40, quality - 10);
    jpeg = await sipsJpeg(path, edge, quality);
    encoded = jpeg.toString("base64");
  }
  if (encoded.length > MAX_BASE64) throw new Error("image is too large to preview");
  return { mime: "image/jpeg", imageBase64: encoded };
}
