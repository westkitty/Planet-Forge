// Eddy moisture transport (eddy-0.6, F-0007): zonal-band down-gradient diffusion of in-transit moisture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geodesicMesh, createPlanet, planetSummary, MODEL_VERSION } from '../src/planet.js';
import { eddyStep, eddyFactors, EDDY_BANDS, EDDY_DIFFUSIVITY, KOPPEN } from '../src/climate.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);

test('version, diffusivity from the literature, stable sub-steps', () => {
  assert.ok(['eddy-0.6', 'glacial-0.7'].includes(MODEL_VERSION)); // glacial-0.7 (WIP) builds on eddy-0.6
  assert.ok(EDDY_DIFFUSIVITY >= 1e6 && EDDY_DIFFUSIVITY <= 2e6); // Hwang & Frierson 2010: 1.06e6; Frierson et al. 2007: 1.84-1.87e6
  for (const km of [30, 76.4, 240, 600]) { const e = eddyStep(km); assert.ok(e.step <= 0.45 && Math.abs(e.step * e.sub - e.alpha) < 1e-12, JSON.stringify(e)); }
  assert.ok(Math.abs(eddyStep(76.4).alpha / 3 - 0.413) < 0.01); // D dt / dy^2 per transport iteration at 100,002 cells
});

test('band diffusion conserves moisture, stays non-negative and moves it down-gradient', () => {
  const count = new Float64Array(EDDY_BANDS), M = new Float64Array(EDDY_BANDS), Q = new Float64Array(EDDY_BANDS), mul = new Float64Array(EDDY_BANDS), add = new Float64Array(EDDY_BANDS);
  for (let b = 0; b < EDDY_BANDS; b++) { const lat = -89 + 2 * b; count[b] = Math.round(1000 * Math.cos(lat * Math.PI / 180)) + 1; M[b] = count[b] * 40 * Math.exp(-((lat / 25) ** 2)); } // moist tropics, dry poles
  const before = M.reduce((a, b) => a + b, 0), q0 = Array.from(M, (m, b) => m / count[b]);
  for (let k = 0; k < 50; k++) {
    const prev = Float64Array.from(M); eddyFactors(count, M, Q, mul, add, 0.4);
    for (let b = 0; b < EDDY_BANDS; b++) { assert.ok(mul[b] >= 0 && add[b] >= 0); assert.ok(Math.abs(M[b] - (prev[b] * mul[b] + add[b] * count[b])) < 1e-6); }
  }
  const after = M.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(after - before) / before < 1e-9, `${before} -> ${after}`);
  const q = Array.from(M, (m, b) => m / count[b]), eq = EDDY_BANDS / 2, pole = EDDY_BANDS - 5;
  assert.ok(q[eq] < q0[eq] && q[pole] > q0[pole] * 10, `equator ${q0[eq]} -> ${q[eq]}, 80N ${q0[pole]} -> ${q[pole]}`);
});

test('deterministic: same seed gives identical precipitation; disabling the eddy flux reproduces the season-0.5 baseline path', () => {
  const mesh = geodesicMesh(32);
  const a = createPlanet('DET-03', { frequency: 32, mesh }), b = createPlanet('DET-03', { frequency: 32, mesh });
  assert.deepEqual(a.climate.precipitationMonthly, b.climate.precipitationMonthly);
  assert.deepEqual(a.hydro.runoff, b.hydro.runoff);
  const off = createPlanet('DET-03', { frequency: 32, mesh, eddyMoisture: false });
  assert.deepEqual(off.climate.temperatureMonthly, a.climate.temperatureMonthly); // the eddy flux changes moisture only
  assert.notDeepEqual(off.climate.precipitationMonthly, a.climate.precipitationMonthly);
});

test('20 seeds at 100,002 cells: eddy flux reduces desert share and runoff ratio, wets the poles, stays fast', () => {
  const mesh = geodesicMesh(100), agg = { on: { B: 0, rr: 0, p70: 0, snow: 0 }, off: { B: 0, rr: 0, p70: 0, snow: 0 } };
  let worst = 0;
  for (const seed of SEEDS) {
    for (const mode of ['on', 'off']) {
      const t0 = performance.now(); const p = createPlanet(seed, { mesh, eddyMoisture: mode === 'on' }); const ms = performance.now() - t0;
      if (mode === 'on') worst = Math.max(worst, ms);
      let land = 0, B = 0, p70 = 0, n70 = 0, snow = 0, n60 = 0;
      for (let i = 0; i < p.cellCount; i++) {
        const a = Math.abs(p.lat[i]);
        if (a > 70) { p70 += p.rainfall[i]; n70++; }
        if (p.elevation[i] < 0) continue;
        land++; if (KOPPEN[p.koppen[i]][0] === 'B') B++;
        if (a >= 60) { for (let m = 0; m < 12; m++) if (p.climate.temperatureMonthly[12 * i + m] < 0) snow += p.climate.precipitationMonthly[12 * i + m]; n60++; }
      }
      const g = agg[mode]; g.B += B / land / SEEDS.length; g.rr += planetSummary(p).hydrology.runoffRatio / SEEDS.length; g.p70 += p70 / n70 / SEEDS.length; g.snow += (n60 ? snow / n60 : 0) / SEEDS.length;
    }
  }
  const { on, off } = agg, msg = JSON.stringify(agg);
  assert.ok(on.B < off.B - 0.02, `Köppen B share ${msg}`);
  assert.ok(on.rr < off.rr - 0.02, `runoff ratio ${msg}`);
  assert.ok(on.p70 > off.p70 * 1.2, `precipitation poleward of 70° ${msg}`);
  assert.ok(on.snow > off.snow * 1.5, `snowfall of land poleward of 60° ${msg}`);
  assert.ok(worst < 3000, `slowest generation ${worst} ms`); // CI-safe bound; the ~1 s budget is measured by the seed report
});
