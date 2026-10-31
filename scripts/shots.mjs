#!/usr/bin/env node
// README screenshots: stills of the promo video page at 2x, so they share the video's look.
// The page is not part of the extension build.
//
//   node scripts/shots.mjs
//
// Writes docs/readme/{en,zh}/{automation,selection,pick}.png
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cachedChromium, loadPlaywright } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "packages", "extension");
const outRoot = join(root, "docs", "readme");
const PORT = 5198;
const BASE = `http://localhost:${PORT}/promo.html`;
// Seconds into the promo timeline (see SCENES in promo.tsx).
const SCENES = { automation: 51.2, selection: 67.5, pick: 79.2 };
const LANGS = ["en", "zh"];

const server = spawn(
  process.execPath,
  [join(ext, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.shots.config.ts", "--port", String(PORT), "--strictPort"],
  { cwd: ext, stdio: "inherit" },
);

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(BASE);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("shots dev server did not start");
}

async function launch() {
  const { chromium } = loadPlaywright();
  const executablePath = cachedChromium();
  try {
    return await chromium.launch({ headless: true, executablePath });
  } catch {
    return await chromium.launch({ headless: true, channel: "chrome" });
  }
}

try {
  await waitForServer();
  const browser = await launch();
  for (const lang of LANGS) {
    mkdirSync(join(outRoot, lang), { recursive: true });
    for (const [scene, time] of Object.entries(SCENES)) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2, colorScheme: "dark" });
      await page.goto(`${BASE}?lang=${lang}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.shotReady === "1", undefined, { timeout: 15000 });
      await page.evaluate((t) => window.__promoSeek(t), time);
      await page.screenshot({ path: join(outRoot, lang, `${scene}.png`) });
      await page.close();
      console.log(`captured docs/readme/${lang}/${scene}.png`);
    }
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
