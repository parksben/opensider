import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { basename, extname } from "node:path";
import { promisify } from "node:util";
import type { AttachmentItem, AttachmentKind } from "../../shared/src/protocol.ts";

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

const PICK_SCRIPT = `
ObjC.import("AppKit");
var app = $.NSApplication.sharedApplication;
app.setActivationPolicy($.NSApplicationActivationPolicyAccessory);
app.activateIgnoringOtherApps(true);
var panel = $.NSOpenPanel.openPanel;
panel.setCanChooseFiles(true);
panel.setCanChooseDirectories(true);
panel.setAllowsMultipleSelection(true);
panel.setCanCreateDirectories(false);
panel.setResolvesAliases(true);
var code = panel.runModal();
if (code != $.NSModalResponseOK) {
  // cancelled
} else {
  var urls = panel.URLs;
  var n = urls.count;
  for (var i = 0; i < n; i++) {
    console.log(ObjC.unwrap(urls.objectAtIndex(i).path));
  }
}
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

export async function pickLocalPaths(): Promise<{ items: AttachmentItem[]; cancelled: boolean }> {
  try {
    const { stdout } = await execFileAsync("osascript", ["-l", "JavaScript", "-e", PICK_SCRIPT], {
      timeout: 0,
      maxBuffer: 2 * 1024 * 1024,
    });
    const paths = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (paths.length === 0) return { items: [], cancelled: true };
    const seen = new Set<string>();
    const items: AttachmentItem[] = [];
    for (const path of paths) {
      if (seen.has(path)) continue;
      seen.add(path);
      items.push(classifyPath(path));
    }
    return { items, cancelled: false };
  } catch (error) {
    const err = error as { code?: number | string; stderr?: string; message?: string };
    if (err.code === 1 || /(-128|user canceled|cancelled)/i.test(`${err.stderr ?? ""} ${err.message ?? ""}`)) {
      return { items: [], cancelled: true };
    }
    throw error;
  }
}
