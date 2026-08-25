import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AttachmentItem } from "../../shared/src/protocol.ts";
import { PASTED_DIR } from "./paths.ts";

const MAX_BASE64 = 800_000;

export function savePastedJpeg(imageBase64: string, suggestedName?: string): AttachmentItem {
  if (!imageBase64 || imageBase64.length > MAX_BASE64) {
    throw new Error("pasted image is empty or too large");
  }
  mkdirSync(PASTED_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const raw = basename(suggestedName || `paste-${stamp}.jpg`);
  const safe = raw.replace(/[^A-Za-z0-9._-]/g, "-") || `paste-${stamp}.jpg`;
  const name = /\.jpe?g$/i.test(safe) ? safe : `${safe}.jpg`;
  let path = join(PASTED_DIR, name);
  if (existsSync(path)) path = join(PASTED_DIR, `paste-${stamp}.jpg`);
  writeFileSync(path, Buffer.from(imageBase64, "base64"));
  return { path, name: basename(path), kind: "image" };
}
