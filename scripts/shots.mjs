#!/usr/bin/env node
// README screenshots: render the shots page (a browser frame + the real side panel) and
// capture each scene at 2x. The page is not part of the extension build.
//
//   node scripts/shots.mjs
//
// Writes docs/readme/{en,zh}/{chat,selection,pick}.png
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cachedChromium, loadPlaywright } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "packages", "extension");
const outRoot = join(root, "docs", "readme");
const PORT = 5198;
const BASE = `http://localhost:${PORT}/shots.html`;
const SCENES = ["chat", "selection", "pick"];
const LANGS = ["en", "zh"];

const server = spawn(
  process.execPath,
  [join(ext, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.shots.config.ts", "--port", String(PORT), "--strictPort"],
  { cwd: ext, stdio: "inherit" },
);

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const res = await fetch(`${BASE}?scene=chat`);
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
    for (const scene of SCENES) {
      const page = await browser.newPage({ viewport: { width: 1120, height: 700 }, deviceScaleFactor: 2 });
      await page.goto(`${BASE}?scene=${scene}&lang=${lang}`, { waitUntil: "networkidle" });
      await page.waitForFunction(() => document.documentElement.dataset.shotReady === "1", undefined, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(outRoot, lang, `${scene}.png`) });
      await page.close();
      console.log(`captured docs/readme/${lang}/${scene}.png`);
    }
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
}
