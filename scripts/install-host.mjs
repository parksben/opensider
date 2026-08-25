import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXTENSION_ID = "gcblddgaifebccglndkaccmibhechimj";
const HOST_NAME = "com.cursor.sidebar.host";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hostDir = resolve(root, "packages/host");
const hostSh = resolve(hostDir, "bin/host.local.sh");
const destDir = resolve(homedir(), "Library/Application Support/Google/Chrome/NativeMessagingHosts");
const workspace = resolve(homedir(), ".cursor-sidebar/workspace");
const nodePath = process.execPath;

mkdirSync(destDir, { recursive: true });
mkdirSync(resolve(workspace, "browser/commands"), { recursive: true });
mkdirSync(resolve(workspace, "browser/results"), { recursive: true });

writeFileSync(
  hostSh,
  `#!/bin/bash
set -euo pipefail
export HOME="\${HOME:-${homedir()}}"
export PATH="\${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:\${PATH:-}"
cd "${hostDir}"
exec "${nodePath}" --experimental-strip-types src/index.ts
`,
);
chmodSync(hostSh, 0o755);

writeFileSync(
  resolve(destDir, `${HOST_NAME}.json`),
  `${JSON.stringify(
    {
      name: HOST_NAME,
      description: "Cursor Sidebar native host",
      path: hostSh,
      type: "stdio",
      allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
    },
    null,
    2,
  )}\n`,
);

console.log(`Registered ${HOST_NAME}`);
console.log(`Node: ${nodePath}`);
console.log(`Host: ${hostSh}`);
console.log(`Allowed origin: chrome-extension://${EXTENSION_ID}/`);
console.log(`Workspace: ${workspace}`);
