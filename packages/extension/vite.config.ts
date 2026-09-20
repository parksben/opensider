import { readFileSync } from "node:fs";
import path from "node:path";
import { crx } from "@crxjs/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import manifest from "./manifest.config";

/** Classic HTML script; Vite will not bundle it, so emit it next to the panel HTML. */
function emitThemeBoot(): Plugin {
  return {
    name: "emit-theme-boot",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "src/sidepanel/theme-boot.js",
        source: readFileSync(path.resolve(__dirname, "src/sidepanel/theme-boot.js"), "utf8"),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), crx({ manifest }), emitThemeBoot()],
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  build: {
    rollupOptions: {
      // crxjs 只会自动处理 manifest 里登记的页面（侧栏那种）。结果层页面只在
      // web_accessible_resources 里挂着（它由页面里的 iframe 加载），所以要在这里显式登记，
      // 否则构建产物里留下的是没打包的 `./main.tsx`，iframe 一加载就 404。
      input: {
        "selection-result": path.resolve(__dirname, "src/selection/index.html"),
      },
    },
  },
});
