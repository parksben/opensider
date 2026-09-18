import { defineManifest } from "@crxjs/vite-plugin";
import { EXTENSION_KEY } from "../shared/src/protocol";

export default defineManifest({
  manifest_version: 3,
  name: "OpenSider",
  // 和 release tag 同步：侧栏把「扩展版本」和最新 tag 比较来提示更新，
  // release 流水线里有一步专门挡「忘了改这个数字」。
  version: "0.3.0",
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
    // The two MAIN-world hooks are deliberately *not* content scripts. Patching a page's own
    // `window` from its main world is something the site can see, so it only happens on tabs
    // the Agent actually works with, injected by the service worker (`injectPageHook` in
    // background.ts) while the side panel is open. They are built as classic scripts with
    // fixed names by `scripts/build-page-hooks.mjs` — a hook has to be re-runnable, and an ESM
    // loader would be evaluated once per document.
  ],
  permissions: ["sidePanel", "nativeMessaging", "tabs", "windows", "storage", "unlimitedStorage", "scripting", "favicon"],
  host_permissions: ["http://*/*", "https://*/*"],
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'self'; img-src 'self' data: blob: file: https:;",
  },
});
