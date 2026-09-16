import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_KEY } from "../shared/src/protocol";

export default defineManifest({
  manifest_version: 3,
  name: "OpenSider",
  // 和 release tag 同步：侧栏把「扩展版本」和最新 tag 比较来提示更新，
  // release 流水线里有一步专门挡「忘了改这个数字」。
  version: "0.2.10",
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
      run_at: "document_start",
    },
    // Native UI shim: must be in the MAIN world (it patches the page's own alert/confirm/
    // prompt/print/open/file-picker entry points) and must run before any page script.
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/native-ui-hook.ts"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
    },
    // Page activity shim: also MAIN world, also `document_start` (it redirects what the
    // page reads for visibility/focus, and hangs on to the original rAF before the page
    // can). Inert until the service worker arms it for a tab.
    {
      matches: ["http://*/*", "https://*/*"],
      js: ["src/activity-hook.ts"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
    },
  ],
  permissions: ["sidePanel", "nativeMessaging", "tabs", "windows", "storage", "scripting", "favicon"],
  host_permissions: ["http://*/*", "https://*/*"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: blob: file: https:;",
  },
});
