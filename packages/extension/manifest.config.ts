import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_KEY } from "../shared/src/protocol";

export default defineManifest({
  manifest_version: 3,
  name: "OpenSider",
  version: "0.1.0",
  description: "Chat with your local Agent from the OpenSider side panel.",
  key: EXTENSION_KEY,
  icons: {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "OpenSider",
    default_icon: {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/content.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["sidePanel", "nativeMessaging", "tabs", "windows", "storage", "scripting"],
  host_permissions: ["http://*/*", "https://*/*"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: blob: file: https:;",
  },
});
