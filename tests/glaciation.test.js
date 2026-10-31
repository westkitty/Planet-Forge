// Glaciation (glacial-0.6, work in progress): physical limits of the mass-balance pieces, determinism, invariants.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { monthlyPDD, massBalance, nyeThickness, GLACIAL_CELL } from '../src/glaciation.js';

test('PDD, mass balance and Nye profile behave as published', () => {
  assert.ok(monthlyPDD(-30) < 1e-3);                                    // deep frost: no melt
  assert.ok(Math.abs(monthlyPDD(20) - 20 * 365.25 / 12) < 1);            // warm month: PDD ≈ T × days
  assert.ok(monthlyPDD(0) > 55 && monthlyPDD(0) < 65);                   // σ = 5 K: ≈ σ/√(2π) × 30.4 d ≈ 61
  assert.ok(massBalance(Array(12).fill(-20), Array(12).fill(50)) > 590);  // cold and snowy: all 600 mm accumulate
  assert.ok(massBalance(Array(12).fill(15), Array(12).fill(100)) < 0);    // temperate: negative balance
  const h = nyeThickness(1000); assert.ok(h > 4500 && h < 4900, `H(1000 km) = ${h}`); // ≈ 4.7 km for τ0 = 100 kPa
});

test('glacial maximum: deterministic, ice only grows, sea falls, shelves only where shallow', () => {
  const mesh = geodesicMesh(32);
  for (const seed of ['DET-01', 'DET-08', 'DET-18']) {
    const a = createPlanet(seed, { frequency: 32, mesh }), b = createPlanet(seed, { frequency: 32, mesh }), g = a.glaciation;
    assert.deepEqual(Array.from(g.cell), Array.from(b.glaciation.cell));
    assert.ok(g.seaLevel <= 0 && g.stats.globalCoolingK > 0);
    assert.ok(g.stats.glacialIceVolumeKm3 >= g.stats.presentIceVolumeKm3);
    for (let i = 0; i < a.cellCount; i++) {
      if (g.cell[i] === GLACIAL_CELL.shelf || g.cell[i] === GLACIAL_CELL.bridge) assert.ok(a.elevation[i] < 0 && a.elevation[i] >= g.seaLevel);
      if (g.thickness[i] > 0) assert.ok(a.elevation[i] >= g.seaLevel);
    }
  }
});
