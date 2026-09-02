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
});
