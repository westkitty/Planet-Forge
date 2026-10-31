// Prints reproducibility, distribution statistics and timings for 20 seeds.
// Usage: node scripts/seed-report.mjs [--json]
import { createHash } from 'node:crypto';
import { createWorld, buildGrid } from '../src/world.js';

const seeds = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 12);
const rows = [];
for (const seed of seeds) {
  const t0 = performance.now();
  const world = createWorld(seed);
  const grid = buildGrid(seed, 5);
  const ms = performance.now() - t0;
  const again = digest({ world: createWorld(seed), grid: buildGrid(seed, 5) });
  const h = digest({ world, grid });
  const biomes = {};
  for (const c of grid) biomes[c.biome] = (biomes[c.biome] || 0) + 1;
  const land = grid.filter(c => c.elevation >= 0).length / grid.length;
  rows.push({ seed, hash: h, reproducible: h === again, ms: +ms.toFixed(2), cells: grid.length, land: +land.toFixed(3), settlements: world.settlements.length, biomes });
}
// Globe colour pass in the browser samples one cell per vertex of SphereGeometry(1,192,96).
const vertexSamples = 193 * 97;
const t0 = performance.now();
const { sampleCell } = await import('../src/world.js');
for (let i = 0; i < vertexSamples; i++) sampleCell('DET-00', (i % 97) * 180 / 96 - 90, Math.floor(i / 97) * 360 / 192 - 180);
const globeMs = performance.now() - t0;
const summary = {
  seeds: rows.length,
  reproducible: rows.filter(r => r.reproducible).length,
  distinctHashes: new Set(rows.map(r => r.hash)).size,
  landFraction: { min: Math.min(...rows.map(r => r.land)), max: Math.max(...rows.map(r => r.land)), mean: +(rows.reduce((a, r) => a + r.land, 0) / rows.length).toFixed(3) },
  settlements: { min: Math.min(...rows.map(r => r.settlements)), max: Math.max(...rows.map(r => r.settlements)) },
  msPerSeed: { min: Math.min(...rows.map(r => r.ms)), max: Math.max(...rows.map(r => r.ms)) },
  globeVertexSamples: vertexSamples,
  globeSampleMs: +globeMs.toFixed(1),
};
if (process.argv.includes('--json')) console.log(JSON.stringify({ summary, rows }, null, 2));
else { console.table(rows.map(({ biomes, ...r }) => r)); console.log(summary); }

// Tectonic model (tectonic-0.2) on the 100,002-cell geodesic mesh.
const { geodesicMesh, createPlanet, planetSummary } = await import('../src/planet.js');
const tm0 = performance.now(); const mesh100 = geodesicMesh(100); const meshMs = performance.now() - tm0;
const tect = [];
for (const seed of seeds) {
  const t1 = performance.now(); const p = createPlanet(seed, { mesh: mesh100 }); const ms = performance.now() - t1;
  const s = planetSummary(p);
  const fp = digest({ el: Array.from(p.elevation), pl: Array.from(p.plate) });
  const fp2 = digest((q => ({ el: Array.from(q.elevation), pl: Array.from(q.plate) }))(createPlanet(seed, { mesh: mesh100 })));
  tect.push({ seed, hash: fp, reproducible: fp === fp2, ms: +ms.toFixed(0), plates: s.plates, land: +s.landFraction.toFixed(3), continental: +s.continentalFraction.toFixed(3), conv: s.boundaryCells.convergent, div: s.boundaryCells.divergent, trans: s.boundaryCells.transform, maxEl: s.maxElevation, minEl: s.minElevation, settlements: p.settlements.length });
}
const tsum = { cells: mesh100.count, meshMs: +meshMs.toFixed(0), reproducible: tect.filter(r => r.reproducible).length, distinct: new Set(tect.map(r => r.hash)).size, msPerSeed: { min: Math.min(...tect.map(r => r.ms)), max: Math.max(...tect.map(r => r.ms)) }, land: { min: Math.min(...tect.map(r => r.land)), max: Math.max(...tect.map(r => r.land)) }, maxElevation: Math.max(...tect.map(r => r.maxEl)), minElevation: Math.min(...tect.map(r => r.minEl)) };
if (process.argv.includes('--json')) console.log(JSON.stringify({ tectonic: { summary: tsum, rows: tect } }, null, 2));
else { console.table(tect); console.log(tsum); }
