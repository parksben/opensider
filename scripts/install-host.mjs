import { spawnSync } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
const HOST_NAME = "com.cursor.sidebar.host";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const home = homedir();
const workspace = resolve(home, ".cursor-sidebar/workspace");
const runtimeRoot = resolve(home, ".cursor-sidebar/runtime");
const runtimeHost = resolve(runtimeRoot, "packages/host");
const hostSh = resolve(runtimeHost, "bin/host.sh");
const nodePath = process.execPath;

const chromeRoots = [
  resolve(home, "Library/Application Support/Google/Chrome"),
  resolve(home, "Library/Application Support/Google/Chrome Beta"),
  resolve(home, "Library/Application Support/Google/Chrome Canary"),
  resolve(home, "Library/Application Support/Chromium"),
];

function collectManifestDirs() {
  const dirs = new Set();
  for (const chromeRoot of chromeRoots) {
    dirs.add(resolve(chromeRoot, "NativeMessagingHosts"));
    try {
      for (const entry of readdirSync(chromeRoot)) {
        if (entry !== "Default" && !entry.startsWith("Profile ")) continue;
        const profile = join(chromeRoot, entry);
        if (!statSync(profile).isDirectory()) continue;
        dirs.add(resolve(profile, "NativeMessagingHosts"));
      }
    } catch {
      // browser not installed
    }
  }
  return [...dirs];
}

mkdirSync(resolve(workspace, "browser/commands"), { recursive: true });
mkdirSync(resolve(workspace, "browser/results"), { recursive: true });
mkdirSync(resolve(workspace, "browser/screenshots"), { recursive: true });

rmSync(runtimeRoot, { recursive: true, force: true });
mkdirSync(resolve(runtimeHost, "bin"), { recursive: true });
cpSync(resolve(root, "packages/host/src"), resolve(runtimeHost, "src"), { recursive: true });
cpSync(resolve(root, "packages/host/package.json"), resolve(runtimeHost, "package.json"));
cpSync(resolve(root, "packages/shared/src"), resolve(runtimeRoot, "packages/shared/src"), { recursive: true });
cpSync(resolve(root, "packages/shared/package.json"), resolve(runtimeRoot, "packages/shared/package.json"));

writeFileSync(
  hostSh,
  `#!/bin/bash
export HOME="\${HOME:-${home}}"
export PATH="/bin:/usr/bin:\${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:\${PATH:-}"
export NODE_NO_WARNINGS=1
mkdir -p "\${HOME}/.cursor-sidebar" /tmp
{
  echo "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=\$\$ id=${EXTENSION_ID} runtime=${runtimeRoot}"
} >> "\${HOME}/.cursor-sidebar/host.log" 2>/dev/null || true
{
  echo "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=\$\$"
} >> /tmp/cursor-sidebar-host.log 2>/dev/null || true
cd "${runtimeHost}"
if [[ ! -x "${nodePath}" ]]; then
  echo "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) missing node ${nodePath}" >> "\${HOME}/.cursor-sidebar/host.log" 2>/dev/null || true
  exit 1
fi
exec "${nodePath}" --no-warnings src/index.ts
`,
);
chmodSync(hostSh, 0o755);

const pickApp = resolve(runtimeRoot, "PickFiles.app");
mkdirSync(resolve(pickApp, "Contents/MacOS"), { recursive: true });
writeFileSync(
  resolve(pickApp, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>com.cursor.sidebar.pick</string>
  <key>CFBundleName</key>
  <string>Cursor Sidebar Pick</string>
  <key>CFBundleExecutable</key>
  <string>pick-files</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
</dict>
</plist>
`,
);
const pickBin = resolve(pickApp, "Contents/MacOS/pick-files");
const compiled = spawnSync("swiftc", ["-O", "-o", pickBin, resolve(root, "packages/host/src/pick.swift")], {
  encoding: "utf8",
});
if (compiled.status !== 0) {
  console.warn(`swiftc failed (file picker will fall back to Finder):\n${compiled.stderr || compiled.stdout}`);
} else {
  chmodSync(pickBin, 0o755);
}

const destDirs = collectManifestDirs();
const manifest = `${JSON.stringify(
  {
    name: HOST_NAME,
    description: "Cursor Sidebar native host",
    path: hostSh,
    type: "stdio",
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  },
  null,
  2,
)}\n`;

for (const destDir of destDirs) {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(resolve(destDir, `${HOST_NAME}.json`), manifest);
}

console.log(`Registered ${HOST_NAME}`);
console.log(`Node: ${nodePath}`);
console.log(`Host: ${hostSh}`);
console.log(`Runtime: ${runtimeRoot}`);
console.log(`Allowed origin: chrome-extension://${EXTENSION_ID}/`);
console.log(`Workspace: ${workspace}`);
console.log(`Picker: ${existsSync(pickBin) ? pickBin : "Finder fallback"}`);
console.log(`Manifests: ${destDirs.join(", ")}`);
