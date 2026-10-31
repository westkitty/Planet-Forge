// PF-20 Life Finds a Way. A bounded regional ecology: land is grouped into 10° × 10° regions (only regions with ≥ 20
// land cells), each with the world's mean temperature, rainfall and Miami-model NPP. Fictional species with simple
// traits grow, disperse, compete, adapt, go extinct and split into new species under the stated RULES. It is a
// gameplay model of ecological processes, not a model of real evolution; every rule is listed for the player.
import { gameRng } from './core.js';
import { npp } from './civilization.js';
import { GLACIAL_CELL } from '../glaciation.js';

export const RULES = { maxSpecies: 40, startSpecies: 10, growth: .5, competition: .3, adapt: .15, maxShift: .25, coreShare: .05, isolationGenerations: 5, minIsolatedRegions: 2,
  text: ['Regions: 10° × 10° boxes with at least 20 land cells; climate = mean of their cells; capacity ∝ NPP (Miami model) × land area.', 'Suitability = Gaussian in temperature around the species optimum (width = tolerance) × log-Gaussian in rainfall around its preference.', 'Each generation: logistic growth (rate 0.5), dispersal of a trait-set share to neighbouring regions, and niche competition (species within 3 °C and a factor 1.6 in rainfall preference cut each other\'s capacity by 30 %).', 'Adaptation: optima drift 15 % of the way toward the climate where the species actually lives (at most 0.25 °C per generation).', 'Extinction: regional populations below 1 vanish; a species with none left is extinct.', 'Speciation: a species whose core range (regions holding ≥ 5 % of its densest region) has split into separate groups for 5 generations divides; the smaller group becomes a new species adapted to its own range.', 'Pressures: shift every region\'s temperature, or impose the computed glacial maximum (its global cooling, with ice-covered regions barren).'] };

export function regions(p) {
  const bins = new Map();
  for (let i = 0; i < p.cellCount; i++) {
    if (p.elevation[i] < 0) continue;
    const key = Math.min(17, Math.floor((p.lat[i] + 90) / 10)) * 36 + Math.min(35, Math.floor((p.lon[i] + 180) / 10));
    let b = bins.get(key); if (!b) bins.set(key, b = { key, cells: [], T: 0, P: 0 }); b.cells.push(i); b.T += p.temperature[i]; b.P += p.rainfall[i];
  }
  const R = [...bins.values()].filter(b => b.cells.length >= 20).sort((a, b) => a.key - b.key).map((b, id) => ({ id, key: b.key, cells: b.cells, n: b.cells.length, T: b.T / b.cells.length, P: b.P / b.cells.length, lat: Math.floor(b.key / 36) * 10 - 85, lon: (b.key % 36) * 10 - 175 }));
  const byKey = new Map(R.map(r => [r.key, r.id]));
  for (const r of R) { const la = Math.floor(r.key / 36), lo = r.key % 36; r.nb = []; for (const [dy, dx] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]]) { const y = la + dy; if (y < 0 || y > 17) continue; const id = byKey.get(y * 36 + ((lo + dx + 36) % 36)); if (id !== undefined) r.nb.push(id); } }
  return R;
}
const syl = ['ka', 'lo', 'ri', 'tha', 'mu', 'sen', 'vor', 'ela', 'qui', 'dra', 'po', 'nix', 'ur', 'zel', 'ba', 'oth'];
const nameFor = (rand) => { const g = syl[Math.floor(rand() * 16)] + syl[Math.floor(rand() * 16)], s = syl[Math.floor(rand() * 16)] + syl[Math.floor(rand() * 16)] + 'us'; return g[0].toUpperCase() + g.slice(1) + ' ' + s; };
const suit = (sp, T, P) => Math.exp(-(((T - sp.tOpt) / sp.tTol) ** 2) / 2) * Math.exp(-(Math.log(Math.max(1, P) / sp.pPref) ** 2) / (2 * .6 * .6));

/** Environment for a pressure: { dT } or { glacial: true }. */
export function environment(p, R, pressure = {}) {
  let dT = pressure.dT || 0, iceFrac = R.map(() => 0);
  if (pressure.glacial) { const g = p.glaciation; dT -= g.stats.globalCoolingK; iceFrac = R.map(r => r.cells.filter(c => g.cell[c] === GLACIAL_CELL.ice).length / r.n); }
  return R.map((r, k) => ({ T: r.T + dT, P: r.P, cap: iceFrac[k] > .5 ? 0 : npp(r.T + dT, r.P) / 1000 * r.n * 10 }));
}
export function newEcology(p, gameSeed = 0) {
  const R = regions(p), rand = gameRng(p.seed, 'ecology', gameSeed), env = environment(p, R), species = [];
  for (let s = 0; s < RULES.startSpecies; s++) {
    const sp = { id: s, name: nameFor(rand), parent: null, born: 0, extinct: null, tOpt: -8 + rand() * 36, tTol: 4 + rand() * 8, pPref: Math.exp(Math.log(200) + rand() * Math.log(12)), disp: .03 + rand() * .15, size: Math.round(Math.exp(rand() * 9)) / 10, split: 0 };
    let home = 0, best = -1; for (let t = 0; t < 30; t++) { const r = Math.floor(rand() * R.length), v = suit(sp, env[r].T, env[r].P) * env[r].cap; if (v > best) { best = v; home = r; } }
    sp.pop = R.map((_, r) => r === home ? 50 : 0); species.push(sp);
  }
  return { generation: 0, regions: R, species, events: species.map(sp => ({ generation: 0, type: 'origin', species: sp.name, text: `${sp.name} appears in the region at ${R[sp.pop.findIndex(x => x > 0)].lat}°, ${R[sp.pop.findIndex(x => x > 0)].lon}°.` })), pressure: {} };
}
function components(R, occ) { const seen = new Set(), out = []; for (let r = 0; r < R.length; r++) { if (!occ[r] || seen.has(r)) continue; const c = [r]; seen.add(r); for (let h = 0; h < c.length; h++) for (const j of R[c[h]].nb) if (occ[j] && !seen.has(j)) { seen.add(j); c.push(j); } out.push(c); } return out; }

/** Advance one generation. Pure: returns a new state. */
export function stepEcology(p, eco, pressure = eco.pressure) {
  const R = eco.regions, env = environment(p, R, pressure), gen = eco.generation + 1, events = [];
  const alive = eco.species.filter(s => s.extinct === null);
  const species = eco.species.map(s => s.extinct !== null ? s : { ...s, pop: s.pop.slice() });
  const live = species.filter(s => s.extinct === null);
  for (const sp of live) {
    const K = R.map((_, r) => {
      let k = env[r].cap * suit(sp, env[r].T, env[r].P) * 100 / (1 + sp.size);
      for (const o of live) if (o !== sp && o.pop[r] > 0 && Math.abs(o.tOpt - sp.tOpt) < 3 && Math.abs(Math.log(o.pPref / sp.pPref)) < Math.log(1.6)) k *= 1 - RULES.competition;
      return k;
    });
    const next = sp.pop.map((n, r) => n <= 0 ? 0 : K[r] < 1 ? n * .5 : n + RULES.growth * n * (1 - n / K[r]));
    const moved = next.map(() => 0);
    for (let r = 0; r < R.length; r++) { if (next[r] <= 0 || !R[r].nb.length) continue; const out = next[r] * sp.disp; next[r] -= out; for (const j of R[r].nb) if (K[j] >= 1) moved[j] += out / R[r].nb.length; }
    sp.pop = next.map((n, r) => { const v = n + moved[r]; return v < 1 ? 0 : v; });
    // adaptation toward where the species lives
    let w = 0, t = 0, lp = 0; for (let r = 0; r < R.length; r++) if (sp.pop[r] > 0) { w += sp.pop[r]; t += sp.pop[r] * env[r].T; lp += sp.pop[r] * Math.log(env[r].P); }
    if (w > 0) { const shift = Math.max(-RULES.maxShift, Math.min(RULES.maxShift, RULES.adapt * (t / w - sp.tOpt))); sp.tOpt += shift; sp.pPref = Math.exp(Math.log(sp.pPref) + RULES.adapt * (lp / w - Math.log(sp.pPref))); }
    else { sp.extinct = gen; events.push({ generation: gen, type: 'extinction', species: sp.name, text: `${sp.name} went extinct${pressure.glacial ? ' under glacial conditions' : pressure.dT ? ` after a ${pressure.dT > 0 ? '+' : ''}${pressure.dT} °C shift` : ''}.` }); continue; }
    const peak = Math.max(...sp.pop), comps = components(R, sp.pop.map(n => n > RULES.coreShare * peak));
    sp.split = comps.length > 1 && comps.every(c => c.length >= RULES.minIsolatedRegions) ? sp.split + 1 : 0;
    if (sp.split >= RULES.isolationGenerations && species.length < RULES.maxSpecies) {
      const small = comps.sort((a, b) => a.length - b.length)[0], rand = gameRng(p.seed, 'speciation', `${sp.id}:${gen}`);
      let ww = 0, tt = 0; for (const r of small) { ww += sp.pop[r]; tt += sp.pop[r] * env[r].T; }
      const child = { ...sp, id: species.length, name: nameFor(rand), parent: sp.id, born: gen, extinct: null, tOpt: tt / ww, split: 0, pop: sp.pop.map((n, r) => small.includes(r) ? n : 0) };
      sp.pop = sp.pop.map((n, r) => small.includes(r) ? 0 : n); sp.split = 0; species.push(child);
      events.push({ generation: gen, type: 'speciation', species: child.name, parent: sp.name, text: `${child.name} split from ${sp.name} after ${RULES.isolationGenerations} generations of isolation.` });
    }
  }
  return { ...eco, generation: gen, species, events: [...eco.events, ...events], pressure, alive: species.filter(s => s.extinct === null).length, lastAlive: alive.length };
}
export function fieldGuide(eco) {
  return eco.species.map(s => ({ id: s.id, name: s.name, parent: s.parent === null ? null : eco.species[s.parent].name, status: s.extinct === null ? 'living' : 'extinct (generation ' + s.extinct + ')', tOpt: Math.round(s.tOpt * 10) / 10, tTol: Math.round(s.tTol * 10) / 10, rainPref: Math.round(s.pPref), dispersal: Math.round(s.disp * 100) / 100, size: s.size, regions: s.pop.filter(n => n > 0).length, population: Math.round(s.pop.reduce((a, b) => a + b, 0)) }));
}
/** Evolutionary tree as nested lines (root species first). */
export function tree(eco) { const kids = id => eco.species.filter(s => s.parent === id); const walk = (s, d) => [{ depth: d, name: s.name, extinct: s.extinct !== null, born: s.born }, ...kids(s.id).flatMap(c => walk(c, d + 1))]; return eco.species.filter(s => s.parent === null).flatMap(s => walk(s, 0)); }
