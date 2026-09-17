import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_KEY } from "../shared/src/protocol";

export default defineManifest({
  manifest_version: 3,
  name: "OpenSider",
  // 和 release tag 同步：侧栏把「扩展版本」和最新 tag 比较来提示更新，
  // release 流水线里有一步专门挡「忘了改这个数字」。
  version: "0.2.11",
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
    // The two MAIN-world hooks are injected on demand instead of on every page (see
    // `ensurePageHooks` in background.ts): patching a page's own `window` from its main
    // world is visible to the site, and doing that on pages the Agent never touches — and
    // *during* their initialisation, which is when a bundler's `document_start` loader
    // really lands — breaks sites that check their own environment on load (Douyin's
    // player, among others).
    //
    // They stay declared here for one reason only: it is the single place where the CRXJS
    // build's hash-suffixed file names can be read back at runtime
    // (`chrome.runtime.getManifest()`). `exclude_matches` covering the same patterns means
    // Chrome itself never injects them, so the declaration costs the pages nothing.
    {
      matches: ["http://*/*", "https://*/*"],
      exclude_matches: ["http://*/*", "https://*/*"],
      js: ["src/native-ui-hook.ts"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
    },
    {
      matches: ["http://*/*", "https://*/*"],
      exclude_matches: ["http://*/*", "https://*/*"],
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
