/**
 * Dropped files -> attachments.
 *
 * The side panel can receive files dropped anywhere on it. Chrome hands a page `File`
 * objects only — no local path — so the bytes have to be sent to the host, which writes a
 * copy into the workspace (`browser/uploads/`) and hands back the attachment path. That is
 * the same route pasted screenshots take (`browser/pasted/`).
 *
 * Everything that needs the DOM lives here next to the pure helpers; the helpers are what
 * the unit tests exercise (the module imports no globals at load time).
 */

/** Native Messaging frames cap out at 1MB, and base64 inflates by 3/4. */
export const MAX_UPLOAD_BASE64 = 640_000;
/** 640k of base64 is ~480 KiB of file. Bigger files belong to the attach button (real path, no copy). */
export const MAX_UPLOAD_BYTES = 480 * 1024;
/** Enough for a small project folder, small enough to stay quick. */
export const MAX_DROP_FILES = 100;

export type DroppedFile = {
  /** File name, or the path inside the dropped folder when `dir` is set. */
  name: string;
  /** Set when the file came from a dropped folder: the dropped folder's own name. */
  dir?: string;
  file: File;
};

export type DropPlan = {
  files: DroppedFile[];
  /** Reasons files were skipped, in the user's head-count terms. */
  skipped: { tooLarge: number; tooMany: number };
};

/** Base64 with chunked `String.fromCharCode`, so a big file cannot blow the argument limit. */
export function encodeBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

export function isTooLarge(size: number): boolean {
  return size > MAX_UPLOAD_BYTES;
}

/** Encodes a dropped file, or returns undefined when it is too big to send. */
export async function fileToBase64(file: File): Promise<string | undefined> {
  if (isTooLarge(file.size)) return undefined;
  const bytes = new Uint8Array(await file.arrayBuffer());
  return encodeBase64(bytes);
}

/**
 * Turns a drop into a plan: every file to upload, plus what had to be skipped.
 *
 * `dataTransfer.items` is only valid during the event, so this has to be called from the
 * drop handler itself (everything async happens afterwards, on the captured entries).
 */
export function collectDrop(dataTransfer: DataTransfer | null): {
  entries: { name: string; dir?: string; entry: FileSystemEntry }[];
  skippedTooMany: number;
  plainFiles: File[];
} {
  const items = Array.from(dataTransfer?.items ?? []);
  const entries: { name: string; dir?: string; entry: FileSystemEntry }[] = [];
  let skippedTooMany = 0;

  for (const item of items) {
    if (item.kind !== "file") continue;
    const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
    if (!entry) continue;
    if (entries.length >= MAX_DROP_FILES) {
      skippedTooMany += 1;
      continue;
    }
    entries.push({ name: entry.name, dir: entry.isDirectory ? entry.name : undefined, entry });
  }

  // Fallback for a browser that gives files but no entries (they are the same files).
  const plainFiles = entries.length === 0 ? Array.from(dataTransfer?.files ?? []) : [];
  return { entries, skippedTooMany, plainFiles };
}

/** Reads a directory entry recursively, bounded by `MAX_DROP_FILES`. */
export async function walkEntry(
  entry: FileSystemEntry,
  dir: string | undefined,
  out: DroppedFile[],
  skipped: { tooLarge: number; tooMany: number },
): Promise<void> {
  if (out.length >= MAX_DROP_FILES) {
    skipped.tooMany += 1;
    return;
  }
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(
        (value) => resolve(value),
        () => resolve(null),
      );
    });
    if (!file) return;
    if (isTooLarge(file.size)) {
      skipped.tooLarge += 1;
      return;
    }
    out.push({ name: entry.name, dir, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      reader.readEntries(
        (values) => resolve(values),
        () => resolve([]),
      );
    });
    if (batch.length === 0) break;
    for (const child of batch) {
      await walkEntry(child, dir ?? entry.name, out, skipped);
    }
  }
}
