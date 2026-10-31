// Browser smoke test for Planet Forge.
// Usage: node scripts/smoke.mjs <url> [outDir]
// Needs a Chrome/Chromium binary: set CHROME_PATH, or it tries common locations.
// Exits non-zero if any check fails.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const url = process.argv[2] || 'http://localhost:4173/Planet-Forge/';
const outDir = process.argv[3] || 'smoke-artifacts';
fs.mkdirSync(outDir, { recursive: true });
const candidates = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const executablePath = candidates.find(p => fs.existsSync(p));
if (!executablePath) { console.error('No Chrome binary found; set CHROME_PATH'); process.exit(2); }

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function canvasStats(page, buf) {
  // Decode a PNG screenshot in the page and measure pixel variety.
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; const seen = new Set(); let lum = 0;
    for (let i = 0; i < d.length; i += 16) { seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3)); lum += d[i] + d[i + 1] + d[i + 2]; }
    return { colours: seen.size, meanLum: lum / (d.length / 16) / 3 };
  }, buf.toString('base64'));
}
async function diff(page, a, b) {
  return page.evaluate(async ([a64, b64]) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const A = await load(a64), B = await load(b64); let n = 0, changed = 0;
    for (let i = 0; i < Math.min(A.length, B.length); i += 4) { n++; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > 30) changed++; }
    return changed / n;
  }, [a.toString('base64'), b.toString('base64')]);
}

for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));
  page.on('response', r => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  const p = `[${vp.name}] `;

  await page.goto(url, { waitUntil: 'networkidle' });
  const canvas = page.locator('#viewer canvas');
  await canvas.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(800);
  const box = await canvas.boundingBox();
  check(p + 'canvas has size', box && box.width > 100 && box.height > 100, JSON.stringify(box));

  const shot0 = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-0-initial.png`), shot0);
  const st = await canvasStats(page, shot0);
  check(p + 'globe renders (non-blank canvas)', st.colours > 40, `distinct colours=${st.colours}, meanLum=${st.meanLum.toFixed(1)}`);

  const stats0 = await page.locator('#stats').innerText();
  check(p + 'initial world generated', /Seed: ATLAS-001/.test(stats0) && /Cells sampled: \d+/.test(stats0), stats0.replace(/\n/g, ' | '));

  // Seed entry via keyboard Enter
  await page.fill('#seed', 'SMOKE-42');
  await page.press('#seed', 'Enter');
  await page.waitForTimeout(500);
  const stats1 = await page.locator('#stats').innerText();
  check(p + 'seed entry regenerates world', /Seed: SMOKE-42/.test(stats1), stats1.replace(/\n/g, ' | '));
  const shotSeed = await canvas.screenshot();
  check(p + 'new seed changes globe', (await diff(page, shot0, shotSeed)) > 0.01);
  // Forge button with original seed restores identical world (determinism in UI)
  await page.fill('#seed', 'ATLAS-001'); await page.click('#generate'); await page.waitForTimeout(500);
  const shotBack = await canvas.screenshot();
  const back = await diff(page, shot0, shotBack);
  check(p + 'same seed reproduces identical globe image', back < 0.002, `changed fraction=${back.toFixed(4)}`);

  // Settlements and chronicle
  const sett = await page.locator('#settlements').innerText();
  const chron = await page.locator('#chronicle').innerText();
  check(p + 'settlements listed', sett.trim().length > 0 && !/No viable/.test(sett), sett.slice(0, 120));
  const rivs = await page.locator('#rivers').innerText();
  check(p + 'great rivers listed with discharge and length', /River · [\d,]+ m³\/s · [\d,]+ km/.test(rivs), rivs.slice(0, 140));
  check(p + 'hydrology stats shown', /Rivers to sea: \d+k m³\/s/.test(stats1) || /Rivers to sea/.test(await page.locator('#stats').innerText()));
  check(p + 'chronicle listed', /\d+ — /.test(chron), chron.slice(0, 120));

  // Rotation by drag
  const before = await canvas.screenshot();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 120, cy + 20, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(300);
  const afterRot = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-1-rotated.png`), afterRot);
  const rot = await diff(page, before, afterRot);
  check(p + 'drag rotates globe', rot > 0.02, `changed fraction=${rot.toFixed(3)}`);

  // Zoom by wheel
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await page.waitForTimeout(300);
  const afterZoom = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-2-zoomed.png`), afterZoom);
  const zm = await diff(page, afterRot, afterZoom);
  check(p + 'wheel zooms globe', zm > 0.02, `changed fraction=${zm.toFixed(3)}`);

  // Layer selection
  let prev = afterZoom;
  for (const layer of ['elevation', 'temperature', 'rainfall', 'plates', 'boundaries', 'age', 'koppen', 'winds', 'rivers', 'basins', 'biome']) {
    await page.selectOption('#layer', layer); await page.waitForTimeout(400);
    const s = await canvas.screenshot();
    fs.writeFileSync(path.join(outDir, `${vp.name}-3-layer-${layer}.png`), s);
    const d = await diff(page, prev, s);
    check(p + `layer ${layer} changes colours`, d > 0.02, `changed fraction=${d.toFixed(3)}`);
    prev = s;
  }

  // Season selector changes the temperature layer; tilt selector re-forges the climate
  await page.selectOption('#layer', 'temperature'); await page.waitForTimeout(400);
  const sAnn = await canvas.screenshot();
  await page.selectOption('#season', 'jan'); await page.waitForTimeout(400);
  const sJan = await canvas.screenshot();
  await page.selectOption('#season', 'jul'); await page.waitForTimeout(400);
  const sJul = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-3-season-jul.png`), sJul);
  const dj = await diff(page, sJan, sJul);
  // season-0.5: with heat-capacity-damped seasons January differs from the annual map mostly over land (~0.7% of pixels
  // on ATLAS-001, tilt 13.7°), so the annual->January threshold is 0.3% (was 1% when oceans swung ±14 K); Jan->Jul stays 2%.
  const daj = await diff(page, sAnn, sJan);
  check(p + 'season selector changes temperature map', dj > 0.02 && daj > 0.003, `jan->jul changed fraction=${dj.toFixed(3)}, annual->jan=${daj.toFixed(3)}`);
  await page.selectOption('#tilt', '60'); await page.waitForTimeout(1500);
  const sT60 = await canvas.screenshot();
  const tiltStats = await page.locator('#stats').innerText();
  fs.writeFileSync(path.join(outDir, `${vp.name}-3-tilt60-jul.png`), sT60);
  check(p + 'axial tilt selector re-forges climate', /Axial tilt: 60°/.test(tiltStats) && (await diff(page, sJul, sT60)) > 0.02, tiltStats.replace(/\n/g, ' | '));
  await page.selectOption('#tilt', 'seed'); await page.selectOption('#season', 'annual'); await page.selectOption('#layer', 'biome'); await page.waitForTimeout(1500);
  const sBack = await canvas.screenshot();
  check(p + 'returning to seeded tilt restores identical globe', (await diff(page, prev, sBack)) < 0.002);

  // Cell inspection by click at centre (after drag + layer changes, orientation must be kept)
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(200);
  const insp = await page.locator('#inspect').innerText();
  check(p + 'cell inspection on click', /° lat, .*° lon · .* m · .* °C/.test(insp), insp);
  check(p + 'inspection reports tectonic plate', /plate \d+ \((continental|oceanic), [\d.]+ cm\/yr\)/.test(insp), insp);
  check(p + 'inspection reports Köppen class and seasonal climate', /Köppen (Af|Am|Aw|BW[hk]|BS[hk]|C[swf][abc]|D[swf][abcd]|ET|EF|Ocean) · .* °C \(Jan -?[\d.]+, Jul -?[\d.]+\) · \d+ mm\/yr/.test(insp), insp);
  check(p + 'layer change keeps globe orientation', !/^0° lat, 90° lon/.test(insp), insp);

  // Keyboard globe control
  await canvas.focus();
  const kb0 = await canvas.screenshot();
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const kb1 = await canvas.screenshot();
  const kd = await diff(page, kb0, kb1);
  check(p + 'arrow keys rotate focused globe', kd > 0.02, `changed fraction=${kd.toFixed(3)}`);
  await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const insp2 = await page.locator('#inspect').innerText();
  check(p + 'Enter inspects centre cell', insp2 !== insp && /° lat/.test(insp2), insp2);

  // JSON export
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('#export')]);
  const file = path.join(outDir, `${vp.name}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  let ok = false, detail = '';
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); ok = j.seed === 'ATLAS-001' && Array.isArray(j.rivers) && j.rivers.length > 0 && j.columns?.dischargeM3s?.length === j.cellCount && Array.isArray(j.sampledCells) && j.sampledCells.length > 1000 && Array.isArray(j.settlements); detail = `${dl.suggestedFilename()} seed=${j.seed} cells=${j.sampledCells?.length} version=${j.version}`; } catch (e) { detail = e.message; }
  check(p + 'JSON export downloads valid atlas', ok, detail);

  // Responsive: no horizontal overflow, panel visible
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(p + 'no horizontal overflow', overflow <= 0, `overflow=${overflow}px`);
  await page.screenshot({ path: path.join(outDir, `${vp.name}-4-fullpage.png`), fullPage: true });

  // Accessibility basics: every control has an accessible name; keyboard reaches controls
  const unnamed = await page.evaluate(() => [...document.querySelectorAll('input,select,button')].filter(el => {
    const lbl = el.labels && el.labels.length ? [...el.labels].map(l => l.textContent).join('') : '';
    return !(el.getAttribute('aria-label') || lbl.trim() || el.textContent.trim());
  }).map(el => el.id || el.tagName));
  check(p + 'all controls have accessible names', unnamed.length === 0, unnamed.join(','));
  await page.focus('body');
  const order = [];
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)); }
  check(p + 'keyboard focus reaches seed, forge, layer, random, export', ['seed', 'generate', 'layer', 'season', 'tilt', 'random', 'export'].every(id => order.includes(id)), order.join(' > '));
  const perf = await page.evaluate(() => window.__planetForge);
  check(p + 'climate model loaded with ~100k cells', perf && perf.version === 'eddy-0.6' && perf.cells === 100002 && perf.tilt >= 10 && perf.tilt <= 35, JSON.stringify(perf));
  const lang = await page.evaluate(() => document.documentElement.lang);
  check(p + 'document language set', !!lang, lang);

  check(p + 'zero console/page/network errors', errors.length === 0, errors.join(' ; '));
  await context.close();
}
await browser.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ url, when: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
