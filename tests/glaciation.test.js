// Glaciation (glacial-0.8, F-0005): mass-balance pieces, linear EBM forcing, on-demand computation, mass and
// sea-level bookkeeping, gazetteer, and the Earth-obliquity glacial-maximum bar over 20 seeds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPlanet, geodesicMesh, planetSummary, cellInfo, MODEL_VERSION } from '../src/planet.js';
import { monthlyPDD, massBalance, nyeThickness, GLACIAL, GLACIAL_CELL } from '../src/glaciation.js';
import { zonalEnergyBalance, OLR_B } from '../src/climate.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const median = a => { const s = [...a].sort((x, y) => x - y); return (s[(s.length - 1) >> 1] + s[s.length >> 1]) / 2; };
const hash = a => createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');

test('PDD, mass balance and Nye profile behave as published', () => {
  assert.ok(monthlyPDD(-30) < 1e-3);                                    // deep frost: no melt
  assert.ok(Math.abs(monthlyPDD(20) - 20 * 365.25 / 12) < 1);            // warm month: PDD ≈ T × days
  assert.ok(monthlyPDD(0) > 55 && monthlyPDD(0) < 65);                   // σ = 5 K: ≈ σ/√(2π) × 30.4 d ≈ 61
  assert.ok(massBalance(Array(12).fill(-20), Array(12).fill(50)) > 590);  // cold and snowy: all 600 mm accumulate
  assert.ok(massBalance(Array(12).fill(15), Array(12).fill(100)) < 0);    // temperate: negative balance
  const h = nyeThickness(1000); assert.ok(h > 4500 && h < 4900, `H(1000 km) = ${h}`); // ≈ 4.7 km for τ0 = 100 kPa
});

test('EBM options: default output unchanged; with frozen albedo a uniform forcing F shifts the global mean by exactly F/B', () => {
  assert.equal(MODEL_VERSION, 'glacial-0.8');
  const a = zonalEnergyBalance(23.44), b = zonalEnergyBalance(23.44, null);
  assert.deepEqual(Array.from(a.Tann), Array.from(b.Tann));
  const fixed = a.seasonal.monthlyAlbedo, base = zonalEnergyBalance(23.44, { albedo: fixed }), cold = zonalEnergyBalance(23.44, { albedo: fixed, forcing: -4 });
  let s = 0, w = 0; for (let k = 0; k < base.rows; k++) { const c = Math.max(1e-6, Math.cos((-90 + 0.5 * k) * Math.PI / 180)); s += c * (cold.Tann[k] - base.Tann[k]); w += c; }
  assert.ok(Math.abs(s / w - (-4 / OLR_B)) < 1e-6, `global ΔT ${s / w} vs ${-4 / OLR_B}`);
  // an ice sheet covering half of a row raises its albedo and cools that row more than the global mean
  const ice = new Float64Array(base.rows); for (let k = 300; k < 320; k++) ice[k] = 0.5;
  const iced = zonalEnergyBalance(23.44, { albedo: fixed, iceRow: ice });
  assert.ok(iced.Tann[310] - base.Tann[310] < -3 && iced.globalMean < base.globalMean);
});

test('glacial state is computed on demand and leaves the interglacial world untouched', () => {
  const mesh = geodesicMesh(32), p = createPlanet('DET-08', { frequency: 32, mesh });
  assert.equal(p.glaciationComputed, false);
  assert.equal(planetSummary(p).glaciation, null);
  assert.equal(cellInfo(p, 5).glacial, undefined);
  const before = hash(p.temperature) + hash(p.rainfall) + hash(p.elevation);
  const g = p.glaciation;
  assert.equal(p.glaciationComputed, true); assert.equal(p.glaciation, g); // memoised
  assert.equal(hash(p.temperature) + hash(p.rainfall) + hash(p.elevation), before);
  assert.ok(planetSummary(p).glaciation.seaLevelFallM >= 0 && typeof cellInfo(p, 5).glacial === 'string');
  assert.match(p.prehistory, /^Last glacial maximum: obliquity fell to [\d.]+° and CO2 to 190 ppm/);
});

test('glacial maximum: deterministic, mass and sea level consistent, shelves only where shallow, gazetteer well formed', () => {
  const mesh = geodesicMesh(32);
  for (const seed of ['DET-01', 'DET-08', 'DET-18']) {
    const a = createPlanet(seed, { frequency: 32, mesh }), b = createPlanet(seed, { frequency: 32, mesh }), g = a.glaciation;
    assert.equal(hash(g.cell), hash(b.glaciation.cell)); assert.equal(hash(g.thickness), hash(b.glaciation.thickness));
    assert.ok(g.seaLevel <= 0 && g.stats.globalCoolingK > 0);
    assert.ok(g.stats.glacialIceVolumeKm3 >= g.stats.presentIceVolumeKm3);
    let ocean = 0; for (let i = 0; i < a.cellCount; i++) if (a.elevation[i] < 0) ocean++;
    const fall = (g.stats.glacialIceVolumeKm3 - g.stats.presentIceVolumeKm3) * GLACIAL.rhoIce / GLACIAL.rhoWater / (ocean * a.cellAreaKm2) * 1000;
    assert.ok(Math.abs(fall - g.stats.seaLevelFallM) < 0.2, `sea fall ${g.stats.seaLevelFallM} vs volume ${fall}`);
    const maxH = nyeThickness(Math.PI * 6371); // no ice thicker than a Nye profile spanning half the planet
    for (let i = 0; i < a.cellCount; i++) {
      assert.ok(g.thickness[i] >= 0 && g.thickness[i] <= maxH);
      if (g.cell[i] === GLACIAL_CELL.shelf || g.cell[i] === GLACIAL_CELL.bridge) assert.ok(a.elevation[i] < 0 && a.elevation[i] >= g.seaLevel);
      if (g.thickness[i] > 0) assert.ok(a.elevation[i] >= g.seaLevel && g.cell[i] === GLACIAL_CELL.ice);
    }
    for (const s of g.iceSheets) assert.match(s.name, /^[A-Z][a-z]+ Ice Sheet$/);
    for (let k = 1; k < g.iceSheets.length; k++) assert.ok(g.iceSheets[k - 1].areaKm2 >= g.iceSheets[k].areaKm2);
    for (const br of g.bridges) { assert.match(br.name, /^[A-Z][a-z]+ Land Bridge$/); assert.ok(br.landmasses.length >= 2 && br.areaKm2 > 0); }
    assert.equal(g.bridges.length, g.stats.landBridges);
  }
});

// The bar (F-0005, glacial-0.8): at Earth's obliquity every seed's own geography should give an Earth-like glacial
// maximum in the median: sea-level fall 100–140 m (Earth ≈ 120–134 m; Lambeck et al. 2014), global cooling 4–6.5 K
// (Earth 4.5 ± 0.9 K, Annan et al. 2022; 6.1 K, Tierney et al. 2020), glacial ice 5–11 % of the surface (Earth ≈ 8 %,
// USGS), and land bridges on at least 3 of 20 seeds. Default (interglacial) generation must not pay for it.
test('20 seeds at Earth obliquity (100,002 cells): Earth-like glacial maximum in the median; on-demand cost bounded', () => {
  const mesh = geodesicMesh(100), fall = [], cool = [], ice = [], ms = []; let bridged = 0;
  for (const seed of SEEDS) {
    const p = createPlanet(seed, { mesh, tilt: 23.44 });
    assert.equal(p.glaciationComputed, false);
    const t0 = performance.now(); const s = p.glaciation.stats; ms.push(performance.now() - t0);
    fall.push(s.seaLevelFallM); cool.push(s.globalCoolingK); ice.push(s.glacialIceFraction * 100); if (s.landBridges > 0) bridged++;
  }
  const detail = `fall ${median(fall)} m, cooling ${median(cool)} K, ice ${median(ice).toFixed(2)} %, bridged ${bridged}/20, glacial ${Math.round(median(ms))} ms`;
  assert.ok(median(fall) >= 100 && median(fall) <= 140, detail);
  assert.ok(median(cool) >= 4 && median(cool) <= 6.5, detail);
  assert.ok(median(ice) >= 5 && median(ice) <= 11, detail);
  assert.ok(bridged >= 3, detail);
  assert.ok(median(ms) < 2000, detail); // on demand; ~0.3–0.8 s in Node on the agent box
});
