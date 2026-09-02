#!/usr/bin/env node
import { createHash, createPublicKey, createSign } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "packages", "extension", "dist");
const keyPath = join(root, "scripts", "keys", "extension.pem");
const outDir = join(root, "dist-release");
const zipPath = join(outDir, "extension.zip");
const crxPath = join(outDir, "opensider.crx");
const expectedPackedId = "clnpnldmjaklambmaglpckjlgkicmcpb";
const skipNames = new Set([".DS_Store", "Thumbs.db"]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function encodeVarint(value) {
  const bytes = [];
  let n = value >>> 0;
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function encodeBytes(fieldNumber, data) {
  const tag = encodeVarint((fieldNumber << 3) | 2);
  return Buffer.concat([tag, encodeVarint(data.length), data]);
}

function extensionIdFromSpki(spki) {
  const hash = createHash("sha256").update(spki).digest().subarray(0, 16);
  let id = "";
  for (const byte of hash) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

function dosDateTime(date) {
  return {
    time: (date.getSeconds() >> 1) | (date.getMinutes() << 5) | (date.getHours() << 11),
    date: date.getDate() | ((date.getMonth() + 1) << 5) | ((date.getFullYear() - 1980) << 9),
  };
}

function u16(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16LE(value, 0);
  return buf;
}

function u32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value, 0);
  return buf;
}

async function listFiles(dir) {
  const out = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (skipNames.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out;
}

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = relative(distDir, file).split("\\").join("/");
    const nameBuf = Buffer.from(name, "utf8");
    const data = readFileSync(file);
    const compressed = deflateRawSync(data);
    const stamp = dosDateTime(statSync(file).mtime);
    const crc = crc32(data);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(8),
      u16(stamp.time),
      u16(stamp.date),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
      compressed,
    ]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(8),
      u16(stamp.time),
      u16(stamp.date),
      u32(crc),
      u32(compressed.length),
      u32(data.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBuf.length),
    u32(offset),
    u16(0),
  ]);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function packCrx3(zip, pem) {
  const publicKey = createPublicKey(pem);
  const spki = publicKey.export({ type: "spki", format: "der" });
  const crxId = createHash("sha256").update(spki).digest().subarray(0, 16);
  const signedHeaderData = encodeBytes(1, crxId);
  const signed = Buffer.concat([
    Buffer.from("CRX3 SignedData\x00"),
    u32(signedHeaderData.length),
    signedHeaderData,
  ]);
  const signer = createSign("sha256");
  signer.update(signed);
  signer.end();
  const signature = signer.sign(pem);
  const proof = Buffer.concat([encodeBytes(1, spki), encodeBytes(2, signature)]);
  const header = Buffer.concat([encodeBytes(2, proof), encodeBytes(10000, signedHeaderData)]);
  return {
    id: extensionIdFromSpki(spki),
    crx: Buffer.concat([Buffer.from("Cr24"), u32(3), u32(header.length), header, zip]),
  };
}

async function main() {
  try {
    statSync(join(distDir, "manifest.json"));
  } catch {
    fail("packages/extension/dist/manifest.json missing; run the extension build first");
  }
  let pem;
  try {
    pem = readFileSync(keyPath, "utf8");
  } catch {
    fail(`missing signing key: ${keyPath}`);
  }

  const files = await listFiles(distDir);
  if (files.length === 0) {
    fail("packages/extension/dist is empty");
  }
  const zip = buildZip(files);
  const { id, crx } = packCrx3(zip, pem);
  if (id !== expectedPackedId) {
    fail(`packed extension id ${id} != ${expectedPackedId}; update protocol constants if the key changed`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(zipPath, zip);
  writeFileSync(crxPath, crx);
  console.log(`wrote ${relative(root, zipPath)} (${zip.length} bytes)`);
  console.log(`wrote ${relative(root, crxPath)} (${crx.length} bytes, id ${id})`);
}

await main();
