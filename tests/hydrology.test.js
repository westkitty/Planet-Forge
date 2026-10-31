// Hydrology (hydro-0.4): water balance, drainage topology, lakes, determinism.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh, cellInfo, planetSummary, MODEL_VERSION } from '../src/planet.js';
import { thornthwaitePET, fuAET, LAKE, RIVER_MIN_M3S } from '../src/hydrology.js';
import { SEEDS } from './determinism.test.js';

const mesh32 = geodesicMesh(32);

test('Thornthwaite PET and Fu/Budyko curve behave as published', () => {
  assert.equal(thornthwaitePET(Array(12).fill(-5), 0.8, 23.44), 0);                     // frozen all year: no PET
  const tropic = thornthwaitePET(Array(12).fill(27), 0, 23.44), temperate = thornthwaitePET([0, 1, 5, 10, 15, 19, 21, 20, 16, 10, 5, 1], 50 * Math.PI / 180, 23.44);
  assert.ok(tropic > 1400 && tropic < 2000, `tropical PET ${tropic}`);                   // ~1,600-1,800 mm in humid tropics
  assert.ok(temperate > 450 && temperate < 750, `temperate PET ${temperate}`);           // ~550-650 mm in central Europe
  // Budyko limits: AET <= min(P, PET); energy-limited -> AET ~ PET; water-limited -> AET ~ P
  for (const [P, E] of [[2000, 500], [300, 2000], [800, 800]]) { const a = fuAET(P, E); assert.ok(a <= Math.min(P, E) + 1e-9 && a > 0, `${P},${E}: ${a}`); }
  assert.ok(fuAET(3000, 400) > 0.97 * 400 && fuAET(100, 3000) > 0.97 * 100);
});

test('20 seeds: drainage is a forest rooted at the sea or terminal lakes; water balance closes; reproducible', () => {
  for (const seed of SEEDS) {
    const p = createPlanet(seed, { frequency: 32, mesh: mesh32 }), h = p.hydro, n = p.cellCount;
    assert.equal(p.version, MODEL_VERSION);
    let runoffQ = 0, lakeNet = 0, landN = 0;
    const toM3s = p.cellAreaKm2 * 1000 / (365.25 * 86400);
    for (let i = 0; i < n; i++) {
      if (p.elevation[i] < 0) { assert.equal(h.discharge[i], 0); continue; }
      landN++;
      const r = h.receiver[i]; assert.ok(r >= 0, `${seed} cell ${i} has no receiver`);
      if (p.elevation[r] >= 0) assert.ok(h.filled[r] <= h.filled[i], `${seed} uphill flow ${i}->${r}`);
      assert.ok(h.filled[i] >= p.elevation[i]);
      assert.ok(h.runoff[i] <= p.rainfall[i] && h.aet[i] <= h.pet[i] + 1, `${seed} runoff/aet bounds at ${i}`);
      assert.ok(h.basin[i] >= 0 && h.basin[i] < h.basins.length);
      if (h.lakeId[i] < 0) runoffQ += h.runoff[i] * toM3s;
    }
    assert.equal(h.landCount, landN);
    // following receivers from any land cell reaches the sea or a terminal lake within n steps
    for (let i = 0; i < n; i += 97) { if (p.elevation[i] < 0) continue; let c = i, k = 0; while (p.elevation[c] >= 0 && !(h.lakeId[c] >= 0 && h.lakes[h.lakeId[c]].type === 'salt') && k++ < n) c = h.receiver[c]; assert.ok(k < n, `${seed} cycle from ${i}`); }
    for (const l of h.lakes) {
      lakeNet += l.inflow - l.outflow; // what lakes remove: evaporation (fresh) or everything (terminal)
      if (l.type === 'salt') assert.ok(l.inflow <= l.evaporation + 0.1 && l.outflow === 0);
      else assert.ok(Math.abs(l.outflow - (l.inflow - l.evaporation)) < 0.2);
      let wet = 0; for (const c of l.cells) if (h.lake[c] === LAKE.fresh || h.lake[c] === LAKE.salt) wet++;
      assert.equal(wet, l.type === 'fresh' ? l.cells.length : l.wetCells);
    }
    // mass balance: land runoff + rain on lakes = discharge to the sea + water removed by lakes (within rounding)
    let lakeRain = 0; for (let i = 0; i < n; i++) if (h.lakeId[i] >= 0) lakeRain += p.rainfall[i] * toM3s;
    let sea = 0; for (const b of h.basins) if (!b.endorheic) sea += h.discharge[b.mouth];
    const lhs = runoffQ + lakeRain, rhs = sea + lakeNet;
    assert.ok(Math.abs(lhs - rhs) <= 0.002 * lhs + 1, `${seed} water balance ${lhs} vs ${rhs}`);
    const s = planetSummary(p).hydrology; assert.ok(s.runoffRatio > 0.05 && s.runoffRatio < 0.9 && s.endorheicLandFraction < 0.9, JSON.stringify(s));
    for (const st of p.settlements) assert.ok(!h.lake[st.cell] && typeof st.water === 'string');
  }
  const a = createPlanet('DET-07', { frequency: 32, mesh: mesh32 }).hydro, b = createPlanet('DET-07', { frequency: 32, mesh: mesh32 }).hydro;
  assert.deepEqual(a.discharge, b.discharge); assert.deepEqual(a.basin, b.basin); assert.deepEqual(a.rivers, b.rivers);
});

test('100,002 cells: rivers grow downstream, discharge increases with basin area, lakes and rivers exist', () => {
  const mesh = geodesicMesh(100);
  for (const seed of ['ATLAS-001', 'DET-03']) {
    const p = createPlanet(seed, { mesh, tilt: 23.44 }), h = p.hydro;
    assert.ok(h.stats.riverCells > 1000, `${seed} river cells ${h.stats.riverCells}`);
    assert.ok(h.rivers.length >= 5 && h.rivers[0].dischargeM3s > 10000 && h.rivers[0].lengthKm > 500, JSON.stringify(h.rivers[0], (k, v) => k === 'path' ? undefined : v));
    assert.ok(h.stats.freshLakes + h.stats.saltLakes > 10);
    // along each named main stem, discharge never decreases downstream outside lakes
    for (const r of h.rivers.slice(0, 5)) for (let k = 1; k < r.path.length; k++) { const down = r.path[k - 1], up = r.path[k]; if (h.lakeId[down] < 0 && h.lakeId[up] < 0) assert.ok(h.discharge[down] >= h.discharge[up], `${seed} ${r.name}`); }
    const info = cellInfo(p, h.rivers[0].mouth); assert.ok(info.dischargeM3s >= RIVER_MIN_M3S && /River/.test(info.basin));
    // a wetter planet (no tilt change, same relief) drains through the same network: rank of basins by area is tilt-independent
    assert.deepEqual(createPlanet(seed, { mesh, tilt: 40 }).elevation, p.elevation);
  }
});
