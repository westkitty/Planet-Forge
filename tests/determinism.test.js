// 20-seed reproducibility and invariant checks for the prototype world model.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createWorld, buildGrid, sampleCell } from '../src/world.js';

export const SEEDS = Array.from({ length: 20 }, (_, i) => `DET-${String(i).padStart(2, '0')}`);
const digest = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const BIOMES = new Set(['Ocean', 'Ice', 'Tundra', 'Desert', 'Grassland', 'Rainforest', 'Boreal forest', 'Temperate forest']);

test('20 seeds: identical output on repeated generation', () => {
  for (const seed of SEEDS) {
    const a = { world: createWorld(seed), grid: buildGrid(seed, 5) };
    const b = { world: createWorld(seed), grid: buildGrid(seed, 5) };
    assert.equal(digest(a), digest(b), seed);
  }
});

test('20 seeds: distinct seeds give distinct worlds', () => {
  const hashes = new Set(SEEDS.map(s => digest({ w: createWorld(s), g: buildGrid(s, 5) })));
  assert.equal(hashes.size, SEEDS.length);
});

test('20 seeds: cell invariants on the 5-degree grid', () => {
  for (const seed of SEEDS) {
    const grid = buildGrid(seed, 5);
    assert.equal(grid.length, 35 * 72, seed);
    for (const c of grid) {
      assert.ok(Number.isInteger(c.elevation) && c.elevation >= -5900 && c.elevation <= 6600, `${seed} elevation ${c.elevation}`);
      assert.ok(c.temperature >= -65 && c.temperature <= 47, `${seed} temperature ${c.temperature}`);
      assert.ok(Number.isInteger(c.rainfall) && c.rainfall >= 0, `${seed} rainfall ${c.rainfall}`);
      assert.ok(Number.isInteger(c.plate) && c.plate >= 0 && c.plate < 8, `${seed} plate ${c.plate}`);
      assert.ok(BIOMES.has(c.biome), `${seed} biome ${c.biome}`);
      assert.equal(c.elevation < 0, c.biome === 'Ocean', `${seed} ocean/land mismatch at ${c.lat},${c.lon}`);
    }
    const land = grid.filter(c => c.elevation >= 0).length / grid.length;
    assert.ok(land > 0.05 && land < 0.95, `${seed} land fraction ${land}`);
  }
});

test('20 seeds: settlement and chronicle invariants', () => {
  for (const seed of SEEDS) {
    const w = createWorld(seed);
    assert.equal(w.version, 'prototype-0.1');
    assert.ok(w.settlements.length >= 1 && w.settlements.length <= 8, `${seed} settlements ${w.settlements.length}`);
    for (const s of w.settlements) {
      const c = sampleCell(seed, s.lat, s.lon);
      // Sites are chosen on land, below 1800 m, above 3 C and wet; positions are rounded to 0.1 deg so allow slack.
      assert.ok(c.elevation > -300 && c.elevation < 2100, `${seed} ${s.name} elevation ${c.elevation}`);
      assert.ok(s.founded >= 100 && s.founded < 1500, `${seed} ${s.name} founded ${s.founded}`);
    }
    const years = w.timeline.map(e => e.year);
    assert.deepEqual(years, [...years].sort((a, b) => a - b), `${seed} chronicle not sorted`);
    assert.equal(w.timeline.length, w.settlements.length);
  }
});
