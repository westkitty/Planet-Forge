import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { shortestPath, reachable } from '../src/gameplay/core.js';
import { planRoute, simulate, forecast, runExpedition } from '../src/gameplay/expedition.js';
import { generateTrials, attempt, hint, parseChallenge } from '../src/gameplay/trials.js';
import { newSurvey, scan, progress, coverage, SURVEY } from '../src/gameplay/survey.js';
import { setupBasin, simulateCouncil, riversForCouncil, RULES as WR } from '../src/gameplay/watershed.js';
import { setupThaw, newThaw, thawTurn, passableAt } from '../src/gameplay/thaw.js';
import { newCampaign, act, advance, impactLab, forecastRisk } from '../src/gameplay/faultline.js';

const mesh = geodesicMesh(100);
const P = createPlanet('ATLAS-001', { frequency: 100, mesh });
const fp = p => [p.elevation, p.temperature, p.rainfall, p.biome, p.hydro.discharge].map(a => { let h = 2166136261; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 5) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }).join('-');
const before = fp(P);
const towns = P.settlements.map(s => s.cell);

test('Dijkstra finds an optimal path on a uniform-cost graph (equals BFS hop count)', () => {
  const ok = i => P.elevation[i] >= 0;
  const r = shortestPath(mesh, towns[0], towns[0], () => 1); assert.deepEqual(r.path, [towns[0]]);
  const all = c => 1, a = 0, b = 5000, sp = shortestPath(mesh, a, b, all);
  const d = new Int32Array(mesh.count).fill(-1), q = [a]; d[a] = 0; for (let h = 0; h < q.length; h++) { const i = q[h]; for (let e = mesh.offsets[i]; e < mesh.offsets[i + 1]; e++) { const j = mesh.neighbors[e]; if (d[j] < 0) { d[j] = d[i] + 1; q.push(j); } } }
  assert.equal(sp.cost, d[b]); assert.equal(sp.path.length, d[b] + 1);
  assert.ok(reachable(mesh, towns[0], ok)[towns[0]]);
});

test('PF-28 expeditions: documented costs, seasonal differences, deterministic outcomes', () => {
  const pair = (() => { for (let i = 0; i < towns.length; i++) for (let j = i + 1; j < towns.length; j++) if (planRoute(P, towns[i], towns[j], 0)) return [towns[i], towns[j]]; })();
  assert.ok(pair, 'two settlements connected over land');
  const f = forecast(P, pair[0], pair[1]);
  assert.equal(f.length, 12);
  const days = f.filter(x => x.possible).map(x => x.days);
  assert.ok(days.length >= 1);
  const r1 = runExpedition(P, { from: pair[0], to: pair[1], month: 3, seed: 7 }), r2 = runExpedition(P, { from: pair[0], to: pair[1], month: 3, seed: 7 });
  assert.deepEqual(r1, r2, 'same decisions replay identically');
  assert.ok(r1.ok && r1.path.every(c => P.elevation[c] >= 0 && !P.hydro.lake[c]), 'land only');
  const short = runExpedition(P, { from: pair[0], to: pair[1], month: 3, supplies: 5, party: 6, seed: 7 });
  assert.equal(short.arrived, false, 'too few rations fails');
  const forced = simulate(P, r1.path, { month: 3, party: 6, supplies: 1e9, forced: true }), steady = simulate(P, r1.path, { month: 3, party: 6, supplies: 1e9 });
  assert.ok(forced.days < steady.days, 'forced march is faster');
  assert.ok(steady.expectedIncidents === 0 ? forced.expectedIncidents === 0 : forced.expectedIncidents / forced.days > 1.4 * steady.expectedIncidents / steady.days, 'and riskier per day');
});

test('PF-22 trials are solvable on this world, scored transparently and replay from a challenge code', () => {
  const a = generateTrials(P, 3), b = generateTrials(P, 3);
  assert.deepEqual(a, b); assert.ok(a.trials.length >= 4, a.trials.map(t => t.kind).join());
  assert.deepEqual(parseChallenge(a.code), { worldSeed: 'ATLAS-001', gameSeed: 3 });
  assert.equal(parseChallenge('bad code'), null);
  for (const t of a.trials) {
    if (t.kind === 'route') { const f = forecast(P, t.params.from, t.params.to).filter(x => x.possible).sort((x, y) => x.expectedIncidents - y.expectedIncidents); const r = attempt(P, t, f[0].month); assert.ok(r.result.won, 'best month wins'); continue; }
    const hn = hint(P, t); assert.ok(hn.cell >= 0, t.kind + ' has a qualifying cell');
    const win = attempt(P, hn.trial, hn.cell); assert.ok(win.result.won, t.kind); assert.equal(win.result.score, win.result.points - 10, 'hint costs 10 points');
    let tr = t; for (let k = 0; k < 3; k++) tr = attempt(P, tr, 0).trial.won ? tr : attempt(P, tr, 0).trial;
    const lose = [0, 1, 2].reduce(x => attempt(P, x, -5).trial.done ? x : attempt(P, x, -5).trial, t);
    assert.ok(attempt(P, t, -1).result.error);
  }
});

test('PF-17 survey: limited budget, coverage reconstructed from the scan log, findings recorded', () => {
  let s = newSurvey(); assert.equal(s.budget, SURVEY.probes);
  const r1 = scan(P, s, { type: 'probe', cell: towns[0] }); assert.ok(r1.revealed > 400); s = r1.survey;
  const r2 = scan(P, s, { type: 'pass', lat: 10 }); assert.ok(r2.revealed > 1000); s = r2.survey;
  assert.equal(s.budget, SURVEY.probes - 1 - SURVEY.passCost);
  assert.deepEqual(coverage(P, s.scans), coverage(P, JSON.parse(JSON.stringify(s.scans))), 'reconstructible from saved scans');
  let spend = s; while (spend.budget > 0) spend = scan(P, spend, { type: 'probe', cell: 1000 * spend.budget }).survey;
  assert.ok(scan(P, spend, { type: 'probe', cell: 5 }).error, 'budget is conserved');
  const pr = progress(P, s); assert.ok(pr.mapped > 0 && pr.mapped < 1 && pr.objectives.length >= 4);
  assert.ok(pr.mask[towns[0]]);
});

test('PF-29 watershed: water is conserved and upstream use reduces downstream supply', () => {
  assert.ok(riversForCouncil(P).length >= 1);
  const b = setupBasin(P, 0); assert.ok(b.reaches.length === 4 && Math.abs(b.shares.reduce((x, y) => x + y, 0) - 1) < 1e-9);
  const none = simulateCouncil(b, [{ irrigation: [0, 0, 0, 0], reservoir: [false, false, false, false] }]);
  const heavyUp = simulateCouncil(b, [{ irrigation: [3, 0, 0, 2], reservoir: [false, false, false, false] }]);
  const withRes = simulateCouncil(b, [{ irrigation: [3, 0, 0, 2], reservoir: [true, false, false, true] }]);
  for (const r of [none, heavyUp, withRes]) assert.ok(Math.abs(r.balanceError) < 1e-9, 'Σ inflow = consumption + outflow + Δstorage');
  assert.ok(heavyUp.ledger.outflow < none.ledger.outflow, 'irrigation reduces flow to the sea');
  const solo = simulateCouncil(b, [{ irrigation: [0, 0, 0, 2], reservoir: [false, false, false, false] }]);
  assert.ok(heavyUp.final.harvest[3] <= solo.final.harvest[3], 'upstream withdrawals cannot help the delta');
  assert.deepEqual(simulateCouncil(b, [{ irrigation: [1, 2, 1, 0], reservoir: [true, true, false, false] }]), simulateCouncil(b, [{ irrigation: [1, 2, 1, 0], reservoir: [true, true, false, false] }]));
  assert.equal(none.ecology, 100);
  const max = simulateCouncil(b, [{ irrigation: [3, 3, 3, 3], reservoir: [false, false, false, false] }]);
  assert.ok(max.ecology < 100 || max.harvestScore < 100, 'maximum irrigation creates a real trade-off');
  assert.ok(b.reaches[3].gainKm3yr >= 0 && b.reaches.reduce((s, r) => s + r.gainKm3yr, 0) > 0, 'reaches gain water downstream');
});

test('PF-18 faultline: budget enforced, outcomes deterministic, protections reduce expected losses', () => {
  let c = newCampaign(P); const k = c.towns.findIndex(t => t.quake || t.flood);
  assert.ok(k >= 0, 'at least one exposed settlement');
  const base = forecastRisk(c.towns[k]);
  c = act(c, k, c.towns[k].quake ? 'reinforce' : 'levee').campaign; assert.ok(forecastRisk(c.towns[k]) < base);
  assert.ok(act(c, k, c.towns[k].quake ? 'reinforce' : 'levee').error, 'no double spend');
  let x = c, y = c; for (let t = 0; t < 8; t++) { x = advance(P, x, 5); y = advance(P, y, 5); }
  assert.deepEqual(x, y); assert.ok(x.over); assert.ok(x.totalLost >= 0);
  const pop = x.towns.reduce((s, t) => s + t.population + t.lost, 0); assert.equal(pop, 10000 * P.settlements.length, 'people are conserved: survivors + losses');
  const lab = impactLab(P, towns[0], 1000); assert.ok(lab.craterKm === 20 && lab.settlementsInBlast.some(s => s.cell === towns[0]));
});

test('PF-14 Great Thaw on a land-bridge world: route open at first, closes as the sea rises; deterministic', () => {
  const W = createPlanet('DET-10', { frequency: 100, mesh }), setup = setupThaw(W);
  assert.ok(setup, 'DET-10 has a usable land bridge');
  assert.equal(setupThaw(P) === null || typeof setupThaw(P) === 'object', true);
  const g = W.glaciation, open = passableAt(W, g, 0), closed = passableAt(W, g, 24);
  let shelf = 0, shelfClosed = 0; for (let i = 0; i < W.cellCount; i++) if (W.elevation[i] < 0 && open(i)) { shelf++; if (!closed(i)) shelfClosed++; }
  assert.ok(shelf > 0 && shelfClosed === shelf, 'all exposed shelf is under water at the end');
  const play = choices => choices.reduce((s, c) => thawTurn(W, setup, s, c, 1), newThaw(setup));
  const fast = play(Array(24).fill('march')), again = play(Array(24).fill('march'));
  assert.deepEqual(fast, again);
  assert.ok(fast.won, 'forced marching from the start crosses: ' + fast.log.slice(-1)[0].text);
  const late = play([...Array(23).fill('rest'), 'march']);
  assert.equal(late.won, false, 'waiting until the sea has risen fails');
  assert.ok(fast.supplies >= 0);
});

test('gameplay never modifies the scientific world', () => { assert.equal(fp(P), before); });
