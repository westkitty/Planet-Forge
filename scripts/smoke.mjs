// Browser smoke test for Planet Forge.
// Usage: node scripts/smoke.mjs <url> [outDir]
// Needs a Chrome/Chromium binary: set CHROME_PATH, or it tries common locations.
// Exits non-zero if any check fails.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.argv[2] || 'http://localhost:4173/Planet-Forge/';
// Screenshot comparisons need a fixed graphics tier; Auto (the default) is exercised separately at the end.
const url = baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'gfx=high';
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
async function diff(page, a, b, threshold = 30) {
  return page.evaluate(async ([a64, b64, threshold]) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const A = await load(a64), B = await load(b64); let n = 0, changed = 0;
    for (let i = 0; i < Math.min(A.length, B.length); i += 4) { n++; if (Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]) > threshold) changed++; }
    return changed / n;
  }, [a.toString('base64'), b.toString('base64'), threshold]);
}

for (const vp of [{ name: 'desktop', width: 1280, height: 800 }, { name: 'mobile', width: 390, height: 844 }]) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, reducedMotion: 'reduce', hasTouch: vp.name === 'mobile', acceptDownloads: true });
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
  const footprint = await page.evaluate(() => {
    const view = document.querySelector('#viewer').getBoundingClientRect();
    const console = document.querySelector('.panel').getBoundingClientRect();
    const screen = innerWidth * innerHeight;
    return { viewer: view.width * view.height / screen, ui: console.width * console.height / screen };
  });
  check(p + 'visual console occupies at most 15% of screen', footprint.ui <= 0.15, JSON.stringify(footprint));
  check(p + 'planet viewing area is at least 85% of screen', footprint.viewer >= 0.85, JSON.stringify(footprint));

  const shot0 = await canvas.screenshot();
  const skyInitial = await page.screenshot({ clip: vp.name === 'desktop' ? { x: box.x, y: box.y, width: 260, height: 180 } : { x: box.x, y: box.y + box.height - 95, width: box.width, height: 90 } });
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

  // PF-01 starfield: a patch of sky clear of the globe must be populated and must not move when the globe rotates,
  // the world is re-forged, or the atlas layer changes (stars are in the fixed sky frame, not the planet's frame).
  const skyClip = vp.name === 'desktop' ? { x: box.x, y: box.y, width: 260, height: 180 } : { x: box.x, y: box.y + box.height - 95, width: box.width, height: 90 };
  const skyAfterRot = await page.screenshot({ clip: skyClip });
  const skyStats = await canvasStats(page, skyAfterRot);
  check(p + 'starfield renders in open sky', skyStats.colours > 25, `distinct colours=${skyStats.colours}, meanLum=${skyStats.meanLum.toFixed(1)}`);
  const skyMove = await diff(page, skyInitial, skyAfterRot, 12);
  check(p + 'sky is unchanged by re-forging and rotating the globe', skyMove < 0.002, `changed fraction=${skyMove.toFixed(4)}`);
  await page.selectOption('#layer', 'plates'); await page.waitForTimeout(300);
  const skyLayer = await diff(page, skyInitial, await page.screenshot({ clip: skyClip }), 12);
  await page.selectOption('#layer', 'biome'); await page.waitForTimeout(300);
  check(p + 'sky is unchanged by layer switching', skyLayer < 0.002, `changed fraction=${skyLayer.toFixed(4)}`);
  const sky0 = await page.evaluate(() => window.__planetForge.sky);
  check(p + 'sky catalogue is the fixed seeded catalogue with galaxies and no shader fallback', sky0 && sky0.seed === 'PLANET-FORGE-SKY-1' && sky0.signature === 'b0d0aa15' && sky0.catalogue === 14000 && sky0.galaxies === 10 && sky0.fallback === false && sky0.drawn >= 4500, JSON.stringify(sky0));

  // ---- Milestone 1 (PF-02/03/05/06/07/08) ----
  const view0 = await page.evaluate(() => window.__planetForgeView.info());
  check(p + 'natural view has sunlight, ocean shading, climate clouds and cloud shadows', view0.natural && view0.ocean && view0.clouds && view0.cloudShadows && view0.quality === 'high', JSON.stringify(view0));
  const centreClip = { x: cx - box.width * .12, y: cy - box.height * .12, width: box.width * .24, height: box.height * .24 };
  const cloudRef = await page.screenshot({ clip: centreClip });
  const lum = async () => (await canvasStats(page, await page.screenshot({ clip: centreClip }))).meanLum;
  const sunA = view0.subsolarLon, facing = await page.evaluate(() => window.__planetForgeView.viewLongitude());
  await page.evaluate(l => window.__planetForgeView.setSubsolarLongitude(l), facing); await page.waitForTimeout(300);
  const lumDay = await lum();
  await page.evaluate(l => window.__planetForgeView.setSubsolarLongitude(l), facing + 180); await page.waitForTimeout(300);
  const lumNight = await lum();
  check(p + 'sun behind the planet leaves the visible disc in night (day/night terminator)', lumDay > lumNight * 1.8, `noon facing ${lumDay.toFixed(1)} vs midnight facing ${lumNight.toFixed(1)}`);
  await page.evaluate(l => window.__planetForgeView.setSubsolarLongitude(l), sunA); await page.waitForTimeout(300);
  const lumA = (await canvasStats(page, cloudRef)).meanLum;
  const restoredSun = Math.abs(await lum() - lumA) < 0.5;
  check(p + 'returning the sun restores the lit view', restoredSun);
  await page.click('#daycycle'); await page.waitForTimeout(1500);
  const playing = await page.evaluate(() => window.__planetForgeView.info());
  await page.click('#daycycle');
  check(p + 'day-cycle play button advances solar time and pauses', playing.dayPlaying && Math.abs(playing.subsolarLon - sunA) > 1 && !(await page.evaluate(() => window.__planetForgeView.info())).dayPlaying, `subsolar ${sunA} → ${playing.subsolarLon}`);
  await page.evaluate(l => window.__planetForgeView.setSubsolarLongitude(l), sunA); await page.waitForTimeout(200);
  const cloudOn = await canvas.screenshot();
  await page.click('#clouds'); await page.waitForTimeout(300);
  const cloudOffInfo = await page.evaluate(() => window.__planetForgeView.info()), cloudOff = await canvas.screenshot();
  await page.click('#clouds'); await page.waitForTimeout(300);
  const cloudDiff = await diff(page, cloudOn, cloudOff, 20), cloudBack = await diff(page, cloudOn, await canvas.screenshot(), 20);
  check(p + 'cloud toggle hides and restores clouds and their shadows', !cloudOffInfo.clouds && !cloudOffInfo.cloudShadows && cloudDiff > 0.01 && cloudBack < 0.002, `off diff=${cloudDiff.toFixed(3)}, back=${cloudBack.toFixed(4)}`);
  await page.selectOption('#layer', 'elevation'); await page.waitForTimeout(300);
  const sciView = await page.evaluate(() => window.__planetForgeView.info());
  await page.selectOption('#layer', 'biome'); await page.waitForTimeout(300);
  check(p + 'scientific layers use studio light with no clouds or ocean effects', !sciView.natural && !sciView.clouds && !sciView.ocean, JSON.stringify(sciView));
  const sites = (await page.evaluate(() => window.__planetForgeView.settlementScreen())).filter(t => t.facing > .35 && t.x > box.x + 20 && t.x < box.x + box.width - 20 && t.y > box.y + 20 && t.y < box.y + box.height - 20);
  if (sites.length) {
    await page.mouse.click(sites[0].x, sites[0].y); await page.waitForTimeout(200);
    const si = await page.locator('#inspect').innerText(), sel = (await page.evaluate(() => window.__planetForgeView.info())).selectedSettlement;
    check(p + 'clicking a settlement marker selects that settlement and reports its site', si.startsWith('Settlement ' + sites[0].name) && sel === sites[0].k, si.slice(0, 160));
  } else check(p + 'clicking a settlement marker selects that settlement and reports its site', false, 'no settlement facing the camera');
  await page.selectOption('#graphics', 'low'); await page.waitForTimeout(400);
  const lowInfo = await page.evaluate(() => ({ v: window.__planetForgeView.info(), s: window.__planetForgeSky.info() }));
  const lowShot = await canvasStats(page, await canvas.screenshot());
  await page.selectOption('#graphics', 'high'); await page.waitForTimeout(400);
  const highInfo = await page.evaluate(() => ({ v: window.__planetForgeView.info(), s: window.__planetForgeSky.info() }));
  check(p + 'graphics selector switches tiers (low: no ocean effects, fewer stars; high restored)', lowInfo.v.quality === 'low' && !lowInfo.v.ocean && !lowInfo.v.cloudShadows && lowInfo.s.drawn === 4500 && lowShot.colours > 40 && highInfo.v.quality === 'high' && highInfo.s.drawn === 14000 && highInfo.v.ocean, `${JSON.stringify(lowInfo.v)} / ${highInfo.s.drawn}`);

  // ---- Milestone 2 (PF-09/10/11/12/13/27/30/31) ----
  const V = () => page.evaluate(() => window.__planetForgeView.info());
  const m2Start = await page.evaluate(() => window.__planetForgeView.info());
  if (vp.name === 'desktop') {
    await page.mouse.move(cx + 30, cy - 20); await page.waitForTimeout(250);
    check(p + 'hovering the globe shows a hover marker without selecting', (await V()).overlays.hover === true, JSON.stringify((await V()).overlays));
  }
  let pickOK = 0, picks = [];
  for (const [fx, fy] of [[0, 0], [.18, -.1], [-.15, .12], [.05, .2], [-.2, -.15]]) {
    const c = await page.evaluate(([x, y]) => window.__planetForgeView.select(-1) || 0, [0, 0]);
    await page.mouse.click(cx + fx * box.width * .5, cy + fy * box.height * .5); await page.waitForTimeout(120);
    const sel = (await V()).selected; if (sel < 0) { picks.push('miss'); continue; }
    const scr = await page.evaluate(c => window.__planetForgeView.cellScreen(c), sel);
    await page.evaluate(() => window.__planetForgeView.select(-1));
    await page.mouse.click(scr.x, scr.y); await page.waitForTimeout(120);
    const again = (await V()).selected, nb = await page.evaluate(c => window.__planetForgeView.neighbours(c), sel);
    if (again === sel || nb.includes(again)) pickOK++; picks.push(sel + '→' + again);
  }
  check(p + 'clicking a cell\'s projected position selects that cell (or a neighbour)', pickOK === 5, picks.join(' '));
  const selInfo = await V(), labelShown = await page.locator('#cell-label').isVisible();
  check(p + 'exactly one selection reticle and a contextual label', selInfo.overlays.reticle && selInfo.selected >= 0 && labelShown && (await page.locator('#cell-label').innerText()).includes(' m'), JSON.stringify(selInfo.overlays));
  await page.click('#observatory'); await page.waitForTimeout(150);
  check(p + 'observatory drawer opens on demand', await page.locator('#drawer').isVisible() && (await page.getAttribute('#observatory', 'aria-expanded')) === 'true');
  await page.click('[data-topic=terrain]'); await page.waitForTimeout(100);
  const why = await page.locator('.why-out').innerText();
  check(p + 'Why engine answers with computed facts, inference and unknowns', /COMPUTED FACTS/i.test(why) && /Elevation -?\d+ m/.test(why) && /NOT MODELLED/i.test(why), why.slice(0, 160));
  if (vp.name === 'desktop') {
    await page.click('[data-topic=climate]'); await page.waitForTimeout(100);
    check(p + 'Why engine climate answer quotes rainfall', /Rainfall \d+ mm\/yr/.test(await page.locator('.why-out').innerText()));
    await page.click('text=Record discovery'); await page.waitForTimeout(100);
    const afterDisc = await V();
    check(p + 'recording a discovery logs an event and fires a pooled effect', afterDisc.store.discoveries === 1 && afterDisc.overlays.spawned >= 1 && afterDisc.overlays.activeEffects <= afterDisc.overlays.poolSize, JSON.stringify(afterDisc.store) + ' ' + JSON.stringify(afterDisc.overlays));
    // Transect between two picked places
    await page.click('[data-tab=transect]');
    await page.evaluate(() => window.__planetForgeView.select(1348)); await page.click('text=Set start');
    await page.evaluate(() => window.__planetForgeView.select(4000)); await page.click('text=Set end');
    await page.click('#transect-run'); await page.waitForTimeout(200);
    const tx = await page.locator('.drawer-body').innerText();
    check(p + 'transect draws a profile with units and an on-globe path', (await V()).overlays.transect && /\d[\d,]* km, \d+ cells/.test(tx) && /mm\/yr/.test(tx) && await page.locator('.drawer-body svg').count() === 1, tx.slice(0, 160));
    const [csv] = await Promise.all([page.waitForEvent('download'), page.click('text=Export CSV')]);
    const csvText = fs.readFileSync(await csv.path(), 'utf8');
    check(p + 'transect exports CSV rows', csvText.startsWith('distance_km,cell,lat,lon,elevation_m') && csvText.split('\n').length > 10, csvText.split('\n').length + ' lines');
    // Correlation query
    await page.click('[data-tab=correlate]'); await page.selectOption('#query', 'dryNearHighlands'); await page.click('#query-run'); await page.waitForTimeout(400);
    const cq = await page.locator('.drawer-body').innerText();
    check(p + 'correlation query reports counts, lift and highlights matches', /Lift: [\d.]+×/.test(cq) && /does not show that one causes the other/.test(cq) && (await V()).overlays.highlights > 0, cq.slice(0, 200));
    // Investigation: record 3+3 real sites and conclude
    await page.click('[data-tab=investigate]'); await page.selectOption('#investigation', 'seafloorAge');
    const A = await page.evaluate(() => window.__planetForgeView.eligibleSites('seafloorAge', 'A', 3)), B = await page.evaluate(() => window.__planetForgeView.eligibleSites('seafloorAge', 'B', 3));
    for (const c of A) { await page.evaluate(c => window.__planetForgeView.select(c), c); await page.click('#inv-add-a'); }
    for (const c of B) { await page.evaluate(c => window.__planetForgeView.select(c), c); await page.click('#inv-add-b'); }
    await page.evaluate(c => window.__planetForgeView.select(c), A[0]); await page.click('#inv-add-b'); await page.waitForTimeout(80);
    const refusal = await page.locator('.drawer-status').innerText();
    await page.click('#inv-supported'); await page.waitForTimeout(100);
    const verdict = await page.locator('.verdict').innerText();
    check(p + 'investigation enforces site rules and returns an evidence-based verdict', /already recorded|already has 3|not a valid/.test(refusal) && /mean A [\d.]+ vs mean B [\d.]+ m/.test(verdict) && /H1 (supported|rejected)/.test(verdict) && (await V()).store.journal === 1, refusal + ' / ' + verdict.slice(0, 140));
    // Tours and bookmarks
    await page.click('[data-tab=tours]'); await page.fill('[aria-label="Bookmark name"]', 'Home'); await page.click('#bookmark-save'); await page.waitForTimeout(100);
    await page.selectOption('#tour-route', 'mountains'); await page.click('#tour-start'); await page.waitForTimeout(400);
    const t1 = await V();
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(150);
    const t2 = await V();
    check(p + 'tour flies to data-picked stops and any input interrupts it', t1.tour && t1.tour.of >= 3 && t1.selected >= 0 && !t2.tour && t2.lastTourEnd === 'interrupted' && t2.store.bookmarks === 1 && await page.locator('#tour-caption').isHidden(), JSON.stringify([t1.tour, t2.lastTourEnd]));
    // Journal: save, change, load, undo/redo, export/import, corrupt import
    await page.click('[data-tab=journal]'); await page.click('#save-local'); await page.waitForTimeout(80);
    const savedRot = (await V()).rotation;
    await page.click('#undo'); await page.waitForTimeout(80);
    const undone = await V(); await page.click('#redo'); await page.waitForTimeout(80); const redone = await V();
    await page.click('#load-local'); await page.waitForTimeout(400);
    const loaded = await V(), loadMsg = await page.locator('.drawer-status').innerText();
    const [sv] = await Promise.all([page.waitForEvent('download'), page.click('#save-export')]);
    const savePath = path.join(outDir, 'desktop-save.json'); await sv.saveAs(savePath);
    await page.setInputFiles('#save-import', savePath); await page.waitForTimeout(500);
    const importMsg = await page.locator('.drawer-status').innerText();
    fs.writeFileSync(path.join(outDir, 'corrupt.save.json'), '{"schema":"planet-forge-save","saveVersion":99}');
    await page.setInputFiles('#save-import', path.join(outDir, 'corrupt.save.json')); await page.waitForTimeout(200);
    const corruptMsg = await page.locator('.drawer-status').innerText();
    check(p + 'saves round-trip, undo/redo restore state, corrupt or future saves are refused', undone.store.bookmarks === 0 && redone.store.bookmarks === 1 && /Save loaded/.test(loadMsg) && loaded.store.events === redone.store.events && Math.abs(loaded.rotation[1] - savedRot[1]) < 1e-6 && /Save loaded/.test(importMsg) && /Load refused: save version 99 is newer/.test(corruptMsg), [loadMsg, importMsg, corruptMsg].join(' | '));
  }
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  check(p + 'Escape closes the drawer and the console stays within budget', await page.locator('#drawer').isHidden() && await page.evaluate(() => document.querySelector('.panel').getBoundingClientRect().height / innerHeight) <= .15);
  await page.fill('#seed', 'SMOKE-42'); await page.press('#seed', 'Enter'); await page.waitForTimeout(300);
  const cleared = await V();
  await page.fill('#seed', 'ATLAS-001'); await page.press('#seed', 'Enter'); await page.waitForTimeout(300);
  check(p + 'a new world clears the selection and overlays', cleared.selected === -1 && !cleared.overlays.reticle && !cleared.overlays.transect && cleared.overlays.highlights === 0, JSON.stringify(cleared.overlays));
  await page.evaluate(v => window.__planetForgeView.setRotation(v.rotation[0], v.rotation[1], v.zoom), m2Start); await page.waitForTimeout(200);

  // Zoom by wheel
  await page.mouse.move(cx, cy);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(40); }
  await page.waitForTimeout(300);
  const afterZoom = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-2-zoomed.png`), afterZoom);
  const zm = await diff(page, afterRot, afterZoom);
  check(p + 'wheel zooms globe', zm > 0.02, `changed fraction=${zm.toFixed(3)}`);


  if (vp.name === 'mobile') {
    const inspectionBefore = await page.locator('#inspect').innerText();
    const cdp = await context.newCDPSession(page);
    const initial = await canvas.screenshot();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx - 85, y: cy, id: 1 }, { x: cx + 85, y: cy, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(180);
    const result = await canvas.screenshot();
    const change = await diff(page, initial, result);
    const inspectionAfter = await page.locator('#inspect').innerText();
    check(p + 'two-finger pinch zooms without unwanted inspection', change > 0.02 && inspectionAfter === inspectionBefore, 'changed fraction=' + change.toFixed(3));
    await cdp.detach();
  }
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
  const daj = await diff(page, sAnn, sJan, 20);
  check(p + 'season selector changes temperature map', dj > 0.02 && daj > 0.003, `jan->jul changed fraction=${dj.toFixed(3)}, annual->jan=${daj.toFixed(3)}`);
  await page.selectOption('#tilt', '60'); await page.waitForTimeout(1500);
  const sT60 = await canvas.screenshot();
  const tiltStats = await page.locator('#stats').innerText();
  fs.writeFileSync(path.join(outDir, `${vp.name}-3-tilt60-jul.png`), sT60);
  check(p + 'axial tilt selector re-forges climate', /Axial tilt: 60°/.test(tiltStats) && (await diff(page, sJul, sT60)) > 0.02, tiltStats.replace(/\n/g, ' | '));
  await page.selectOption('#tilt', 'seed'); await page.selectOption('#season', 'annual'); await page.selectOption('#layer', 'biome'); await page.waitForTimeout(1500);
  const sBack = await canvas.screenshot();
  check(p + 'returning to seeded tilt restores identical globe', (await diff(page, prev, sBack)) < 0.002);

  // Ice age (glacial-0.8): the era toggle computes the glacial maximum on demand and redraws ice sheets and exposed
  // shelves over the current layer; the Ice age layer shows ice thickness and land bridges; returning restores today.
  await page.selectOption('#era', 'glacial');
  await page.waitForFunction(() => window.__planetForge && typeof window.__planetForge.glacialMs === 'number', null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const sGl = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-3-era-glacial.png`), sGl);
  const dGl = await diff(page, sBack, sGl), ice = await page.locator('#iceage').innerText(), glStats = await page.locator('#stats').innerText(), gperf = await page.evaluate(() => window.__planetForge);
  check(p + 'era toggle draws the glacial maximum', dGl > 0.01 && /Glacial sea fall: [\d.]+ m/.test(glStats), `changed fraction=${dGl.toFixed(3)}, glacialMs=${gperf && gperf.glacialMs}`);
  check(p + 'ice-age gazetteer lists sea fall, ice sheets and land bridges', /the sea fell [\d.]+ m/.test(ice) && /Ice sheets: /.test(ice) && /Land bridges: /.test(ice), ice.slice(0, 220));
  await page.selectOption('#layer', 'glacial'); await page.waitForTimeout(500);
  const sGlL = await canvas.screenshot();
  fs.writeFileSync(path.join(outDir, `${vp.name}-3-layer-glacial.png`), sGlL);
  check(p + 'ice age layer changes colours', (await diff(page, sGl, sGlL)) > 0.02);
  await page.selectOption('#era', 'today'); await page.selectOption('#layer', 'biome'); await page.waitForTimeout(500);
  check(p + 'returning to today restores identical globe', (await diff(page, sBack, await canvas.screenshot())) < 0.002);

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
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); ok = j.seed === 'ATLAS-001' && Array.isArray(j.rivers) && j.rivers.length > 0 && j.columns?.dischargeM3s?.length === j.cellCount && Array.isArray(j.sampledCells) && j.sampledCells.length > 1000 && Array.isArray(j.settlements) && j.columns?.glacialState?.length === j.cellCount && j.columns?.glacialIceM?.length === j.cellCount && j.glacial?.stats?.seaLevelFallM >= 0 && Array.isArray(j.glacial?.landBridges) && Array.isArray(j.glacial?.iceSheets); detail = `${dl.suggestedFilename()} seed=${j.seed} cells=${j.sampledCells?.length} version=${j.version}`; } catch (e) { detail = e.message; }
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
  await page.focus('#seed');
  const order = ['seed'];
  for (let i = 0; i < 10; i++) { await page.keyboard.press('Tab'); order.push(await page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName)); }
  check(p + 'keyboard focus from seed reaches forge, layer, era, random, export', ['seed', 'generate', 'layer', 'season', 'tilt', 'era', 'random', 'export'].every(id => order.includes(id)), order.join(' > '));
  const perf = await page.evaluate(() => window.__planetForge);
  check(p + 'climate model loaded with ~100k cells', perf && perf.version === 'glacial-0.8' && perf.cells === 100002 && perf.tilt >= 10 && perf.tilt <= 35, JSON.stringify(perf));
  const lang = await page.evaluate(() => document.documentElement.lang);
  check(p + 'document language set', !!lang, lang);

  // PF-01 quality tiers: each tier renders, keeps the same catalogue, and the auto tier is restored afterwards.
  const tiers = [];
  for (const q of ['low', 'medium', 'high']) {
    const info = await page.evaluate(q => window.__planetForgeSky.setQuality(q), q); await page.waitForTimeout(250);
    const st = await canvasStats(page, await canvas.screenshot());
    tiers.push(`${q}:${info.drawn}/${info.limitingMagnitude}/${st.colours}`);
    if (!(info.quality === q && info.signature === sky0.signature && !info.fallback && st.colours > 40)) tiers.push('FAILED');
  }
  await page.evaluate(q => window.__planetForgeSky.setQuality(q), sky0.quality);
  check(p + 'sky quality tiers low/medium/high render with one catalogue', !tiers.includes('FAILED'), tiers.join(' '));
  // PF-01: after WebGL context loss and restore the scene redraws and the re-baked sky matches the original.
  if (vp.name === 'desktop') {
    const skyBeforeLoss = await page.screenshot({ clip: skyClip });
    await page.evaluate(() => { window.__lc = document.querySelector('#viewer canvas').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lc.loseContext(); });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__lc.restoreContext()); await page.waitForTimeout(2000);
    const restored = await canvasStats(page, await canvas.screenshot());
    const skyRestore = await diff(page, skyBeforeLoss, await page.screenshot({ clip: skyClip }), 12);
    check(p + 'WebGL context restore redraws the globe and re-bakes the same sky', restored.colours > 40 && skyRestore < 0.002, `colours=${restored.colours}, sky changed fraction=${skyRestore.toFixed(4)}`);
  }
  check(p + 'zero console/page/network errors', errors.length === 0, errors.join(' ; '));
  await context.close();
}
{ // PF-03 Auto: on this software renderer frames are far over budget, so Auto must step down from measurements.
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__planetForgeView && window.__planetForgeView.info().controller.changes.length > 0, null, { timeout: 30000 }).catch(() => {});
  const q = await page.evaluate(() => window.__planetForgeView.info());
  const label = await page.locator('#graphics option[value=auto]').innerText();
  check('[auto] measured frame times step the Auto tier down with a recorded reason', q.controller.mode === 'auto' && q.controller.changes.length > 0 && /median/.test(q.controller.changes[0].reason) && label === 'Auto (' + q.quality + ')', JSON.stringify(q.controller) + ' label=' + label);
  await context.close();
}
await browser.close();
const failed = results.filter(r => !r.ok);
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ url, when: new Date().toISOString(), results }, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
