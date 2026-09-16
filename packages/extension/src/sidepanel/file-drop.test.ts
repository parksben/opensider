// 拖入侧栏的文件 → 附件这条链路的纯逻辑（DOM 部分在 file-drop.ts 里与它同放，
// 但这里的每个用例都不碰 DOM 全局，所以能在 Node 里跑）。
import assert from "node:assert/strict";
import test from "node:test";

import {
  ENTRY_FILE_TIMEOUT_MS,
  MAX_DROP_FILES,
  MAX_UPLOAD_BYTES,
  collectDrop,
  emptySkips,
  encodeBase64,
  fileFromEntry,
  isTooLarge,
  walkEntry,
} from "./file-drop.ts";

test("base64 matches Node's encoder for every chunk boundary", () => {
  for (const size of [0, 1, 3, 0x7fff, 0x8000, 0x8001, 200_000]) {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) bytes[i] = (i * 7 + 13) % 256;
    assert.equal(encodeBase64(bytes), Buffer.from(bytes).toString("base64"), `size ${size}`);
  }
});

test("base64 round-trips non-ascii bytes", () => {
  const bytes = new Uint8Array([0xff, 0x00, 0x80, 0x7f, 0xc3, 0xa9]);
  assert.deepEqual([...Buffer.from(encodeBase64(bytes), "base64")], [...bytes]);
});

test("the size gate is where the native messaging frame needs it", () => {
  assert.equal(isTooLarge(MAX_UPLOAD_BYTES), false);
  assert.equal(isTooLarge(MAX_UPLOAD_BYTES + 1), true);
  // Whatever passes the gate still has to fit the frame (base64 grows by 4/3).
  assert.ok(Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) < 1_000_000, "frame budget");
});

test("the drop budget is a sane number of files", () => {
  assert.ok(MAX_DROP_FILES >= 10 && MAX_DROP_FILES <= 500, `got ${MAX_DROP_FILES}`);
});

// --- dropped folders ---------------------------------------------------------

type FakeEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (ok: (value: unknown) => void, fail: (error: unknown) => void) => void;
  createReader?: () => { readEntries: (ok: (values: unknown[]) => void, fail: (error: unknown) => void) => void };
};

const fakeFile = (name: string, size = 10): FakeEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (ok) => ok({ name, size }),
});

const unreadableFile = (name: string): FakeEntry => ({
  name,
  isFile: true,
  isDirectory: false,
  file: (_ok, fail) => fail(new Error("gone")),
});

const fakeDir = (name: string, children: FakeEntry[]): FakeEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => {
    let sent = false;
    return {
      readEntries: (ok) => {
        if (sent) return ok([]);
        sent = true;
        ok(children);
      },
    };
  },
});

/** A reader that never calls back: Chrome does that for a folder it will not list. */
const silentDir = (name: string): FakeEntry => ({
  name,
  isFile: false,
  isDirectory: true,
  createReader: () => ({ readEntries: () => undefined }),
});

const walk = (entry: FakeEntry, dir?: string, fallback?: unknown) => {
  const raw: { name: string; dir?: string; file: { size?: number } }[] = [];
  const skipped = emptySkips();
  return walkEntry(
    entry as unknown as FileSystemEntry,
    dir,
    raw as never,
    skipped,
    (fallback ?? null) as never,
  ).then(() => ({
    out: raw.map((item) => ({ name: item.name, dir: item.dir, size: item.file.size ?? 0 })),
    skipped,
  }));
};

test("a dropped folder walks nested files and keeps the folder name", async () => {
  const tree = fakeDir("proj", [fakeFile("README.md"), fakeDir("src", [fakeFile("a.ts")])]);
  const { out } = await walk(tree);
  assert.deepEqual(
    out.map((item) => [item.dir, item.name]).sort(),
    [
      ["proj", "README.md"],
      ["proj", "a.ts"],
    ],
  );
});

test("files that are too big are skipped, not uploaded", async () => {
  const tree = fakeDir("proj", [fakeFile("big.bin", MAX_UPLOAD_BYTES + 1), fakeFile("small.bin")]);
  const { out, skipped } = await walk(tree);
  assert.deepEqual(out.map((item) => item.name), ["small.bin"]);
  assert.equal(skipped.tooLarge, 1);
});

test("the drop budget stops the walk instead of hanging", async () => {
  const children = Array.from({ length: MAX_DROP_FILES + 5 }, (_, index) => fakeFile(`f${index}.txt`));
  const { out, skipped } = await walk(fakeDir("many", children));
  assert.equal(out.length, MAX_DROP_FILES);
  assert.ok(skipped.tooMany >= 1);
});

test("an unreadable entry is counted instead of vanishing", async () => {
  const tree = fakeDir("proj", [unreadableFile("ghost.txt"), fakeFile("real.txt")]);
  const { out, skipped } = await walk(tree);
  assert.deepEqual(out.map((item) => item.name), ["real.txt"]);
  assert.deepEqual(skipped, { tooLarge: 0, tooMany: 0, unreadable: 1 });
});

// --- the ways a real drop can hand over its files -----------------------------

const fakeItem = (options: { entry?: unknown; file?: unknown; throws?: boolean }) => ({
  kind: "file",
  webkitGetAsEntry: () => {
    if (options.throws) throw new Error("nope");
    return options.entry ?? null;
  },
  getAsFile: () => options.file ?? null,
});

const fakeTransfer = (items: unknown[], files: unknown[] = []) =>
  ({ items, files } as unknown as DataTransfer);

const fakeFileObject = (name: string, size = 12) => ({ name, size });

test("an item with an entry is walked, and keeps its own file as a backup", () => {
  const entry = fakeFile("dropped.txt");
  const file = fakeFileObject("dropped.txt");
  const captured = collectDrop(fakeTransfer([fakeItem({ entry, file })], [file]));
  assert.equal(captured.entries.length, 1);
  assert.equal(captured.entries[0].fallback, file);
  assert.equal(captured.entries[0].dir, undefined);
  // `files` holds the same objects as `getAsFile()`: taking both would attach it twice.
  assert.deepEqual(captured.plainFiles, []);
});

test("an item without an entry still contributes its file", () => {
  const file = fakeFileObject("plain.txt");
  const captured = collectDrop(fakeTransfer([fakeItem({ file })]));
  assert.deepEqual(captured.entries, []);
  assert.deepEqual(captured.plainFiles, [file]);
});

test("a throwing entry lookup falls back to the item's file", () => {
  const file = fakeFileObject("plain.txt");
  const captured = collectDrop(fakeTransfer([fakeItem({ file, throws: true })]));
  assert.deepEqual(captured.plainFiles, [file]);
});

test("a drop with nothing to describe itself falls back to dataTransfer.files", () => {
  const files = [fakeFileObject("a.txt"), fakeFileObject("b.txt")];
  const captured = collectDrop(fakeTransfer([fakeItem({})], files));
  assert.deepEqual(captured.plainFiles, files);
});

test("a folder entry is marked with the folder name", () => {
  const folder = { name: "proj", isFile: false, isDirectory: true };
  const captured = collectDrop(fakeTransfer([fakeItem({ entry: folder })]));
  assert.equal(captured.entries[0].dir, "proj");
  assert.equal(captured.entries[0].fallback, null);
});

test("an entry that cannot be read falls back to the item's file", async () => {
  const backup = fakeFileObject("ghost.txt", 42) as never;
  const { out, skipped } = await walk(unreadableFile("ghost.txt"), undefined, backup);
  assert.deepEqual(out.map((item) => [item.name, item.size]), [["ghost.txt", 42]]);
  assert.equal(skipped.unreadable, 0);
});

test("a folder Chrome will not list ends the walk instead of hanging the drop", async () => {
  const tree = fakeDir("proj", [fakeFile("found.txt"), silentDir("locked")]);
  const { out } = await walk(tree);
  // Whatever the reader did hand over is kept; the silent folder just stops the walk.
  assert.deepEqual(out.map((item) => item.name), ["found.txt"]);
});

test("an entry whose file() never calls back gives up and is still reported", async () => {
  const silent: FakeEntry = { name: "frozen.txt", isFile: true, isDirectory: false, file: () => {} };
  const started = Date.now();
  const file = await fileFromEntry(silent as unknown as FileSystemFileEntry, 30);
  assert.equal(file, null);
  assert.ok(Date.now() - started >= 25, "must wait for the timeout, not return early");
  assert.ok(ENTRY_FILE_TIMEOUT_MS >= 1_000, "the real budget should be generous");

  const { out, skipped } = await walk(silent);
  assert.deepEqual(out, []);
  assert.equal(skipped.unreadable, 1);
});
