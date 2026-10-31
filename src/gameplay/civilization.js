// Milestone 4 civilization history: PF-15 River Kingdoms (simulation), PF-23 Deep Time (snapshots, seek, branches),
// PF-33 The World Remembers (ruins derived from recorded collapses), PF-21 The Silent Planet (mysteries built from the
// recorded history). One deterministic simulation feeds all four, so a ruin is always a settlement that existed and
// collapsed in the recorded run, and every clue points at a recorded event.
//
// Gameplay model (declared): the land around each generated settlement (3 mesh rings) supports people in proportion to
// its net primary production from the Miami model (Lieth 1975) on the world's annual temperature and rainfall. The
// scaling to people, growth rates, event chances and effects in RULES are gameplay values, not demography.
import { ringDistance, cellDir, angleBetween, EARTH_RADIUS_KM } from '../geo.js';
import { RIVER_MIN_M3S } from '../hydrology.js';
import { gameRng } from './core.js';
import { exposure } from './faultline.js';

export const RULES = { stepYears: 10, years: 2000, startPopulation: 200, peoplePerNpp: 0.6, growth: .12, abandonBelow: 60, abandonShare: .12, tradeKm: 5000,
  text: ['Carrying capacity: Σ over land within 3 cells of the site of NPP (Miami model, g/m²/yr) × 0.6 people, ×1.3 with river or lake water.', 'Each decade population grows 12 % × (1 − P/K); above K, half the excess is lost to famine.', 'Droughts (chance from the site\'s month-to-month rainfall variability) last 1–4 decades and cut capacity by 40 % while they last; granaries halve that.', 'Exposed sites suffer earthquakes (5 % a decade) and floods (6 %), each killing 5–15 %.', 'Settlements within 5,000 km over land-weighted distance trade: surplus capacity raises a partner\'s capacity (×1.5 with a road).', 'Overcrowding (P > 0.85 K) depletes soils by 5 % a decade; they recover only 0.5 % a decade.', 'Two stressed trading partners may fight (30 %), each losing 8 %.', 'A settlement older than 150 years that falls below 12 % of its peak (or 60 people) is abandoned; survivors move to a trading partner. The recorded cause is the dominant stress of its last 50 years: drought (≥ 2 drought decades), else conflict, earthquake or flood, else famine from overpopulation.', 'Player investments (one per decade): irrigation (+15 % capacity, +5 % without fresh water), granary, road.'] };

export function npp(T, P) { return Math.min(3000 / (1 + Math.exp(1.315 - .119 * T)), 3000 * (1 - Math.exp(-.000664 * P))); }

/** Static site data (computed once per world). */
export function sites(p) {
  const ex = exposure(p);
  return p.settlements.map((s, k) => {
    const d = ringDistance(p.mesh, i => i === s.cell, 3); let cap = 0, cells = 0;
    for (let i = 0; i < p.cellCount; i++) if (d[i] >= 0 && p.elevation[i] >= 0 && !p.hydro.lake[i]) { cap += npp(p.temperature[i], p.rainfall[i]) / 1000; cells++; }
    const water = s.water !== 'rain-fed', pm = Array.from({ length: 12 }, (_, m) => p.climate.precipitationMonthly[12 * s.cell + m]), mean = pm.reduce((a, b) => a + b, 0) / 12, cv = mean > 0 ? Math.sqrt(pm.reduce((a, b) => a + (b - mean) ** 2, 0) / 12) / mean : 1;
    return { k, name: s.name, cell: s.cell, founded: s.founded, water, capacity: Math.round(cap * 1000 * RULES.peoplePerNpp * (water ? 1.3 : 1)), droughtChance: Math.min(.25, .03 + .12 * cv), quake: ex[k].quake, flood: ex[k].flood, nppSite: Math.round(npp(p.temperature[s.cell], p.rainfall[s.cell])) };
  });
}
/** Land-weighted travel distance between settlements (great circle × (1 + 2 × sea fraction of the sampled path)). */
function routes(p, S) {
  const out = [];
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
    const A = cellDir(p.mesh, S[a].cell), B = cellDir(p.mesh, S[b].cell), km = angleBetween(A, B) * EARTH_RADIUS_KM;
    let sea = 0, prev = S[a].cell; const n = 24;
    for (let t = 1; t < n; t++) { const f = t / n, v = A.map((x, i) => x * (1 - f) + B[i] * f), l = Math.hypot(...v); prev = nearest(p, v.map(x => x / l), prev); if (p.elevation[prev] < 0) sea++; }
    const cost = km * (1 + 2 * sea / (n - 1));
    if (cost <= RULES.tradeKm) out.push({ a, b, km: Math.round(km), cost: Math.round(cost) });
  }
  return out;
}
function nearest(p, d, start) { const P = p.mesh.positions, O = p.mesh.offsets, N = p.mesh.neighbors; let b = start, bd = P[3 * b] * d[0] + P[3 * b + 1] * d[1] + P[3 * b + 2] * d[2]; for (let moved = true; moved;) { moved = false; for (let e = O[b]; e < O[b + 1]; e++) { const j = N[e], v = P[3 * j] * d[0] + P[3 * j + 1] * d[1] + P[3 * j + 2] * d[2]; if (v > bd) { bd = v; b = j; moved = true; } } } return b; }

/**
 * Run the history. decisions: [{ year, k, kind: 'irrigation'|'granary'|'road' }] (at most one per decade).
 * Returns { snapshots: [{ year, pop[], alive[], founded[] }], events: [...], ruins: [...] }.
 */
export function simulateHistory(p, decisions = [], gameSeed = 0) {
  const S = sites(p), R = routes(p, S), rand = gameRng(p.seed, 'history', gameSeed), steps = RULES.years / RULES.stepYears;
  const st = S.map(s => ({ pop: 0, alive: false, founded: false, K0: s.capacity, K: s.capacity, irrigation: false, granary: false, road: false, peak: 0, lastStress: null, abandoned: null, drought: 0, stress: [] }));
  const stress = (k, year, type) => st[k].stress.push({ year, type });
  const events = [], snapshots = [], byYear = new Map(); for (const d of decisions) if (!byYear.has(d.year)) byYear.set(d.year, d);
  const log = (year, k, type, text, extra = {}) => events.push({ year, k, cell: S[k].cell, settlement: S[k].name, type, text, ...extra });
  for (let step = 0; step <= steps; step++) {
    const year = step * RULES.stepYears;
    for (let k = 0; k < S.length; k++) if (!st[k].founded && S[k].founded <= year) { st[k] = { ...st[k], founded: true, alive: true, pop: RULES.startPopulation }; log(year, k, 'founding', `${S[k].name} founded (${S[k].water ? 'fresh water' : 'rain-fed'}, capacity ≈ ${S[k].capacity.toLocaleString('en-US')} people).`); }
    const d = byYear.get(year);
    if (d && st[d.k]?.alive) { const s = st[d.k]; if (d.kind === 'irrigation' && !s.irrigation) { s.irrigation = true; s.K0 *= S[d.k].water ? 1.15 : 1.05; s.K *= S[d.k].water ? 1.15 : 1.05; } if (d.kind === 'granary') s.granary = true; if (d.kind === 'road') s.road = true; log(year, d.k, 'investment', `${S[d.k].name} built ${d.kind === 'irrigation' ? 'irrigation works' : 'a ' + d.kind}.`); }
    const Keff = st.map((s, k) => {
      if (!s.alive) return 0; let K = s.K;
      if (!s.drought && rand() < S[k].droughtChance) { s.drought = 1 + Math.floor(rand() * 4); log(year, k, 'drought', `A ${s.drought * 10}-year drought began at ${S[k].name}.`); }
      if (s.drought) { K *= s.granary ? .8 : .6; s.drought--; s.lastStress = 'drought'; stress(k, year, 'drought'); }
      return K;
    });
    for (const r of R) { // trade
      const [a, b] = [st[r.a], st[r.b]]; if (!a.alive || !b.alive) continue;
      const roads = (a.road ? .5 : 0) + (b.road ? .5 : 0), eff = 1 + roads;
      for (const [x, y] of [[r.a, r.b], [r.b, r.a]]) { const spare = Keff[x] - st[x].pop, need = st[y].pop - Keff[y]; if (spare > 0 && need > 0) { const moved = Math.min(spare, need) * .5 * eff * (1 - r.cost / RULES.tradeKm / 2); Keff[y] += moved; if (!st[y]['trade' + x]) { st[y]['trade' + x] = true; log(year, y, 'trade', `${S[y].name} began trading with ${S[x].name} (${r.km.toLocaleString('en-US')} km).`); } } }
      if (st[r.a].pop > Keff[r.a] && st[r.b].pop > Keff[r.b] && r.cost < 1500 && rand() < .3) { for (const k of [r.a, r.b]) { st[k].pop *= .92; st[k].lastStress = 'conflict'; stress(k, year, 'conflict'); } log(year, r.a, 'conflict', `${S[r.a].name} and ${S[r.b].name} fought over scarce food.`, { other: r.b }); }
    }
    for (let k = 0; k < S.length; k++) {
      const s = st[k]; if (!s.alive) continue;
      for (const [h, c] of [['quake', .05], ['flood', .06]]) if (S[k][h] && rand() < c) { const f = .05 + .1 * rand(); s.pop *= 1 - f; s.lastStress = h === 'quake' ? 'earthquake' : 'flood'; stress(k, year, s.lastStress); log(year, k, s.lastStress, `${h === 'quake' ? 'An earthquake' : 'A flood'} struck ${S[k].name} (${Math.round(f * 100)} % lost).`); }
      if (s.pop > Keff[k]) {
        const excess = s.pop - Keff[k]; let moved = 0;
        const dest = R.filter(r => r.a === k || r.b === k).map(r => r.a === k ? r.b : r.a).filter(j => st[j].alive && Keff[j] > st[j].pop).sort((x, y) => (Keff[y] - st[y].pop) - (Keff[x] - st[x].pop))[0];
        if (dest !== undefined) { moved = Math.min(excess * .4, Keff[dest] - st[dest].pop); st[dest].pop += moved; s.pop -= moved; if (moved > 20) { s.lastStress = s.lastStress || 'emigration'; log(year, k, 'migration', `${Math.round(moved).toLocaleString('en-US')} people left ${S[k].name} for ${S[dest].name}.`, { other: dest }); } }
        const lost = Math.max(0, s.pop - Keff[k]) * .5; if (lost > 10) { s.pop -= lost; s.lastStress = 'famine'; stress(k, year, 'famine'); log(year, k, 'famine', `Famine at ${S[k].name}: ${Math.round(lost).toLocaleString('en-US')} died.`); }
      } else s.pop += RULES.growth * s.pop * (1 - s.pop / Math.max(1, Keff[k]));
      s.K = s.pop > .85 * s.K ? s.K * .95 : Math.min(s.K0, s.K * 1.005);
      s.peak = Math.max(s.peak, s.pop);
      if (s.pop < RULES.abandonBelow || (year - S[k].founded >= 150 && s.pop < RULES.abandonShare * s.peak)) {
        const to = R.filter(r => r.a === k || r.b === k).map(r => r.a === k ? r.b : r.a).find(j => st[j].alive);
        if (to !== undefined) { st[to].pop += s.pop; log(year, k, 'migration', `The last ${Math.round(s.pop).toLocaleString('en-US')} people of ${S[k].name} left for ${S[to].name}.`, { other: to }); }
        const recent = s.stress.filter(x => x.year > year - 50), n = t => recent.filter(x => x.type === t).length;
        s.lastStress = n('drought') >= 2 ? 'drought' : n('conflict') ? 'conflict' : n('earthquake') ? 'earthquake' : n('flood') ? 'flood' : n('famine') ? 'famine' : 'emigration';
        s.alive = false; s.abandoned = year; log(year, k, 'abandoned', `${S[k].name} was abandoned (last stress: ${s.lastStress || 'decline'}).`, { cause: s.lastStress || 'decline', peak: Math.round(s.peak) }); s.pop = 0; }
    }
    snapshots.push({ year, pop: st.map(s => Math.round(s.pop)), alive: st.map(s => s.alive), founded: st.map(s => s.founded) });
  }
  const ruins = S.map((s, k) => st[k].abandoned === null ? null : { k, name: s.name, cell: s.cell, founded: s.founded, abandoned: st[k].abandoned, peak: Math.round(st[k].peak), cause: events.find(e => e.k === k && e.type === 'abandoned').cause }).filter(Boolean);
  return { sites: S, routes: R, snapshots, events, ruins, decisions: decisions.slice(), gameSeed };
}
export const snapshotAt = (h, year) => h.snapshots[Math.max(0, Math.min(h.snapshots.length - 1, Math.round(year / RULES.stepYears)))];

// ---- PF-23 Deep Time ----
/** Epochs: two computed geological states plus the recorded civilization phases. */
export function epochs(p, h) {
  const first = h.events.find(e => e.type === 'founding'), ruins = h.ruins.length;
  return [
    { name: 'Last glacial maximum', kind: 'computed state', text: 'The glaciation model\'s glacial-maximum state (ice sheets, lower sea, land bridges). Its timing before the present is not simulated.' },
    { name: 'Present interglacial', kind: 'computed state', text: 'Today\'s climate, rivers and coasts from the world model.' },
    { name: 'Age of founding', kind: 'recorded history', from: first ? first.year : 0, to: Math.max(...h.sites.map(s => s.founded)), text: 'Settlements appear in their seeded founding years.' },
    { name: ruins ? 'Age of decline' : 'Age of growth', kind: 'recorded history', from: Math.max(...h.sites.map(s => s.founded)), to: RULES.years, text: ruins ? `${ruins} settlement${ruins > 1 ? 's' : ''} abandoned.` : 'No settlement was abandoned.' }
  ];
}
export function compareBranches(a, b) {
  const tot = h => h.snapshots[h.snapshots.length - 1].pop.reduce((x, y) => x + y, 0);
  return { populationA: tot(a), populationB: tot(b), ruinsA: a.ruins.map(r => r.name), ruinsB: b.ruins.map(r => r.name), famineA: a.events.filter(e => e.type === 'famine').length, famineB: b.events.filter(e => e.type === 'famine').length };
}

// ---- PF-33 The World Remembers ----
export function ruinState(r, year) { if (year < r.abandoned) return null; const age = year - r.abandoned; return age < 100 ? 'fresh ruin' : age < 400 ? 'weathered ruin' : 'buried ruin'; }
/** Excavation layers: recorded events at the site, oldest at the bottom. Facts are the records; the interpretation is labelled. */
export function excavate(h, ruin) {
  const layers = h.events.filter(e => e.k === ruin.k || e.other === ruin.k).map(e => ({ year: e.year, record: e.text, type: e.type }));
  const counts = layers.reduce((m, l) => (m[l.type] = (m[l.type] || 0) + 1, m), {});
  return { ruin: ruin.name, layers, facts: [`Founded year ${ruin.founded}; abandoned year ${ruin.abandoned}; peak ≈ ${ruin.peak.toLocaleString('en-US')} people.`, `Recorded events: ${Object.entries(counts).map(([k, v]) => k + ' ×' + v).join(', ')}.`],
    interpretation: `Reading of the record: the last major stress before abandonment was ${ruin.cause}.`, note: 'Facts are entries of the recorded simulation history; the interpretation is a reading of them.' };
}

// ---- PF-21 The Silent Planet ----
export const HYPOTHESES = { famine: 'Overpopulation and famine', drought: 'Drought', conflict: 'War with a neighbour', earthquake: 'Earthquake', flood: 'Flood', emigration: 'People moved away', decline: 'Slow decline' };
/** Build a case for a ruin: clue sites and the evidence each yields. Every clue is derived from the recorded history or the world arrays. */
export function buildCase(p, h, ruin) {
  const S = h.sites[ruin.k], evs = h.events.filter(e => e.k === ruin.k || e.other === ruin.k), last = evs.filter(e => e.year <= ruin.abandoned);
  const clues = [{ id: 'site', cell: ruin.cell, title: 'The ruin itself', evidence: last.slice(-4).map(e => ({ text: `Layer, year ${e.year}: ${e.text}`, supports: e.type === 'migration' && e.k === ruin.k ? 'emigration' : e.type })) }];
  const partner = h.routes.find(r => r.a === ruin.k || r.b === ruin.k);
  if (partner) { const j = partner.a === ruin.k ? partner.b : partner.a, pe = h.events.filter(e => (e.k === j && e.other === ruin.k) || (e.other === j && e.k === ruin.k)); clues.push({ id: 'partner', cell: h.sites[j].cell, title: `Records at ${h.sites[j].name}`, evidence: pe.length ? pe.slice(-3).map(e => ({ text: `${h.sites[j].name} records (year ${e.year}): ${e.text}`, supports: e.type === 'migration' ? 'emigration' : e.type })) : [{ text: `${h.sites[j].name} kept no record of contact in the final decades.`, supports: null }] }); }
  let river = -1; for (let e = p.mesh.offsets[ruin.cell]; e < p.mesh.offsets[ruin.cell + 1]; e++) { const j = p.mesh.neighbors[e]; if (p.hydro.discharge[j] >= RIVER_MIN_M3S) river = j; }
  clues.push({ id: 'water', cell: river >= 0 ? river : ruin.cell, title: 'Water and climate', evidence: [{ text: `${S.water ? 'A river or lake supplied the site' : 'The site was rain-fed'}; rainfall ${Math.round(p.rainfall[ruin.cell])} mm/yr, month-to-month variability gives a ${Math.round(S.droughtChance * 100)} % drought chance per decade.`, supports: S.droughtChance > .12 ? 'drought' : null }, { text: `Land around the site supported ≈ ${S.capacity.toLocaleString('en-US')} people; the peak was ${ruin.peak.toLocaleString('en-US')}.`, supports: ruin.peak > .8 * S.capacity ? 'famine' : null }] });
  clues.push({ id: 'ground', cell: ruin.cell, title: 'Geological context', evidence: [{ text: S.quake ? 'The site lies within 4 cells of an active plate boundary.' : 'No active plate boundary nearby.', supports: S.quake ? 'earthquake' : null }, { text: S.flood ? 'A great river runs beside the site.' : 'No major flood channel beside the site.', supports: S.flood ? 'flood' : null }] });
  return { ruin: ruin.name, cell: ruin.cell, answer: ruin.cause, hypotheses: HYPOTHESES, clues, note: 'Generated scenario history: the case is built from this world\'s recorded simulation run.' };
}
/** A case is offered only if its recorded cause is backed by at least two evidence items across the clue sites. */
export const caseSolvable = c => c.clues.flatMap(x => x.evidence).filter(e => e.supports === c.answer).length >= 2;
export function mysteries(p, h) { return h.ruins.map(r => buildCase(p, h, r)).filter(caseSolvable); }
/** Judge a conclusion: it must match the recorded cause and rest on at least two collected evidence items supporting it. */
export function judgeCase(c, collected, hypothesis) {
  const support = collected.filter(e => e.supports === hypothesis).length;
  if (support < 2) return { solved: false, reason: `Only ${support} piece${support === 1 ? '' : 's'} of collected evidence support this; at least two are needed.` };
  return { solved: hypothesis === c.answer, reason: hypothesis === c.answer ? 'The evidence and the record agree.' : `The record shows a different final cause (${HYPOTHESES[c.answer] || c.answer}).` };
}
