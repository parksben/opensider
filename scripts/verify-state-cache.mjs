import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSandbox, launchSandbox, loadPlaywright, waitForWorker } from './lib/sandbox.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'packages/extension/dist');
const sandbox = createSandbox({ root, dist, prefix: 'opensider-cache-' });
const { chromium } = loadPlaywright();
const context = await launchSandbox(chromium, { dist, sandbox, env: { FAKE_ACP_CHUNKS: '100', FAKE_ACP_CHUNK_MS: '100' } });
try {
  const worker = await waitForWorker(context);
  const now = new Date().toISOString();
  const history = 'synthetic history '.repeat(512 * 1024);
  await worker.evaluate(async ({ now, history }) => {
    await chrome.storage.local.set({ 'opensider/state': {
      version: 1, savedAt: now, locale: 'en', theme: 'dark', selectedId: 'active',
      selectedProviderId: 'copilot', onboardingCompleted: true, sessionsOpen: false,
      sessions: [
        { id: 'active', title: 'Cache test', createdAt: now, updatedAt: now, messages: [], todos: [] },
        { id: 'history', title: 'Large history', createdAt: now, updatedAt: now, todos: [], messages: [
          { id: 'old', role: 'assistant', createdAt: now, durationMs: 1, content: [{ type: 'text', text: history }] },
        ] },
      ],
    } });
  }, { now, history });
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${sandbox.extensionId}/src/sidepanel/index.html`);
  const composer = panel.locator('[contenteditable="true"]');
  await composer.waitFor({ timeout: 40000 });
  await panel.waitForFunction(async () => {
    const state = (await chrome.storage.local.get('opensider/state'))['opensider/state'];
    return state?.sessions?.length === 0;
  });
  const cacheInfo = () => panel.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('opensider-ui', 1);
    open.onerror = () => reject(String(open.error));
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('state').objectStore('state').get('current');
      read.onsuccess = () => { const value = read.result; resolve({ sessions: value.sessions.length, historyLength: value.sessions.find(s => s.id === 'history').messages[0].content[0].text.length }); db.close(); };
    };
  }));
  assert.equal((await cacheInfo()).historyLength, history.length);
  const settings = await worker.evaluate(async () => (await chrome.storage.local.get('opensider/state'))['opensider/state']);
  assert.ok(JSON.stringify(settings).length < 4096);
  console.log(`ok legacy migration: ${history.length} history characters retained; settings ${JSON.stringify(settings).length} bytes`);
  await panel.reload();
  await composer.waitFor({ timeout: 40000 });
  assert.equal((await cacheInfo()).historyLength, history.length);
  console.log('ok large history survives reload');
  await panel.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.includes('Auto')), null, { timeout: 40000 });
  await composer.fill('Run a streaming turn');
  await panel.keyboard.press('Enter');
  await panel.locator('.cs-composer.is-running').waitFor({ timeout: 30000 });
  await panel.waitForTimeout(1500);
  const started = Date.now();
  await composer.fill('Typing while the agent streams');
  assert.equal(await composer.innerText(), 'Typing while the agent streams');
  console.log(`ok input while streaming: ${Date.now() - started}ms`);
  const hostLog = join(sandbox.home, '.opensider/host.log');
  const countWrites = () => (readFileSync(hostLog, 'utf8').match(/ui.state.set/g) || []).length;
  await panel.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await panel.waitForTimeout(1000);
  const writes = countWrites();
  await panel.evaluate(() => { for (let i = 0; i < 10; i++) window.dispatchEvent(new Event('pagehide')); });
  await panel.waitForTimeout(1000);
  assert.ok(countWrites() <= writes + 1, 'repeated flushes must not write unchanged full mirrors');
  console.log('ok repeated hide events do not create duplicate mirror writes');
} finally {
  await context.close();
  rmSync(sandbox.dir, { recursive: true, force: true });
  rmSync(sandbox.profile, { recursive: true, force: true });
}
