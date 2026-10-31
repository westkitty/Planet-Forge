// PF-22 The Planet Trials. Deterministic challenges generated from the world's own data. A trial is only offered when
// the generator has found at least one cell (or route) that satisfies it, so every offered trial is solvable. Scoring
// rules are listed per trial; three attempts each; hints cost points.
import { RIVER_MIN_M3S } from '../hydrology.js';
import { KOPPEN } from '../planet.js';
import { gameRng, shortestPath } from './core.js';
import { ringDistance } from '../geo.js';
import { forecast } from './expedition.js';

const ringCache = new WeakMap();
function rings(p, key, pred, max) { let m = ringCache.get(p); if (!m) ringCache.set(p, m = new Map()); if (!m.has(key)) m.set(key, ringDistance(p.mesh, pred, max)); return m.get(key); }
const convergentRings = p => rings(p, 'conv5', i => p.boundary[i] === 1, 5), riftRings = p => rings(p, 'div3', i => p.boundary[i] === 2, 3);
const land = (p, i) => p.elevation[i] >= 0 && !p.hydro.lake[i];
function nearWater(p, i) { if (p.hydro.discharge[i] >= RIVER_MIN_M3S || p.hydro.lake[i] === 1) return true; for (let e = p.mesh.offsets[i]; e < p.mesh.offsets[i + 1]; e++) { const j = p.mesh.neighbors[e]; if ((p.elevation[j] >= 0 && p.hydro.discharge[j] >= RIVER_MIN_M3S) || p.hydro.lake[j] === 1) return true; } return false; }

/** Each kind: build(p, rand) → trial params or null if not achievable on this world; score(p, t, cell) → { points, criteria[] }. */
export const KINDS = {
  settlement: {
    title: 'Found a sustainable settlement',
    build(p) { for (let i = 0; i < p.cellCount; i += 13) if (this.criteria(p, {}, i).every(c => c.ok)) return { example: i }; return null; },
    criteria(p, t, i) {
      const hz = convergentRings(p), T = p.temperature[i], R = p.rainfall[i];
      return [{ name: 'on land', ok: land(p, i), pts: 20 }, { name: 'fresh water within one cell (river ≥ ' + RIVER_MIN_M3S + ' m³/s or fresh lake)', ok: nearWater(p, i), pts: 25 },
        { name: 'mild climate (annual mean 5–25 °C)', ok: T >= 5 && T <= 25, pts: 20 }, { name: 'reliable rain (500–2,000 mm/yr)', ok: R >= 500 && R <= 2000, pts: 20 },
        { name: 'below 1,500 m', ok: p.elevation[i] < 1500, pts: 5 }, { name: 'more than 5 cells from a convergent boundary', ok: hz[i] < 0, pts: 10 }];
    },
    goal: 'Score 80+ points on the listed criteria.', pass: 80
  },
  basin: {
    title: 'Find a great freshwater basin',
    build(p) { const b = p.hydro.basins.map((x, k) => ({ k, km2: x.cells * p.cellAreaKm2, endo: x.endorheic })).filter(x => !x.endo).sort((a, b) => b.km2 - a.km2); if (!b.length) return null; const min = Math.round(b[Math.min(2, b.length - 1)].km2 / 1e5) * 1e5 || Math.round(b[0].km2); return { minKm2: min }; },
    criteria(p, t, i) { const b = p.hydro.basin[i] >= 0 ? p.hydro.basins[p.hydro.basin[i]] : { endorheic: true, cells: 0 }; return [{ name: 'on land', ok: p.elevation[i] >= 0, pts: 20 }, { name: 'basin drains to the sea', ok: !b.endorheic, pts: 30 }, { name: `basin area ≥ ${t.minKm2.toLocaleString('en-US')} km²`, ok: b.cells * p.cellAreaKm2 >= t.minKm2, pts: 50 }]; },
    goal: 'Select any land cell inside a qualifying basin.', pass: 100
  },
  climate: {
    title: 'Find a rare climatic meeting point',
    build(p, rand) {
      const pairs = new Map();
      for (let i = 0; i < p.cellCount; i += 3) { if (p.elevation[i] < 0) continue; for (let e = p.mesh.offsets[i]; e < p.mesh.offsets[i + 1]; e++) { const j = p.mesh.neighbors[e]; if (p.elevation[j] < 0 || p.koppen[j] === p.koppen[i]) continue; const key = p.koppen[i] + ':' + p.koppen[j]; pairs.set(key, (pairs.get(key) || 0) + 1); } }
      const rare = [...pairs.entries()].filter(([, c]) => c >= 2 && c <= 40).sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
      if (!rare.length) return null; const [a, b] = rare[Math.floor(rand() * Math.min(5, rare.length))][0].split(':').map(Number); return { a, b };
    },
    criteria(p, t, i) { let adj = false; for (let e = p.mesh.offsets[i]; e < p.mesh.offsets[i + 1]; e++) if (p.koppen[p.mesh.neighbors[e]] === t.b) adj = true; return [{ name: `cell is Köppen ${KOPPEN[t.a]}`, ok: p.koppen[i] === t.a, pts: 50 }, { name: `a neighbouring cell is Köppen ${KOPPEN[t.b]}`, ok: adj, pts: 50 }]; },
    goal: 'Select a cell where the two climates meet.', pass: 100
  },
  research: {
    title: 'Site a rift research station',
    build(p) { for (let i = 0; i < p.cellCount; i++) if (p.boundary[i] === 2 && p.elevation[i] >= 0) return {}; return null; },
    criteria(p, t, i) { const nearDiv = riftRings(p)[i] >= 0; return [{ name: 'on land', ok: p.elevation[i] >= 0, pts: 40 }, { name: 'within 3 cells of a divergent (rifting) boundary', ok: nearDiv, pts: 60 }]; },
    goal: 'Select a land cell on or beside an active rift.', pass: 100
  },
  route: {
    title: 'Choose the safest travel season',
    build(p, rand) {
      const s = p.settlements; if (s.length < 2) return null;
      for (let k = 0; k < s.length - 1; k++) { const a = s[k].cell, b = s[k + 1].cell; if (!shortestPath(p.mesh, a, b, (x, y) => p.elevation[y] >= 0 && !p.hydro.lake[y] ? 1 : Infinity)) continue; return { from: a, to: b, fromName: s[k].name, toName: s[k + 1].name }; }
      return null;
    },
    criteria: null, goal: 'Pick the departure month with the fewest expected incidents (within 10 % of the best).', pass: 100
  }
};
export const ORDER = ['settlement', 'basin', 'climate', 'research', 'route'];

/** Shareable code: world seed + gameplay seed. */
export const challengeCode = (worldSeed, gameSeed) => `${worldSeed}~${gameSeed}`;
export function parseChallenge(code) { const m = /^([^~]{1,64})~(\d{1,9})$/.exec(String(code).trim()); return m ? { worldSeed: m[1], gameSeed: Number(m[2]) } : null; }

export function generateTrials(p, gameSeed = 1) {
  const rand = gameRng(p.seed, 'trials', gameSeed), out = [];
  for (const kind of ORDER) { const t = KINDS[kind].build(p, rand); if (t) out.push({ kind, title: KINDS[kind].title, goal: KINDS[kind].goal, params: t, attempts: 0, hints: 0, done: false, won: false, score: 0 }); }
  return { gameSeed, code: challengeCode(p.seed, gameSeed), trials: out };
}
/** Attempt trial t with a selected cell (or month for the route trial). Returns a new trial object and the result. */
export function attempt(p, t, answer) {
  if (t.done) return { trial: t, result: { error: 'trial already finished' } };
  let pts, criteria;
  if (t.kind === 'route') {
    const f = forecast(p, t.params.from, t.params.to).filter(x => x.possible), best = Math.min(...f.map(x => x.expectedIncidents)), pick = f.find(x => x.month === answer);
    if (!pick) return { trial: t, result: { error: 'choose a month in which the route is possible' } };
    const ok = pick.expectedIncidents <= best * 1.1 + 1e-9;
    criteria = [{ name: `expected incidents ${pick.expectedIncidents} vs best ${best}`, ok, pts: 100 }]; pts = ok ? 100 : 0;
  } else {
    if (!(answer >= 0 && answer < p.cellCount)) return { trial: t, result: { error: 'select a place first' } };
    criteria = KINDS[t.kind].criteria(p, { ...t.params }, answer).map(({ name, ok, pts }) => ({ name, ok, pts }));
    pts = criteria.reduce((s, c) => s + (c.ok ? c.pts : 0), 0);
  }
  const score = Math.max(0, pts - 10 * t.hints), won = pts >= KINDS[t.kind].pass, attempts = t.attempts + 1, done = won || attempts >= 3;
  return { trial: { ...t, attempts, done, won, score: won ? score : t.score }, result: { points: pts, score, won, done, criteria, attemptsLeft: 3 - attempts } };
}
/** A hint names a qualifying region's latitude band (costs 10 points on a win). */
export function hint(p, t) {
  let cell = -1;
  if (t.kind === 'route') return { trial: { ...t, hints: t.hints + 1 }, text: 'Compare the forecast: snow and swollen rivers dominate the risk; look for the months where neither applies along the route.' };
  const params = { ...t.params };
  for (let i = 0; i < p.cellCount && cell < 0; i += 7) if (KINDS[t.kind].criteria(p, params, i).every(c => c.ok)) cell = i;
  if (cell < 0) return { trial: t, text: 'No hint available.' };
  const lat = Math.round(p.lat[cell] / 10) * 10;
  return { trial: { ...t, hints: t.hints + 1 }, text: `A qualifying place exists near latitude ${lat}° (±5°).`, cell };
}
