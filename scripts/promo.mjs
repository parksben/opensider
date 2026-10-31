#!/usr/bin/env node
// README promo video: render promo.html frame by frame (window.__promoSeek), synthesize the
// background track with promo-music.py, and encode an MP4 plus a GIF preview with ffmpeg.
//
//   node scripts/promo.mjs [en|zh]
//
// Writes docs/promo/{en,zh}/opensider-promo.mp4 and preview.gif. Needs ffmpeg on PATH and
// Python with numpy + scipy (set PROMO_PYTHON to pick the interpreter).
import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cachedChromium, loadPlaywright } from "./lib/sandbox.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "packages", "extension");
const outRoot = join(root, "docs", "promo");
const PORT = 5198;
const BASE = `http://localhost:${PORT}/promo.html`;
const FPS = 30;
const WORKERS = 4;
// GIF preview: a few seconds of the automation scene.
const GIF_FROM = 42;
const GIF_LEN = 7;
const LANGS = process.argv[2] ? [process.argv[2]] : ["en", "zh"];

const server = spawn(
  process.execPath,
  [join(ext, "node_modules", "vite", "bin", "vite.js"), "--config", "vite.shots.config.ts", "--port", String(PORT), "--strictPort"],
  { cwd: ext, stdio: "ignore" },
);

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(BASE)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("promo dev server did not start");
}

async function launch() {
  const { chromium } = loadPlaywright();
  try {
    return await chromium.launch({ headless: true, executablePath: cachedChromium() });
  } catch {
    return await chromium.launch({ headless: true, channel: "chrome" });
  }
}

async function openPage(browser, lang) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: "dark" });
  page.on("pageerror", (err) => console.error(`[${lang}] page error:`, err.message));
  await page.goto(`${BASE}?lang=${lang}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.dataset.shotReady === "1", undefined, { timeout: 30000 });
  return page;
}

async function renderFrames(browser, lang, dir) {
  const probe = await openPage(browser, lang);
  const duration = await probe.evaluate(() => window.__promoDuration);
  await probe.close();
  const total = Math.round(duration * FPS);
  let next = 0;
  let done = 0;
  const worker = async () => {
    const page = await openPage(browser, lang);
    for (;;) {
      const frame = next++;
      if (frame >= total) break;
      await page.evaluate((t) => window.__promoSeek(t), frame / FPS);
      await page.screenshot({ path: join(dir, `f_${String(frame).padStart(5, "0")}.jpg`), type: "jpeg", quality: 92 });
      done += 1;
      if (done % 300 === 0) console.log(`[${lang}] ${done}/${total} frames`);
    }
    await page.close();
  };
  await Promise.all(Array.from({ length: WORKERS }, worker));
  return duration;
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args], { stdio: "inherit" });
}

const work = mkdtempSync(join(tmpdir(), "opensider-promo-"));
try {
  await waitForServer();
  const browser = await launch();
  let music;
  for (const lang of LANGS) {
    const frames = join(work, lang);
    mkdirSync(frames, { recursive: true });
    const duration = await renderFrames(browser, lang, frames);
    if (!music) {
      music = join(work, "music.wav");
      execFileSync(process.env.PROMO_PYTHON || "python3", [join(root, "scripts", "promo-music.py"), music, String(duration)], { stdio: "inherit" });
    }
    const out = join(outRoot, lang);
    mkdirSync(out, { recursive: true });
    const mp4 = join(out, "opensider-promo.mp4");
    ffmpeg([
      "-framerate", String(FPS), "-i", join(frames, "f_%05d.jpg"), "-i", music,
      "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-t", String(duration), "-movflags", "+faststart", mp4,
    ]);
    ffmpeg([
      "-ss", String(GIF_FROM), "-t", String(GIF_LEN), "-i", mp4,
      "-filter_complex", "fps=12,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
      join(out, "preview.gif"),
    ]);
    console.log(`wrote docs/promo/${lang}/opensider-promo.mp4 and preview.gif`);
  }
  await browser.close();
} finally {
  server.kill("SIGTERM");
  rmSync(work, { recursive: true, force: true });
}
