#!/usr/bin/env node
// 开发用：编出 Host 二进制、把扩展构建产物拷到用户目录，再登记本机桥接。
//
// 用户侧没有这条路径 —— 用户的安装 / 更新由「一段提示词 + skills/opensider 里的
// skill」驱动（见 docs/TECH_DESIGN.md）。这里只是把同一批文件在开发机上摆好，
// 免去每次手敲 go build / cp / opensider install。
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const home = join(homedir(), ".opensider");
const bin = join(home, "runtime", process.platform === "win32" ? "opensider.exe" : "opensider");
const dist = join(root, "packages", "extension", "dist");
const extension = join(home, "extension");

mkdirSync(dirname(bin), { recursive: true });
console.log(`Building ${bin}`);
execFileSync("go", ["build", "-o", bin, "./cmd/opensider"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, ...(process.platform === "darwin" ? { CGO_ENABLED: "1" } : {}) },
});

if (existsSync(join(dist, "manifest.json"))) {
  rmSync(extension, { recursive: true, force: true });
  cpSync(dist, extension, { recursive: true });
  console.log(`Copied ${dist} -> ${extension}`);
} else {
  console.log("packages/extension/dist not found; build the extension first");
}

console.log("Registering the native host");
execFileSync(bin, ["install"], { stdio: "inherit" });
