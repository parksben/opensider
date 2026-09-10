#!/usr/bin/env node
import { createHash, createPublicKey } from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(root, "packages", "extension", "dist");
// 只拿公钥算打包 ID——算 ID 不需要私钥，所以私钥不入库（.gitignore 挡住），
// CI 也不需要任何签名 secret。可用 EXTENSION_PUBKEY_PEM 覆盖（内容即 PEM）。
const publicKeyPath = join(root, "scripts", "keys", "extension.pub.pem");
const outDir = join(root, "dist-release");
const zipPath = join(outDir, "extension.zip");
const expectedPackedId = "bhedoigbjidpfhkalhkhjilpndifdkjj";
const skipNames = new Set([".DS_Store", "Thumbs.db"]);

function fail(message) {
  console.error(message);
  process.exit(1);
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

function packedIdFromPublicKey(pem) {
  const publicKey = createPublicKey(pem);
  const spki = publicKey.export({ type: "spki", format: "der" });
  return extensionIdFromSpki(spki);
}

async function main() {
  try {
    statSync(join(distDir, "manifest.json"));
  } catch {
    fail("packages/extension/dist/manifest.json missing; run the extension build first");
  }
  let publicKeyPem = process.env.EXTENSION_PUBKEY_PEM;
  if (!publicKeyPem) {
    try {
      publicKeyPem = readFileSync(publicKeyPath, "utf8");
    } catch {
      fail(
        `missing extension public key: ${publicKeyPath} ` +
          "(set EXTENSION_PUBKEY_PEM to override)",
      );
    }
  }

  const files = await listFiles(distDir);
  if (files.length === 0) {
    fail("packages/extension/dist is empty");
  }
  const zip = buildZip(files);
  const id = packedIdFromPublicKey(publicKeyPem);
  if (id !== expectedPackedId) {
    fail(`packed extension id ${id} != ${expectedPackedId}; update protocol constants if the key changed`);
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(zipPath, zip);
  console.log(`wrote ${relative(root, zipPath)} (${zip.length} bytes, packed id ${id})`);
}

await main();
