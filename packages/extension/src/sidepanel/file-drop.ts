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
/** How long a single `entry.file()` may take before we treat the entry as unreadable. */
export const ENTRY_FILE_TIMEOUT_MS = 3_000;

export type DroppedFile = {
  /** File name, or the path inside the dropped folder when `dir` is set. */
  name: string;
  /** Set when the file came from a dropped folder: the dropped folder's own name. */
  dir?: string;
  file: File;
};

export type DropSkips = {
  tooLarge: number;
  tooMany: number;
  /** Entries that could not hand over a file at all - the drop should say so. */
  unreadable: number;
};

export type DropPlan = {
  files: DroppedFile[];
  /** Reasons files were skipped, in the user's head-count terms. */
  skipped: DropSkips;
};

export function emptySkips(): DropSkips {
  return { tooLarge: 0, tooMany: 0, unreadable: 0 };
}

export type DroppedItem = {
  name: string;
  dir?: string;
  entry: FileSystemEntry;
  /** The same item's own file, used when the entry cannot hand one over. */
  fallback: File | null;
};

export type CapturedDrop = {
  entries: DroppedItem[];
  /** Files that arrived without a usable entry (only when no item described itself). */
  plainFiles: File[];
  skippedTooMany: number;
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
 * Turns a drop into a capture: every entry to walk, plus files that no entry described.
 *
 * `dataTransfer.items` is only valid during the event, so this has to be called from the
 * drop handler itself (everything async happens afterwards, on the captured entries).
 *
 * A drop is not guaranteed to give us either shape: a real drag hands over entries, but an
 * app that only offers a promised file may give us files without entries, and a permission
 * or sandbox surprise can leave `webkitGetAsEntry()` returning nothing at all. So each item
 * is asked for its file too, and whichever side answers wins.
 */
export function collectDrop(dataTransfer: DataTransfer | null): CapturedDrop {
  const items = Array.from(dataTransfer?.items ?? []);
  const entries: CapturedDrop["entries"] = [];
  const orphanFiles: File[] = [];
  let skippedTooMany = 0;

  for (const item of items) {
    if (item.kind !== "file") continue;
    const fallback = safeFile(item);
    const entry = safeEntry(item);
    if (!entry) {
      if (fallback) orphanFiles.push(fallback);
      continue;
    }
    if (entries.length >= MAX_DROP_FILES) {
      skippedTooMany += 1;
      continue;
    }
    entries.push({
      name: entry.name,
      dir: entry.isDirectory ? entry.name : undefined,
      entry,
      // Same item's own file, kept as the way out when the entry cannot be read.
      fallback: entry.isFile ? fallback : null,
    });
  }

  // `dataTransfer.files` holds the same objects as `getAsFile()`, so it is only a fallback
  // for the case where *no* item described itself - otherwise files would be attached twice.
  const plainFiles =
    entries.length === 0 && orphanFiles.length === 0 ? Array.from(dataTransfer?.files ?? []) : orphanFiles;
  return { entries, plainFiles, skippedTooMany };
}

function safeFile(item: DataTransferItem): File | null {
  try {
    return typeof item.getAsFile === "function" ? item.getAsFile() : null;
  } catch {
    return null;
  }
}

function safeEntry(item: DataTransferItem): FileSystemEntry | null {
  try {
    return typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
  } catch {
    return null;
  }
}

/**
 * `entry.file()` on a real drag: it can fail outright, and it can simply never call back
 * (a folder the user cannot read, a cloud placeholder, an entry whose backing store went
 * away). Neither may stall a drop, so the wait is bounded.
 */
export function fileFromEntry(
  entry: FileSystemFileEntry,
  timeoutMs: number = ENTRY_FILE_TIMEOUT_MS,
): Promise<File | null> {
  return new Promise<File | null>((resolve) => {
    let settled = false;
    const finish = (value: File | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    try {
      entry.file(
        (value) => finish(value),
        () => finish(null),
      );
    } catch {
      finish(null);
    }
  });
}

/** Reads a directory entry recursively, bounded by `MAX_DROP_FILES`. */
export async function walkEntry(
  entry: FileSystemEntry,
  dir: string | undefined,
  out: DroppedFile[],
  skipped: DropSkips,
  fallback: File | null = null,
): Promise<void> {
  if (out.length >= MAX_DROP_FILES) {
    skipped.tooMany += 1;
    return;
  }
  if (entry.isFile) {
    const file = (await fileFromEntry(entry as FileSystemFileEntry)) ?? fallback;
    if (!file) {
      skipped.unreadable += 1;
      return;
    }
    if (isTooLarge(file.size)) {
      skipped.tooLarge += 1;
      return;
    }
    out.push({ name: entry.name, dir, file });
    return;
  }
  if (!entry.isDirectory) {
    skipped.unreadable += 1;
    return;
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => {
      try {
        reader.readEntries(
          (values) => resolve(values),
          () => resolve([]),
        );
      } catch {
        resolve([]);
      }
    });
    if (batch.length === 0) break;
    for (const child of batch) {
      await walkEntry(child, dir ?? entry.name, out, skipped);
    }
  }
}
