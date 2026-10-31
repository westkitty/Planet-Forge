// Seasonal heat-capacity damping (season-0.5, F-0006): ocean mixed-layer and land heat capacity, maritime coupling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geodesicMesh, createPlanet, MODEL_VERSION } from '../src/planet.js';
import { zonalEnergyBalance, OMEGA, C_OCEAN, C_LAND, snowAlbedo } from '../src/climate.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const row = lat => 180 + 2 * lat;
const range = (a, k) => { let hi = -1e9, lo = 1e9, arg = 0; for (let m = 0; m < 12; m++) { const v = a[k * 12 + m]; if (v > hi) { hi = v; arg = m; } lo = Math.min(lo, v); } return [hi - lo, arg]; };

test('version and heat capacities: 50 m ocean mixed layer, land = air column + soil, damping factor 1/sqrt(1+(wt)^2)', () => {
  assert.equal(MODEL_VERSION, 'glacial-0.7');
  assert.ok(C_OCEAN > 1.9e8 && C_OCEAN < 2.2e8 && C_LAND > 0.9e7 && C_LAND < 2e7);
  const wt = OMEGA * C_OCEAN / (2.09 + 3.81), damp = 1 / Math.sqrt(1 + wt * wt);
  assert.ok(damp > 0.1 && damp < 0.2, `ocean annual-harmonic damping ${damp}`); // 50 m mixed layer: ~14% of the equilibrium amplitude, ~82° (2.7-month) lag
  assert.equal(snowAlbedo(5), 0.3); assert.equal(snowAlbedo(-20), 0.62); assert.ok(snowAlbedo(-5) > 0.3 && snowAlbedo(-5) < 0.62);
});

test('EBM: ocean seasonal cycle is damped and lags; seasonal anomalies average to zero; zero tilt has none', () => {
  const e = zonalEnergyBalance(23.44), z = zonalEnergyBalance(0);
  for (const lat of [-60, -30, 30, 45, 60, 75]) {
    const k = row(lat); let s = 0; for (let m = 0; m < 12; m++) s += e.seasonal.ocean[k * 12 + m];
    assert.ok(Math.abs(s / 12) < 1e-6, `mean anomaly ${s / 12} at ${lat}`);
    const [ro] = range(e.seasonal.ocean, k), [req] = range(e.anomaly, k);
    assert.ok(ro < 0.2 * req, `ocean range ${ro} vs equilibrium ${req} at ${lat}`);
  }
  const [, peakO] = range(e.seasonal.ocean, row(50)), [, peakEq] = range(e.anomaly, row(50));
  const lag = (peakO - peakEq + 12) % 12; assert.ok(lag >= 1 && lag <= 3, `ocean lag ${lag} months`); // observed SST peak ~Aug at 50N
  for (const k of [row(-60), row(45)]) assert.ok(range(z.seasonal.ocean, k)[0] < 1e-6);
});

test('20 seeds (100,002 cells): Earth-like high-latitude seasons, continentality, maritime oceans', () => {
  const mesh = geodesicMesh(100);
  for (const seed of SEEDS) {
    const p = createPlanet(seed, { mesh }), T = p.climate.temperatureMonthly;
    let hotSum = 0, hotN = 0, hottest = -1e9, ocR = 0, ocN = 0, coastR = 0, coastN = 0, inR = 0, inN = 0;
    for (let i = 0; i < p.cellCount; i++) {
      let hi = -1e9, lo = 1e9; for (let m = 0; m < 12; m++) { hi = Math.max(hi, T[12 * i + m]); lo = Math.min(lo, T[12 * i + m]); }
      const a = Math.abs(p.lat[i]), land = p.elevation[i] >= 0;
      if (land && a >= 60) { hotSum += hi; hotN++; hottest = Math.max(hottest, hi); }
      if (a >= 45 && a <= 65) { if (!land) { ocR += hi - lo; ocN++; } else if (p.climate.coastDist[i] === 1) { coastR += hi - lo; coastN++; } else if (p.climate.coastDist[i] >= 15) { inR += hi - lo; inN++; } }
    }
    if (hotN > 50) assert.ok(hotSum / hotN < 32, `${seed} mean warmest month of land poleward of 60°: ${hotSum / hotN}`);
    assert.ok(hottest < 50, `${seed} hottest month poleward of 60°: ${hottest}`); // climate-0.3 reached the 55 °C clamp
    assert.ok(ocR / ocN < 13, `${seed} ocean seasonal range at 45-65°: ${ocR / ocN}`);
    if (coastN > 30 && inN > 30) assert.ok(inR / inN > coastR / coastN + 3, `${seed} inland ${inR / inN} vs coast ${coastR / coastN}`);
  }
});
