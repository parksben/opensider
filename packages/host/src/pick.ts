import { execFile } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import type { AttachmentItem, AttachmentKind } from "../../shared/src/protocol.ts";
import { log } from "./log.ts";
import { SIDEBAR_HOME } from "./paths.ts";

const execFileAsync = promisify(execFile);

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".bmp",
  ".ico",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
  ".avif",
  ".jxl",
]);

const PICK_BIN = join(SIDEBAR_HOME, "runtime/PickFiles.app/Contents/MacOS/pick-files");

const FALLBACK_SCRIPT = `
tell application "Finder" to activate
delay 0.2
set theFiles to choose file with prompt "Select files to attach" with multiple selections allowed
set output to ""
repeat with f in theFiles
  set output to output & POSIX path of f & linefeed
end repeat
return output
`;

export function classifyPath(path: string): AttachmentItem {
  const clean = path.replace(/\/+$/, "");
  let kind: AttachmentKind = "file";
  try {
    if (statSync(clean).isDirectory()) kind = "folder";
    else if (IMAGE_EXT.has(extname(clean).toLowerCase())) kind = "image";
  } catch {
    if (IMAGE_EXT.has(extname(clean).toLowerCase())) kind = "image";
  }
  return { path: clean, name: basename(clean) || clean, kind };
}

function parsePaths(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function toItems(paths: string[]): AttachmentItem[] {
  const seen = new Set<string>();
  const items: AttachmentItem[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    items.push(classifyPath(path));
  }
  return items;
}

async function pickWithApp(): Promise<string[]> {
  const out = join(tmpdir(), `cursor-sidebar-pick-${process.pid}-${Date.now()}.txt`);
  writeFileSync(out, "");
  const started = Date.now();
  try {
    log(`file pick exec ${PICK_BIN}`);
    await execFileAsync(PICK_BIN, [out], { timeout: 0 });
    const paths = parsePaths(readFileSync(out, "utf8"));
    log(`file pick app done ms=${Date.now() - started} count=${paths.length}`);
    if (paths.length === 0 && Date.now() - started < 400) {
      throw new Error("picker exited before a panel could appear");
    }
    return paths;
  } finally {
    try {
      unlinkSync(out);
    } catch {
      // ignore
    }
  }
}

async function pickWithFinder(): Promise<string[]> {
  log("file pick fallback Finder choose file");
  const { stdout } = await execFileAsync("/usr/bin/osascript", ["-e", FALLBACK_SCRIPT], {
    timeout: 0,
    maxBuffer: 2 * 1024 * 1024,
  });
  return parsePaths(stdout);
}

export async function pickLocalPaths(): Promise<{ items: AttachmentItem[]; cancelled: boolean }> {
  try {
    const paths = existsSync(PICK_BIN) ? await pickWithApp() : await pickWithFinder();
    if (paths.length === 0) return { items: [], cancelled: true };
    return { items: toItems(paths), cancelled: false };
  } catch (first) {
    log(`file pick primary failed: ${String(first)}`);
    try {
      const paths = await pickWithFinder();
      if (paths.length === 0) return { items: [], cancelled: true };
      return { items: toItems(paths), cancelled: false };
    } catch (error) {
      const err = error as { code?: number | string; stderr?: string; message?: string };
      const detail = `${err.stderr ?? ""} ${err.message ?? ""}`;
      if (err.code === 1 || /(-128|user canceled|cancelled)/i.test(detail)) {
        return { items: [], cancelled: true };
      }
      log(`file pick failed: ${detail.trim()}`);
      throw error;
    }
  }
}
