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
