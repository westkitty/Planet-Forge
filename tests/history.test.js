import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { simulateHistory, snapshotAt, epochs, compareBranches, ruinState, excavate, buildCase, judgeCase, mysteries, npp, sites, RULES } from '../src/gameplay/civilization.js';
import { newEcology, stepEcology, fieldGuide, tree, regions, RULES as ER } from '../src/gameplay/ecology.js';

const mesh = geodesicMesh(100);
const P = createPlanet('ATLAS-001', { frequency: 100, mesh });
const fp = p => [p.elevation, p.temperature, p.rainfall, p.biome, p.hydro.discharge].map(a => { let h = 2166136261; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 5) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }).join('-');
const before = fp(P);
const H = simulateHistory(P, [], 0);

test('Miami NPP model matches Lieth (1975) reference values', () => {
  assert.ok(Math.abs(npp(30, 5000) - 3000 / (1 + Math.exp(1.315 - 3.57))) < 1e-9, 'temperature-limited');
  assert.ok(Math.abs(npp(25, 500) - 3000 * (1 - Math.exp(-.332))) < 1e-9, 'precipitation-limited');
  assert.ok(npp(-20, 100) < npp(15, 1000));
});

test('PF-15 river kingdoms: deterministic, accounting consistent, geography matters, decisions change outcomes', () => {
  assert.deepEqual(simulateHistory(P, [], 0), H);
  assert.equal(H.snapshots.length, RULES.years / RULES.stepYears + 1);
  for (const s of H.snapshots) s.pop.forEach((n, k) => { assert.ok(n >= 0 && Number.isFinite(n)); if (!s.founded[k]) assert.equal(n, 0); if (s.founded[k] && !s.alive[k]) assert.equal(n, 0); });
  const S = sites(P); assert.equal(S.length, P.settlements.length);
  assert.ok(Math.max(...S.map(s => s.capacity)) > 1.5 * Math.min(...S.map(s => s.capacity)), 'capacity varies with the land around each site');
  for (const s of S) assert.equal(s.cell, P.settlements[s.k].cell, 'original settlement data preserved');
  const famine = H.events.filter(e => e.type === 'famine'); assert.ok(famine.length > 0);
  const firstRuin = H.ruins[0]; assert.ok(firstRuin, 'at least one collapse on ATLAS-001');
  const saved = simulateHistory(P, Array.from({ length: 40 }, (_, d) => ({ year: firstRuin.founded + 10 * d + (10 - firstRuin.founded % 10) % 10, k: firstRuin.k, kind: ['granary', 'irrigation', 'road'][d % 3] })), 0);
  assert.notDeepEqual(saved.snapshots, H.snapshots, 'investments change history');
  assert.ok(saved.events.some(e => e.type === 'investment' && e.k === firstRuin.k));
});

test('PF-23 deep time: seeking returns the recorded snapshot; epochs distinguish computed states from recorded history; branches compare', () => {
  const s = snapshotAt(H, 1000); assert.equal(s.year, 1000);
  assert.deepEqual(snapshotAt(H, 1004), s); assert.equal(snapshotAt(H, -50).year, 0); assert.equal(snapshotAt(H, 99999).year, RULES.years);
  const ep = epochs(P, H); assert.ok(ep.some(e => e.kind === 'computed state') && ep.some(e => e.kind === 'recorded history'));
  const other = simulateHistory(P, [], 5), cmp = compareBranches(H, other);
  assert.ok(Number.isFinite(cmp.populationA) && Number.isFinite(cmp.populationB));
  assert.deepEqual(simulateHistory(P, [], 5), other, 'replaying a branch reproduces it');
});

test('PF-33 ruins derive from recorded collapses, keep their timestamps and decay with age', () => {
  for (const r of H.ruins) {
    const ab = H.events.find(e => e.type === 'abandoned' && e.k === r.k);
    assert.ok(ab && ab.year === r.abandoned && r.founded === P.settlements[r.k].founded);
    assert.equal(ruinState(r, r.abandoned - 10), null);
    assert.equal(ruinState(r, r.abandoned + 50), 'fresh ruin'); assert.equal(ruinState(r, r.abandoned + 500), 'buried ruin');
    const x = excavate(H, r); assert.ok(x.layers.length >= 2 && x.layers.every(l => H.events.some(e => e.text === l.record)), 'every layer is a recorded event');
    assert.match(x.interpretation, /Reading of the record/);
  }
  assert.ok(H.ruins.every(r => H.snapshots[H.snapshots.length - 1].pop[r.k] === 0), 'abandoned settlements are not silently re-populated');
});

test('PF-21 mysteries are solvable from collected evidence; unsupported or wrong conclusions fail', () => {
  const cases = mysteries(P, H); assert.ok(cases.length >= 1);
  for (const c of cases) {
    const all = c.clues.flatMap(x => x.evidence), good = all.filter(e => e.supports === c.answer);
    assert.ok(good.length >= 2);
    assert.equal(judgeCase(c, good, c.answer).solved, true);
    assert.equal(judgeCase(c, good.slice(0, 1), c.answer).solved, false, 'one clue is not enough');
    const wrong = Object.keys(c.hypotheses).find(h => h !== c.answer && all.filter(e => e.supports === h).length >= 2);
    if (wrong) assert.equal(judgeCase(c, all, wrong).solved, false);
    assert.match(c.note, /Generated scenario history/);
  }
});

test('PF-20 ecology: bounded, deterministic, adaptation follows rules, speciation and extinction occur under stated rules', () => {
  const R = regions(P); assert.ok(R.length > 50 && R.length < 650);
  let a = newEcology(P, 0), b = newEcology(P, 0);
  for (let g = 0; g < 50; g++) { a = stepEcology(P, a, g >= 25 ? { dT: 6 } : {}); b = stepEcology(P, b, g >= 25 ? { dT: 6 } : {}); }
  assert.deepEqual(a, b);
  assert.ok(a.species.length <= ER.maxSpecies);
  for (const s of a.species) for (const n of s.pop) assert.ok(n >= 0 && Number.isFinite(n) && n < 1e8, 'bounded');
  assert.ok(a.events.some(e => e.type === 'speciation'), 'speciation happened');
  const kids = a.species.filter(s => s.parent !== null); for (const k of kids) assert.ok(k.born > 0 && a.species[k.parent]);
  let c = newEcology(P, 0); for (let g = 0; g < 30; g++) c = stepEcology(P, c, { dT: -25 });
  assert.ok(c.species.some(s => s.extinct !== null), 'severe cooling drives extinctions');
  assert.equal(fieldGuide(a).length, a.species.length); assert.equal(tree(a).length, a.species.length);
});

test('history and ecology never modify the scientific world', () => { assert.equal(fp(P), before); });
