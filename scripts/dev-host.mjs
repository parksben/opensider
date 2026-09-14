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
// 与 internal/paths.ExtensionDir() 保持一致：扩展解到下载目录下的 OpenSider，
// 这样手动「加载已解压的扩展程序」时能在文件选择器里直接看到它。
const downloads = process.env.USERPROFILE
  ? join(process.env.USERPROFILE, "Downloads")
  : join(homedir(), "Downloads");
const extension = join(existsSync(downloads) ? downloads : homedir(), "OpenSider");

// 开发二进制也带上最近一个 tag：侧栏把桥接版本和最新 release 比较，报 dev 会
// 让本机测试看到假的「有新版本」提示。仓库里没有 tag 就退回 dev。
function releaseTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

const tag = releaseTag();
const ldflags = tag ? `-X github.com/parksben/opensider/internal/version.Version=${tag}` : "";

mkdirSync(dirname(bin), { recursive: true });
console.log(`Building ${bin} (version ${tag || "dev"})`);
execFileSync("go", ["build", ...(ldflags ? ["-ldflags", ldflags] : []), "-o", bin, "./cmd/opensider"], {
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
