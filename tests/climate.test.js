// Physical invariants, determinism and classification checks for the climate-0.3 model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geodesicMesh, createPlanet } from '../src/planet.js';
import { dailyInsolation, declination, zonalEnergyBalance, classifyKoppen, itczLatitude, satVapour, KOPPEN, BIOMES, SOLAR_CONSTANT } from '../src/climate.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const mesh32 = geodesicMesh(32);

test('insolation: equinox equator = S0/pi, polar night = 0, global annual mean = S0/4', () => {
  assert.ok(Math.abs(dailyInsolation(0, 0) - SOLAR_CONSTANT / Math.PI) < 1e-9);
  assert.equal(dailyInsolation(80 * Math.PI / 180, -23.44 * Math.PI / 180), 0);
  for (const tilt of [0, 23.44, 60]) {
    const e = zonalEnergyBalance(tilt); let s = 0, w = 0;
    for (let k = 0; k < e.rows; k++) { const c = Math.cos((-90 + 0.5 * k) * Math.PI / 180); s += c * e.Qa[k]; w += c; }
    assert.ok(Math.abs(s / w / (SOLAR_CONSTANT / 4) - 1) < 0.01, `tilt ${tilt}: ${s / w}`);
  }
  assert.ok(Math.abs(declination(23.44, 5) * 180 / Math.PI - 23.3) < 0.5, 'June declination near +23.4°');
});

test('energy balance: equator warmer than poles at Earth tilt; high tilt flattens the gradient', () => {
  const earth = zonalEnergyBalance(23.44), high = zonalEnergyBalance(60);
  assert.ok(earth.Tann[180] - earth.Tann[0] > 20);
  assert.ok(high.Tann[180] - high.Tann[0] < earth.Tann[180] - earth.Tann[0]);
  assert.ok(earth.globalMean > 5 && earth.globalMean < 25, `global mean ${earth.globalMean}`);
});

test('Magnus saturation vapour pressure: 6.11 hPa at 0 °C, ~7%/K Clausius-Clapeyron scaling', () => {
  assert.ok(Math.abs(satVapour(0) - 6.1078) < 1e-9);
  const r = satVapour(21) / satVapour(20); assert.ok(r > 1.05 && r < 1.08, `ratio ${r}`);
});

test('zero tilt has no seasons; larger tilt gives larger seasonal range; ITCZ follows the sun', () => {
  const ranges = [0, 23.44, 45].map(tilt => {
    const p = createPlanet('DET-05', { frequency: 32, mesh: mesh32, tilt }), T = p.climate.temperatureMonthly; let r = 0, nl = 0;
    for (let i = 0; i < p.cellCount; i++) { let hi = -1e9, lo = 1e9; for (let m = 0; m < 12; m++) { hi = Math.max(hi, T[12 * i + m]); lo = Math.min(lo, T[12 * i + m]); } if (tilt === 0) assert.ok(hi - lo < 0.11, `cell ${i} range ${hi - lo}`); if (p.elevation[i] >= 0) { r += hi - lo; nl++; } }
    return r / nl;
  });
  assert.ok(ranges[0] < 0.11 && ranges[1] > ranges[0] + 5 && ranges[2] > ranges[1] + 5, ranges.join(', '));
  assert.ok(itczLatitude(23.44, 6) > 5 && itczLatitude(23.44, 0) < -5 && itczLatitude(0, 6) === 0);
});

test('tilt override changes climate but not tectonic relief; same seed and tilt is reproducible', () => {
  const a = createPlanet('DET-01', { frequency: 32, mesh: mesh32, tilt: 10 }), b = createPlanet('DET-01', { frequency: 32, mesh: mesh32, tilt: 50 });
  assert.deepEqual(a.elevation, b.elevation);
  assert.notDeepEqual(a.climate.temperatureMonthly, b.climate.temperatureMonthly);
  assert.deepEqual(a.climate.precipitationMonthly, createPlanet('DET-01', { frequency: 32, mesh: mesh32, tilt: 10 }).climate.precipitationMonthly);
});

test('20 seeds: moisture budget closes, classes consistent, monthly fields add up, seeded tilt in 10-35°', () => {
  for (const seed of SEEDS) {
    const p = createPlanet(seed, { frequency: 32, mesh: mesh32 }), c = p.climate;
    assert.ok(p.tilt >= 10 && p.tilt <= 35, `${seed} tilt ${p.tilt}`);
    const closure = c.budget.precipitation / c.budget.evaporation;
    assert.ok(closure > 0.9 && closure <= 1.0001, `${seed} P/E ${closure}`);
    let eqT = 0, eqN = 0, poT = 0, poN = 0;
    for (let i = 0; i < p.cellCount; i++) {
      const k = KOPPEN[p.koppen[i]];
      assert.ok(k, `${seed} koppen index ${p.koppen[i]}`);
      assert.equal(k === 'Ocean', p.elevation[i] < 0, `${seed} ocean/Köppen mismatch at ${i}`);
      assert.ok(p.biome[i] < BIOMES.length);
      if (k === 'EF') assert.equal(BIOMES[p.biome[i]], 'Ice');
      let hot = -1e9, sum = 0; for (let m = 0; m < 12; m++) { hot = Math.max(hot, c.temperatureMonthly[12 * i + m]); sum += c.precipitationMonthly[12 * i + m]; }
      if (k !== 'Ocean' && hot < 10) assert.ok(k === 'ET' || k === 'EF', `${seed} ${k} with warmest month ${hot}`);
      assert.ok(Math.abs(sum - p.rainfall[i]) <= 1, `${seed} monthly sum ${sum} vs annual ${p.rainfall[i]}`);
      if (Math.abs(p.lat[i]) < 10) { eqT += p.temperature[i]; eqN++; } else if (Math.abs(p.lat[i]) > 70) { poT += p.temperature[i]; poN++; }
    }
    assert.ok(eqT / eqN > poT / poN + 15, `${seed} equator ${eqT / eqN} pole ${poT / poN}`);
  }
});

test('rain shadows: windward slopes are wetter than lee slopes (100,002 cells, 3 seeds)', () => {
  const mesh = geodesicMesh(100); let wSum = 0, wN = 0, lSum = 0, lN = 0;
  for (const seed of ['ATLAS-001', 'DET-03', 'DET-11']) {
    const p = createPlanet(seed, { mesh, tilt: 23.44 }); const up = p.climate.uplift;
    // uplift is from the July regime (the last season computed); compare July precipitation
    for (let i = 0; i < p.cellCount; i++) {
      if (p.elevation[i] < 200) continue; const r = p.climate.precipitationMonthly[12 * i + 6];
      if (up[i] > 150) { wSum += r; wN++; } else if (up[i] < -150) { lSum += r; lN++; }
    }
  }
  assert.ok(wN > 50 && lN > 50, `samples ${wN} ${lN}`);
  assert.ok(wSum / wN > 1.5 * (lSum / lN), `windward ${wSum / wN} lee ${lSum / lN}`);
});

test('Köppen classifier reproduces textbook cases', () => {
  const K = (t, p, north = true) => KOPPEN[classifyKoppen(Float32Array.from(t), Float32Array.from(p), 0, north)];
  assert.equal(K(Array(12).fill(27), Array(12).fill(200)), 'Af');                                     // humid equatorial
  assert.equal(K(Array(12).fill(28), [1, 1, 2, 3, 5, 2, 1, 1, 2, 3, 2, 1]), 'BWh');                    // hot desert
  assert.equal(K([-30, -28, -25, -15, -5, 2, 6, 4, -3, -12, -22, -28], Array(12).fill(15)), 'ET');     // tundra
  assert.equal(K([-35, -33, -30, -25, -20, -15, -12, -14, -20, -26, -30, -34], Array(12).fill(5)), 'EF'); // ice cap
  assert.equal(K([10, 11, 13, 16, 20, 24, 27, 27, 24, 19, 14, 11], [100, 90, 70, 40, 20, 5, 1, 2, 15, 60, 90, 110]), 'Csa'); // Mediterranean
  assert.equal(K([-10, -8, -2, 6, 13, 18, 20, 19, 13, 6, -1, -7], Array(12).fill(50)), 'Dfb');         // humid continental
});
