// 拖入侧栏的文件 → 附件这条链路的纯逻辑（DOM 部分在 file-drop.ts 里与它同放，
// 但这里的每个用例都不碰 DOM 全局，所以能在 Node 里跑）。
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_DROP_FILES,
  MAX_UPLOAD_BYTES,
  encodeBase64,
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

const walk = (entry: FakeEntry, dir?: string) => {
  const out: { name: string; dir?: string; size: number }[] = [];
  const skipped = { tooLarge: 0, tooMany: 0 };
  return walkEntry(entry as unknown as FileSystemEntry, dir, out as never, skipped).then(() => ({
    out,
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

test("an unreadable entry is skipped quietly", async () => {
  const tree = fakeDir("proj", [unreadableFile("ghost.txt"), fakeFile("real.txt")]);
  const { out, skipped } = await walk(tree);
  assert.deepEqual(out.map((item) => item.name), ["real.txt"]);
  assert.deepEqual(skipped, { tooLarge: 0, tooMany: 0 });
});
