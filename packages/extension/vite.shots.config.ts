import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** README screenshots only. Not part of the extension build (`vite.config.ts`). */
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(root, "src/sidepanel"),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@shared": path.join(root, "../shared/src/index.ts"),
    },
  },
  server: { port: 5198 },
});
