import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
const HOST_NAME = "com.cursor.sidebar.host";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = resolve(root, "packages/host");
const hostSh = resolve(hostDir, "bin/host.local.sh");
const home = homedir();
const workspace = resolve(home, ".cursor-sidebar/workspace");
const nodePath = process.execPath;

const destDirs = [
  resolve(home, "Library/Application Support/Google/Chrome/NativeMessagingHosts"),
  resolve(home, "Library/Application Support/Google/Chrome Beta/NativeMessagingHosts"),
  resolve(home, "Library/Application Support/Google/Chrome Canary/NativeMessagingHosts"),
  resolve(home, "Library/Application Support/Chromium/NativeMessagingHosts"),
];

mkdirSync(resolve(workspace, "browser/commands"), { recursive: true });
mkdirSync(resolve(workspace, "browser/results"), { recursive: true });
mkdirSync(resolve(workspace, "browser/screenshots"), { recursive: true });

writeFileSync(
  hostSh,
  `#!/bin/bash
export HOME="\${HOME:-${home}}"
export PATH="/bin:/usr/bin:\${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:\${PATH:-}"
mkdir -p "\${HOME}/.cursor-sidebar" /tmp
{
  echo "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=\$\$ id=${EXTENSION_ID}"
} >> "\${HOME}/.cursor-sidebar/host.log" 2>/dev/null || true
{
  echo "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ) launch pid=\$\$"
} >> /tmp/cursor-sidebar-host.log 2>/dev/null || true
cd "${hostDir}"
exec "${nodePath}" --experimental-strip-types src/index.ts
`,
);
chmodSync(hostSh, 0o755);

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
console.log(`Allowed origin: chrome-extension://${EXTENSION_ID}/`);
console.log(`Workspace: ${workspace}`);
console.log(`Manifests: ${destDirs.join(", ")}`);
