import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { nearestCell, nearestCellBrute, greatCircle, angleBetween, cellDir, pickSurface, ringDistance, EARTH_RADIUS_KM } from '../src/geo.js';
import { transect, transectCsv, QUERIES, runQuery } from '../src/analysis.js';
import { explain, TOPICS } from '../src/why.js';
import { INVESTIGATIONS, investigationAvailability, recordObservation, evaluate, SITES_PER_GROUP, tourStops, ROUTES, facingRotation } from '../src/observatory.js';
import { RIVER_MIN_M3S } from '../src/hydrology.js';
import { rng } from '../src/world.js';

const mesh = geodesicMesh(100);
const planet = createPlanet('ATLAS-001', { frequency: 100, mesh });
const fp = p => [p.elevation, p.temperature, p.rainfall, p.biome, p.hydro.discharge].map(a => { let h = 2166136261; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 5) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }).join('-');
const before = fp(planet);

test('PF-10 nearest-cell walk equals brute force; surface pick returns the cell under the ray', () => {
  const r = rng(7);
  for (let k = 0; k < 200; k++) {
    const z = r() * 2 - 1, a = r() * 2 * Math.PI, s = Math.sqrt(1 - z * z), d = [s * Math.cos(a), z, s * Math.sin(a)];
    assert.equal(nearestCell(mesh, d, Math.floor(r() * mesh.count)), nearestCellBrute(mesh, d));
  }
  for (const c of [0, 1348, 50001, 99999]) {
    const d = cellDir(mesh, c), origin = [d[0] * 3, d[1] * 3, d[2] * 3], dir = [-d[0], -d[1], -d[2]];
    assert.equal(pickSurface(mesh, origin, dir, () => 1.01), c, 'ray straight down onto cell ' + c);
  }
  assert.equal(pickSurface(mesh, [0, 0, 3], [0, 1, 0], () => 1), -1, 'a ray that misses the planet picks nothing');
});

test('PF-27 transect rows are real cells along the great circle with consistent units', () => {
  const a = planet.settlements[0].cell, b = planet.settlements[1].cell, t = transect(planet, a, b);
  const arcKm = angleBetween(cellDir(mesh, a), cellDir(mesh, b)) * EARTH_RADIUS_KM;
  assert.ok(Math.abs(t.lengthKm - arcKm) < 1);
  assert.equal(t.rows[0].cell, a); assert.equal(t.rows[t.rows.length - 1].cell, b);
  for (let k = 1; k < t.rows.length; k++) assert.ok(t.rows[k].distanceKm >= t.rows[k - 1].distanceKm && t.rows[k].cell !== t.rows[k - 1].cell);
  for (const r of t.rows) {
    assert.equal(r.elevationM, Math.round(planet.elevation[r.cell]));
    assert.equal(r.rainfallMm, Math.round(planet.rainfall[r.cell]));
    assert.equal(r.oceanDepthM, planet.elevation[r.cell] < 0 ? Math.round(-planet.elevation[r.cell]) : 0);
    assert.equal(r.river > 0, planet.elevation[r.cell] >= 0 && planet.hydro.discharge[r.cell] >= RIVER_MIN_M3S && !planet.hydro.lake[r.cell]);
  }
  const gap = Math.max(...t.rows.slice(1).map((r, k) => angleBetween(cellDir(mesh, r.cell), cellDir(mesh, t.rows[k].cell)) * EARTH_RADIUS_KM));
  assert.ok(gap < planet.spacingKm * 2, 'consecutive cells are neighbours or near-neighbours: ' + gap.toFixed(0) + ' km');
  assert.equal(transectCsv(t).split('\n').length, t.rows.length + 1);
  assert.equal(t.summary.iceModelled, false);
});

test('PF-31 queries agree with a direct recount of the arrays and are deterministic', () => {
  for (const id of Object.keys(QUERIES)) {
    const r1 = runQuery(planet, id), r2 = runQuery(planet, id);
    assert.deepEqual(r1.matches, r2.matches, id + ' deterministic');
    assert.match(r1.caution, /does not show that one causes the other/);
  }
  const r = runQuery(planet, 'riversNearBoundaries', { km: 300 }), lim = Math.round(300 / planet.spacingKm);
  let nB = 0, aB = 0, nP = 0, aP = 0;
  for (let i = 0; i < planet.cellCount; i++) {
    if (planet.elevation[i] < 0) continue; nP++;
    const riv = planet.hydro.discharge[i] >= RIVER_MIN_M3S && !planet.hydro.lake[i]; if (riv) aP++;
    const d = planet.boundaryDistance[i]; if (d >= 0 && d <= lim) { nB++; if (riv) aB++; }
  }
  assert.deepEqual([r.population, r.withA, r.inB, r.count], [nP, aP, nB, aB]);
  assert.ok(Math.abs(r.lift - (aB / nB) / (aP / nP)) < 1e-12);
  const h = runQuery(planet, 'settlementHazards');
  assert.equal(h.population, planet.settlements.length);
  const d = ringDistance(mesh, i => planet.boundary[i] === 1);
  for (const x of h.ranked) if (Number.isFinite(x.value)) assert.equal(x.value, Math.round(d[x.cell] * planet.spacingKm));
});

test('PF-12 explanations quote the arrays, separate facts from inference, and are deterministic', () => {
  const c = planet.settlements[0].cell;
  for (const topic of Object.keys(TOPICS)) {
    const a = explain(planet, c, topic), b = explain(planet, c, topic);
    assert.deepEqual(a, b);
    assert.ok(a.facts.length && a.unknowns.length, topic);
  }
  assert.ok(explain(planet, c, 'terrain').facts[0].includes(`Elevation ${Math.round(planet.elevation[c])} m`));
  assert.ok(explain(planet, c, 'climate').facts[0].includes(`Rainfall ${Math.round(planet.rainfall[c])} mm/yr`));
  assert.ok(explain(planet, c, 'settlement').facts[0].startsWith(planet.settlements[0].name));
  assert.match(explain(planet, c, 'ice').unknowns[0], /Last glacial maximum/, 'ice needs the glacial state first');
});

test('PF-30 investigations: eligibility enforced, values measured, verdict can reject H1', () => {
  const avail = investigationAvailability(planet);
  assert.ok(Object.values(avail).filter(Boolean).length >= 4, JSON.stringify(avail));
  for (const [id, inv] of Object.entries(INVESTIGATIONS)) {
    if (!avail[id]) continue;
    const pick = g => { const out = []; for (let i = 0; i < planet.cellCount && out.length < SITES_PER_GROUP; i += 97) if (inv.groups[g].ok(planet, i)) out.push(i); return out; };
    const rec = [];
    const bad = (() => { for (let i = 0; i < planet.cellCount; i += 101) if (!inv.groups.A.ok(planet, i)) return i; })();
    assert.equal(recordObservation(planet, id, rec, 'A', bad).ok, false, 'ineligible site rejected');
    for (const g of ['A', 'B']) for (const c of pick(g)) { const r = recordObservation(planet, id, rec, g, c); assert.ok(r.ok, r.reason); assert.equal(r.observation.value, inv.measure.of(planet, c)); rec.push(r.observation); }
    assert.equal(recordObservation(planet, id, rec, 'A', rec[0].cell).ok, false, 'duplicate rejected');
    const e = evaluate(id, rec, 'supported');
    assert.ok(e.complete);
    const diff = e.meanA - e.meanB, expected = Math.sign(diff) === inv.expect && Math.abs(diff) > inv.margin ? 'supported' : 'rejected';
    assert.equal(e.verdict, expected);
    assert.equal(evaluate(id, rec, expected).correct, true);
    assert.equal(evaluate(id, rec, expected === 'supported' ? 'rejected' : 'supported').correct, false);
  }
  assert.equal(evaluate('rainShadow', [], 'supported').complete, false);
});

test('PF-09 tours are deterministic, use real cells, and the facing rotation brings a stop to the camera', () => {
  for (const r of Object.keys(ROUTES)) {
    const a = tourStops(planet, r), b = tourStops(planet, r);
    assert.deepEqual(a, b); assert.ok(a.length >= 1, r);
    for (const s of a) assert.ok(Number.isInteger(s.cell) && s.cell >= 0 && s.cell < planet.cellCount && s.title && s.text);
  }
  const top = tourStops(planet, 'mountains')[0].cell;
  let mx = -Infinity; for (let i = 0; i < planet.cellCount; i++) mx = Math.max(mx, planet.elevation[i]);
  assert.equal(planet.elevation[top], mx);
  const d = cellDir(mesh, 1348), rot = facingRotation(d);
  const cy = Math.cos(rot.y), sy = Math.sin(rot.y), x1 = d[0] * cy + d[2] * sy, z1 = -d[0] * sy + d[2] * cy;
  const cx = Math.cos(rot.x), sx = Math.sin(rot.x), y2 = d[1] * cx - z1 * sx, z2 = d[1] * sx + z1 * cx;
  assert.ok(Math.abs(x1) < 1e-9 && Math.abs(y2) < 1e-9 && z2 > .999);
});

test('observatory analysis never modifies the scientific world', () => {
  transect(planet, 10, 90000); for (const id of Object.keys(QUERIES)) runQuery(planet, id); explain(planet, 5, 'climate');
  assert.equal(fp(planet), before);
});
