import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { buildPatch, sites, newVehicle, moveVehicle, heightAt, pressureBar, VEHICLES, GRID } from '../src/localTerrain.js';
import { runExperiment, delta, metrics } from '../src/gameplay/lab.js';

const mesh = geodesicMesh(100), P = createPlanet('ATLAS-001', { frequency: 100, mesh });
const fp = p => [p.elevation, p.temperature, p.rainfall, p.biome, p.hydro.discharge].map(a => { let h = 2166136261; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 5) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }).join('-');
const before = fp(P);
const landCell = P.settlements[0].cell;
let oceanCell = -1; for (let i = 0; i < P.cellCount; i++) if (P.boundary[i] === 2 && P.elevation[i] < -2500 && P.elevation[i] > -5000) { oceanCell = i; break; }

test('PF-19/32 local terrain follows the authoritative cells and is deterministic', () => {
  const a = buildPatch(P, landCell), b = buildPatch(P, landCell);
  assert.deepEqual(a.height, b.height); assert.equal(a.grid, GRID);
  assert.equal(a.cellOf[(GRID >> 1) * GRID + (GRID >> 1)], landCell, 'the patch is centred on the selected cell');
  let worst = 0; for (let k = 0; k < GRID * GRID; k += 37) { const c = a.cellOf[k]; worst = Math.max(worst, Math.abs(a.height[k] - P.elevation[c])); }
  const span = Math.max(...Array.from(a.cellOf, c => P.elevation[c])) - Math.min(...Array.from(a.cellOf, c => P.elevation[c]));
  assert.ok(worst <= span + 2 * a.relief, `local height stays within the cells' range plus the stated detail amplitude (${worst.toFixed(0)} m)`);
  const o = buildPatch(P, oceanCell, { kind: 'ocean' });
  assert.ok(o.height[(GRID >> 1) * GRID + (GRID >> 1)] < 0, 'seafloor is below sea level');
  assert.deepEqual(sites(P, o), sites(P, o)); assert.ok(sites(P, o).some(s => s.type === 'hydrothermal vent'), 'vents on a spreading ridge');
  assert.match(a.note, /procedural and illustrative/);
});

test('PF-19 rover: energy accounting, sample collection, return to the lander completes the mission', () => {
  const patch = buildPatch(P, landCell), list = sites(P, patch); let s = newVehicle(patch, 'surface');
  assert.ok(list.length >= 3);
  const goTo = (x, y) => { for (let n = 0; n < 200 && !s.over && Math.hypot(s.x - x, s.y - y) > 1.5; n++) { const dx = Math.sign(x - s.x) * Math.min(2, Math.abs(x - s.x)), dy = Math.sign(y - s.y) * Math.min(2, Math.abs(y - s.y)); const e0 = s.energy; s = moveVehicle(patch, list, s, { dx, dy }, 'rover'); assert.ok(s.energy <= e0, 'energy never increases'); } };
  const order = list.map((t, k) => k).sort((a, b) => Math.hypot(list[a].x - 48, list[a].y - 48) - Math.hypot(list[b].x - 48, list[b].y - 48)).slice(0, 3);
  for (const k of order) goTo(list[k].x, list[k].y);
  goTo(s.home[0], s.home[1]);
  assert.ok(s.collected.length >= 3 || s.over, 'collected or ran out');
  if (s.collected.length >= 3 && s.energy > 0) assert.ok(s.won && s.over, s.log.slice(-1)[0]);
  const drained = moveVehicle(patch, list, { ...newVehicle(patch, 'surface'), energy: .01 }, { dx: 2, dy: 0 }, 'rover');
  assert.ok(drained.over && !drained.won, 'running out of energy fails');
});

test('PF-32 submersible: pressure ρgh, hull limit, dive and surface', () => {
  assert.ok(Math.abs(pressureBar(1000) - (1025 * 9.81 * 1000 / 1e5 + 1.013)) < 1e-9);
  assert.ok(Math.abs(pressureBar(10000) - 1006.5) < 1, '≈ 1,000 bar at 10 km');
  const patch = buildPatch(P, oceanCell, { kind: 'ocean' }), list = sites(P, patch); let s = newVehicle(patch, 'ocean');
  for (let n = 0; n < 40; n++) s = moveVehicle(patch, list, s, { dx: 0, dy: 0, dz: 400 }, 'sub');
  assert.ok(s.depth <= VEHICLES.sub.crushDepth && s.depth <= -heightAt(patch, s.x, s.y), 'never below the floor or the hull rating');
  assert.ok(s.depth > 1000);
  const deep = { ...s, depth: 0 }, r = moveVehicle({ ...patch, height: patch.height.map(() => -9000) }, [], deep, { dx: 0, dy: 0, dz: 8000 }, 'sub');
  assert.equal(r.depth, VEHICLES.sub.crushDepth, 'hull limit enforced');
});

test('PF-16 experiments: baseline untouched, reproducible, consistent units, revert by discarding', () => {
  const e1 = runExperiment(P, mesh, 'tilt', 40), e2 = runExperiment(P, mesh, 'tilt', 40);
  assert.deepEqual(e1.after, e2.after); assert.deepEqual(Array.from(e1.dT.slice(0, 500)), Array.from(e2.dT.slice(0, 500)));
  assert.equal(fp(P), before, 'the baseline planet is not modified');
  assert.deepEqual(e1.before, metrics(P)); assert.equal(e1.world.version, P.version); assert.equal(e1.world.tilt, 40);
  for (let i = 0; i < P.cellCount; i += 997) assert.equal(e1.world.elevation[i], P.elevation[i], 'relief unchanged by a tilt experiment');
  const d = delta(e1.before, e1.after); assert.ok(Math.abs(d.meanTempC - (e1.after.meanTempC - e1.before.meanTempC)) < 1e-9);
  const g = runExperiment(P, mesh, 'glacial'); assert.ok(g.after.meanTempC < g.before.meanTempC && g.after.landFraction > g.before.landFraction, 'glacial: colder, more land');
  assert.ok(runExperiment(P, mesh, 'tilt', 120).error);
});
