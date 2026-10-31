// Matched render-performance and GPU-resource probe for Planet Forge.
// Usage: node scripts/perf.mjs <url> [label]
// Instruments WebGL from outside the app (no app hooks needed), so the same script measures any build:
//  - frame intervals over a fixed window with the globe idle (reduced motion, so only rendering runs)
//  - draw calls and points/triangles drawn per frame
//  - live WebGL buffers / textures / programs and buffer bytes uploaded
//  - JS heap (Chrome performance.memory)
//  - leak check: live GPU objects before and after 8 forge + layer cycles
// Headless SwiftShader is a software rasteriser: absolute timings are not representative of real GPUs;
// compare runs of this script against each other only.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const url = process.argv[2] || 'http://localhost:4173/Planet-Forge/';
const label = process.argv[3] || 'run';
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean);
const executablePath = candidates.find(p => fs.existsSync(p));
const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });

const instrument = () => {
  const s = window.__glProbe = { draws: 0, primitives: 0, buffers: 0, textures: 0, programs: 0, bufferBytes: 0 };
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const P = C.prototype, wrap = (name, fn) => { const o = P[name]; P[name] = function (...a) { fn.apply(this, a); return o.apply(this, a); }; };
    wrap('drawArrays', (m, f, c) => { s.draws++; s.primitives += c; });
    wrap('drawElements', (m, c) => { s.draws++; s.primitives += m === 4 ? c / 3 : c; });
    wrap('createBuffer', () => s.buffers++); wrap('deleteBuffer', () => s.buffers--);
    wrap('createTexture', () => s.textures++); wrap('deleteTexture', () => s.textures--);
    wrap('createProgram', () => s.programs++); wrap('deleteProgram', () => s.programs--);
    wrap('bufferData', (t, d) => { s.bufferBytes += typeof d === 'number' ? d : (d?.byteLength || 0); });
  }
};

const out = { label, url, when: new Date().toISOString(), viewports: {} };
for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.addInitScript(instrument);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'networkidle' }); await page.waitForFunction(() => window.__pfStarted, null, { timeout: 120000 });
  await page.locator('#viewer canvas').waitFor({ state: 'visible' });
  await page.waitForTimeout(1500);
  const loadMs = Date.now() - t0;
  const frame = await page.evaluate(() => new Promise(resolve => {
    const g = window.__glProbe, d0 = g.draws, p0 = g.primitives, times = []; let last = 0, n = 0;
    const tick = t => { if (last) times.push(t - last); last = t; if (++n <= 121) requestAnimationFrame(tick); else {
      times.sort((a, b) => a - b);
      resolve({ frames: times.length, medianMs: +times[times.length >> 1].toFixed(2), p95Ms: +times[Math.floor(times.length * .95)].toFixed(2), meanMs: +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(2), drawsPerFrame: +((g.draws - d0) / times.length).toFixed(1), primitivesPerFrame: Math.round((g.primitives - p0) / times.length) });
    } };
    requestAnimationFrame(tick);
  }));
  const snap = () => page.evaluate(() => ({ ...window.__glProbe, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null }));
  const before = await snap();
  for (let i = 0; i < 8; i++) {
    await page.fill('#seed', 'PERF-' + i); await page.click('#generate');
    await page.selectOption('#layer', i % 2 ? 'rivers' : 'winds'); await page.selectOption('#layer', 'biome');
  }
  await page.fill('#seed', 'ATLAS-001'); await page.click('#generate'); await page.waitForTimeout(800);
  await page.evaluate(() => window.gc?.());
  const after = await snap();
  const sky = await page.evaluate(() => window.__planetForge?.sky || null);
  let skyTierLeak = null;
  if (sky) { // 12 tier switches must leave the same live GL objects once back on the starting tier
    const t0 = await snap();
    for (let i = 0; i < 12; i++) { await page.evaluate(q => window.__planetForgeSky.setQuality(q), ['low', 'medium', 'high'][i % 3]); await page.waitForTimeout(60); }
    await page.evaluate(q => window.__planetForgeSky.setQuality(q), sky.quality); await page.waitForTimeout(300);
    const t1 = await snap();
    skyTierLeak = { buffers: t1.buffers - t0.buffers, textures: t1.textures - t0.textures, programs: t1.programs - t0.programs, heapMB: [t0.heapMB, t1.heapMB] };
  }
  out.viewports[vp.name] = { loadMs, frame, gpuBefore: before, gpuAfterCycles: after, leak: { buffers: after.buffers - before.buffers, textures: after.textures - before.textures, programs: after.programs - before.programs }, sky, skyTierLeak };
  await context.close();
}
await browser.close();
console.log(JSON.stringify(out, null, 2));
