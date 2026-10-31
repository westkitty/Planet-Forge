// Invariants, determinism and performance for the tectonic-0.2 planet model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { geodesicMesh, createPlanet, planetSummary, cellInfo, gdh1Depth, BIOMES, MODEL_VERSION } from '../src/planet.js';

const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const mesh32 = geodesicMesh(32);
const fingerprint = p => createHash('sha256').update(JSON.stringify({ plates: p.plates, plate: Array.from(p.plate), el: Array.from(p.elevation), b: Array.from(p.boundary), t: Array.from(p.temperature), r: Array.from(p.rainfall), bi: Array.from(p.biome), s: p.settlements })).digest('hex');

test('geodesic mesh: 10f^2+2 cells, 20f^2 triangles, 12 pentagons, symmetric adjacency', () => {
  for (const f of [1, 2, 7, 32]) {
    const m = f === 32 ? mesh32 : geodesicMesh(f);
    assert.equal(m.count, 10 * f * f + 2);
    assert.equal(m.triangles.length, 60 * f * f);
    let pent = 0;
    for (let i = 0; i < m.count; i++) {
      const deg = m.offsets[i + 1] - m.offsets[i];
      assert.ok(deg === 5 || deg === 6, `f=${f} cell ${i} degree ${deg}`);
      if (deg === 5) pent++;
      const r = Math.hypot(m.positions[3 * i], m.positions[3 * i + 1], m.positions[3 * i + 2]);
      assert.ok(Math.abs(r - 1) < 1e-12);
      for (let e = m.offsets[i]; e < m.offsets[i + 1]; e++) {
        const j = m.neighbors[e]; let back = false;
        for (let g = m.offsets[j]; g < m.offsets[j + 1]; g++) if (m.neighbors[g] === i) back = true;
        assert.ok(back, `asymmetric edge ${i}-${j}`);
      }
    }
    assert.equal(pent, 12);
    // Euler characteristic V - E + F = 2
    assert.equal(m.count - m.neighbors.length / 2 + m.triangles.length / 3, 2);
  }
});

test('20 seeds: identical planet on repeated generation, distinct across seeds', () => {
  const seen = new Set();
  for (const seed of SEEDS) {
    const a = fingerprint(createPlanet(seed, { frequency: 32, mesh: mesh32 }));
    const b = fingerprint(createPlanet(seed, { frequency: 32, mesh: mesh32 }));
    assert.equal(a, b, seed);
    seen.add(a);
  }
  assert.equal(seen.size, SEEDS.length);
});

test('20 seeds: plates are contiguous, boundaries consistent, relief and climate in bounds', () => {
  for (const seed of SEEDS) {
    const p = createPlanet(seed, { frequency: 32, mesh: mesh32 });
    const { count: n, offsets: O, neighbors: N } = p.mesh;
    assert.equal(p.version, MODEL_VERSION);
    assert.ok(p.plates.length >= 9 && p.plates.length <= 14);
    // contiguity: BFS within each plate reaches all its cells
    for (const pl of p.plates) {
      const start = p.plate.indexOf(pl.id); assert.ok(start >= 0, `${seed} empty plate ${pl.id}`);
      const seen = new Uint8Array(n); const q = [start]; seen[start] = 1; let c = 0;
      while (q.length) { const i = q.pop(); c++; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (!seen[j] && p.plate[j] === pl.id) { seen[j] = 1; q.push(j); } } }
      assert.equal(c, pl.cells, `${seed} plate ${pl.id} not contiguous`);
      assert.ok(pl.speedCmYr >= 1.5 && pl.speedCmYr <= 9, `${seed} speed ${pl.speedCmYr}`);
    }
    let contEl = 0, contN = 0, oceEl = 0, oceN = 0;
    for (let i = 0; i < n; i++) {
      let foreign = false; for (let e = O[i]; e < O[i + 1]; e++) if (p.plate[N[e]] !== p.plate[i]) foreign = true;
      assert.equal(p.boundary[i] !== 0, foreign, `${seed} boundary flag mismatch at ${i}`);
      const el = p.elevation[i];
      assert.ok(Number.isInteger(el) && el >= -11000 && el <= 8800);
      assert.ok(p.temperature[i] >= -65 && p.temperature[i] <= 47);
      assert.ok(p.rainfall[i] >= 0);
      assert.equal(el < 0, p.biome[i] === 0, `${seed} ocean/land mismatch`);
      if (p.continental[i]) { contEl += el; contN++; } else { oceEl += el; oceN++; assert.ok(p.seafloorAge[i] >= 0 && p.seafloorAge[i] <= 200); }
      if (!p.continental[i] && p.boundary[i] === 2) assert.equal(p.seafloorAge[i], 0, `${seed} ridge cell must have zero age`);
    }
    assert.ok(contEl / contN > 0 && oceEl / oceN < -2500, `${seed} bimodal hypsometry: continental ${contEl / contN}, oceanic ${oceEl / oceN}`);
    const s = planetSummary(p);
    assert.ok(s.landFraction > 0.1 && s.landFraction < 0.7, `${seed} land ${s.landFraction}`);
    assert.ok(s.boundaryCells.convergent > 0 && s.boundaryCells.divergent > 0 && s.boundaryCells.transform > 0, `${seed} boundary types`);
    for (const st of p.settlements) { const c = cellInfo(p, st.cell); assert.ok(c.elevation > 0 && BIOMES.includes(c.biome)); }
    assert.ok(p.settlements.length >= 1);
    assert.deepEqual(p.timeline.map(e => e.year), [...p.timeline.map(e => e.year)].sort((a, b) => a - b));
  }
});

test('highest and deepest points lie near plate boundaries', () => {
  const p = createPlanet('DET-03', { frequency: 32, mesh: mesh32 });
  let hi = -1, lo = -1;
  for (let i = 0; i < p.cellCount; i++) { if (hi < 0 || p.elevation[i] > p.elevation[hi]) hi = i; if (lo < 0 || p.elevation[i] < p.elevation[lo]) lo = i; }
  assert.ok(p.boundaryDistance[hi] * p.spacingKm < 900, 'highest point lies near a plate boundary');
  assert.ok(p.boundaryDistance[lo] * p.spacingKm < 400, 'deepest point lies near a plate boundary');
});

test('GDH1 age-depth curve is continuous and monotonic', () => {
  let prev = gdh1Depth(0); assert.equal(prev, 2600);
  for (let a = 1; a <= 200; a++) { const d = gdh1Depth(a); assert.ok(d >= prev); prev = d; }
  assert.ok(Math.abs(gdh1Depth(19.9999) - gdh1Depth(20)) < 5);
});

test('100,002-cell planet: deterministic and generated within budget', () => {
  const mesh = geodesicMesh(100);
  const t0 = performance.now(); const a = createPlanet('ATLAS-001', { mesh }); const ms = performance.now() - t0;
  assert.equal(a.cellCount, 100002);
  assert.equal(fingerprint(a), fingerprint(createPlanet('ATLAS-001', { mesh })));
  assert.ok(ms < 3000, `generation took ${ms.toFixed(0)} ms`);
});
