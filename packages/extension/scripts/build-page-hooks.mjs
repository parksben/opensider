#!/usr/bin/env node
// Builds the two MAIN-world hooks as *classic* scripts (`page-hooks/<name>.js`, IIFE, no
// import/export), instead of letting CRXJS turn them into ESM loaders. Two reasons, both
// learned the hard way:
//
//   1. A hook has to be re-runnable. CRXJS's loader is `(async () => await import("./x.js"))()`,
//      and a module is evaluated once per document — so once we uninstall a hook (the side
//      panel closed, a tab nobody works with must look stock again) injecting it back was a
//      no-op and the Agent was left blind until the page reloaded. A classic script simply
//      runs again; the hooks' own `if (host[KEY]) return` keeps that idempotent.
//   2. A classic script runs *while* `executeScript` resolves. With the async loader the hook
//      was not there yet when the service worker's next call arrived, so that call left the
//      hook installed but without its caller token (`hook-caller.ts`).
//
// The fixed file names also mean the service worker can name them directly, which removes the
// `exclude_matches` declaration the manifest used to carry just to make the hashed names
// discoverable at runtime.
import { build } from "vite";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = resolve(here, "..");
const dist = join(pkg, "dist");

const hooks = ["native-ui-hook", "activity-hook"];

for (const name of hooks) {
  await build({
    configFile: false,
    logLevel: "warn",
    // No `public/` copying: this step only owns `dist/page-hooks/`, and the panel build has
    // already put the icons where the manifest points at them.
    publicDir: false,
    resolve: { alias: { "@shared": resolve(pkg, "../shared/src/index.ts") } },
    build: {
      outDir: dist,
      // The panel/background build owns the directory; this step only adds to it.
      emptyOutDir: false,
      target: "chrome120",
      minify: "esbuild",
      lib: {
        entry: join(pkg, "src", `${name}.ts`),
        formats: ["iife"],
        name: `__opensider_${name.replace(/-/g, "_")}`,
        fileName: () => `${name}.js`,
      },
      rollupOptions: { output: { dir: join(dist, "page-hooks") } },
    },
  });
  console.log(`page-hooks/${name}.js`);
}
