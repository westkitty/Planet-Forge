// Long-run memory probe (issue #8): repeated world regeneration, layer and quality switches at a mobile viewport,
// measuring JS heap after a forced garbage collection plus live WebGL objects. A steady upward trend after GC
// indicates a leak; a one-off high reading without GC is uncollected garbage.
// Usage: node scripts/memprobe.mjs <url> [cycles]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const url = process.argv[2] || 'http://localhost:4173/Planet-Forge/', cycles = Number(process.argv[3] || 24);
const exe = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean).find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info', '--js-flags=--expose-gc'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })).newPage();
await page.addInitScript(() => {
  const s = window.__gl = { buffers: 0, textures: 0, programs: 0 };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) { if (!C) continue; const P = C.prototype, w = (n, f) => { const o = P[n]; P[n] = function (...a) { f(); return o.apply(this, a); }; };
    w('createBuffer', () => s.buffers++); w('deleteBuffer', () => s.buffers--); w('createTexture', () => s.textures++); w('deleteTexture', () => s.textures--); w('createProgram', () => s.programs++); w('deleteProgram', () => s.programs--); }
});
await page.goto(url + (url.includes('?') ? '&' : '?') + 'gfx=medium', { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__pfStarted, null, { timeout: 120000 }); await page.waitForTimeout(1500);
const snap = async label => { await page.evaluate(() => { window.gc?.(); window.gc?.(); }); await page.waitForTimeout(300); const m = await page.evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), ...window.__gl })); console.log(label.padEnd(10), JSON.stringify(m)); return m; };
const rows = [await snap('start')];
for (let c = 1; c <= cycles; c++) {
  await page.fill('#seed', 'MEM-' + (c % 6)); await page.press('#seed', 'Enter'); await page.waitForTimeout(150);
  await page.selectOption('#layer', c % 2 ? 'rivers' : 'winds'); await page.selectOption('#layer', 'biome');
  await page.selectOption('#graphics', ['low', 'medium', 'high'][c % 3]);
  if (c % 4 === 0) rows.push(await snap('cycle ' + c));
}
// Phase 2: heavy modes — rover descent/return, intervention lab (builds a second planet), history, transect.
await page.fill('#seed', 'ATLAS-001'); await page.press('#seed', 'Enter'); await page.waitForTimeout(400);
await page.click('#observatory'); await page.click('[data-tab=play]');
const town = await page.evaluate(() => window.__planetForgeView.settlementScreen()[0].cell);
for (let c = 1; c <= Math.max(4, cycles / 3); c++) {
  await page.selectOption('#play-mode', 'rover'); await page.evaluate(t => window.__planetForgeView.select(t), town); await page.click('#rover-start'); await page.waitForTimeout(200);
  for (let k = 0; k < 3; k++) await page.click('#drive-up'); await page.click('#return-orbit'); await page.waitForTimeout(150);
  await page.selectOption('#play-mode', 'lab'); await page.locator('#lab-tilt').fill(String(20 + c)); await page.click('#lab-run');
  await page.waitForFunction(() => /Mild, wet land/.test(document.querySelector('.drawer-body')?.innerText || ''), null, { timeout: 60000 }); await page.click('#lab-revert');
  await page.selectOption('#play-mode', 'kingdoms'); await page.selectOption('#play-mode', 'deeptime');
  rows.push(await snap('modes ' + c));
}
const first = rows[1], last = rows[rows.length - 1];
console.log(JSON.stringify({ heapGrowthMB: +(last.heapMB - first.heapMB).toFixed(1), buffers: last.buffers - first.buffers, textures: last.textures - first.textures, programs: last.programs - first.programs }));
await browser.close();
