// Climate/hydrology distribution diagnostics across 20 seeds at 100,002 cells.
// Usage: node scripts/climate-diagnostics.mjs [--json out.json]
// Reports, per seed: Köppen group shares of land, desert/steppe (B) share, polar annual mean temperature
// (|lat| > 66°, all cells), mean warmest and coldest month of land at 60-75°, the hottest month on any land cell
// poleward of 60°, ocean seasonal range at 50-60°, runoff ratio, inward-draining (endorheic) land share,
// biome shares, windward/lee July precipitation ratio, settlements with fresh water, and generation time.
import { writeFileSync } from 'node:fs';
import { geodesicMesh, createPlanet, planetSummary } from '../src/planet.js';
import { BIOMES, KOPPEN } from '../src/climate.js';

const seeds = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const mesh = geodesicMesh(100);
const rows = [], biomeTotals = {};
for (const seed of seeds) {
  const t0 = performance.now(); const p = createPlanet(seed, { mesh }); const ms = performance.now() - t0;
  const s = planetSummary(p), T = p.climate.temperatureMonthly, n = p.cellCount;
  let poT = 0, poN = 0, hiHot = 0, hiCold = 0, hiN = 0, hottest = -1e9, ocR = 0, ocN = 0, landN = 0, wS = 0, wN = 0, lS = 0, lN = 0;
  const kg = { A: 0, B: 0, C: 0, D: 0, E: 0 }, bc = {};
  for (let i = 0; i < n; i++) {
    let hot = -1e9, cold = 1e9; for (let m = 0; m < 12; m++) { const t = T[12 * i + m]; if (t > hot) hot = t; if (t < cold) cold = t; }
    const a = Math.abs(p.lat[i]), land = p.elevation[i] >= 0;
    if (a > 66) { poT += p.temperature[i]; poN++; }
    if (land) {
      landN++; kg[KOPPEN[p.koppen[i]][0]]++; const b = BIOMES[p.biome[i]]; bc[b] = (bc[b] || 0) + 1;
      if (a >= 60 && a <= 75) { hiHot += hot; hiCold += cold; hiN++; }
      if (a >= 60 && hot > hottest) hottest = hot;
      if (p.elevation[i] >= 200) { const up = p.climate.uplift[i], r = p.climate.precipitationMonthly[12 * i + 6]; if (up > 150) { wS += r; wN++; } else if (up < -150) { lS += r; lN++; } }
    } else if (a >= 50 && a <= 60) { ocR += hot - cold; ocN++; }
  }
  const pct = v => +(100 * v / landN).toFixed(1);
  for (const [b, c] of Object.entries(bc)) biomeTotals[b] = (biomeTotals[b] || 0) + c / landN / seeds.length;
  rows.push({ seed, tilt: p.tilt, ms: +ms.toFixed(0), meanT: s.meanTemperature, meanP: s.meanPrecipitation, 'A%': pct(kg.A), 'B%': pct(kg.B), 'C%': pct(kg.C), 'D%': pct(kg.D), 'E%': pct(kg.E),
    poleT: +(poT / poN).toFixed(1), hiLandHot: hiN ? +(hiHot / hiN).toFixed(1) : null, hiLandCold: hiN ? +(hiCold / hiN).toFixed(1) : null, hottestHiLat: hottest > -1e9 ? hottest : null, ocRange50_60: +(ocR / ocN).toFixed(1),
    runoffRatio: s.hydrology.runoffRatio, 'endo%': +(s.hydrology.endorheicLandFraction * 100).toFixed(1), shadow: lN ? +((wS / wN) / (lS / lN)).toFixed(2) : null,
    wetSettle: p.settlements.filter(x => x.water !== 'rain-fed').length + '/' + p.settlements.length });
}
const col = k => rows.map(r => r[k]).filter(v => v !== null);
const stat = k => { const v = col(k); return { min: Math.min(...v), mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(2), max: Math.max(...v) }; };
const summary = Object.fromEntries(['ms', 'meanT', 'meanP', 'A%', 'B%', 'C%', 'D%', 'E%', 'poleT', 'hiLandHot', 'hiLandCold', 'hottestHiLat', 'ocRange50_60', 'runoffRatio', 'endo%', 'shadow'].map(k => [k, stat(k)]));
summary.biomeMeanPct = Object.fromEntries(Object.entries(biomeTotals).sort((a, b) => b[1] - a[1]).map(([b, v]) => [b, +(100 * v).toFixed(1)]));
console.table(rows); console.log(JSON.stringify(summary, null, 1));
const o = process.argv.indexOf('--json'); if (o > 0) writeFileSync(process.argv[o + 1], JSON.stringify({ summary, rows }, null, 1));
