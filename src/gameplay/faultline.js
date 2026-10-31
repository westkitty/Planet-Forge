// PF-18 Faultline Command. Disaster management for the generated settlements. Hazard exposure comes from modelled
// geography (plate boundaries, relief, river discharge); event FREQUENCIES and population figures are fictional
// gameplay values, declared in RULES. Nothing here predicts real-world hazards.
import { ringDistance, cellDir, angleBetween, EARTH_RADIUS_KM } from '../geo.js';
import { gameRng } from './core.js';

export const RULES = { turns: 8, budget: 12, population: 10000,
  costs: { reinforce: 3, levee: 2, evacuate: 1 },
  text: ['Exposure (from the world): earthquake = within 4 cells of a convergent or transform boundary; volcano = within 3 cells of a convergent boundary on land above 1,000 m; flood = on or beside a river carrying ≥ 2,000 m³/s.', 'Fictional yearly chances per exposed settlement: earthquake 18 %, eruption 8 %, flood 22 % (gameplay values, not forecasts).', 'Every settlement starts with 10,000 people (a gameplay figure; the world has no population model yet).', 'Budget 12 points: reinforce (3) cuts earthquake and eruption losses by 70 %; levee (2) cuts flood losses by 80 %; evacuate (1, one turn) removes 90 % of losses that turn but costs 5 % of the population in disruption.', 'Unprotected losses: earthquake 6 %, eruption 10 %, flood 4 % of the population.'],
  chance: { quake: .18, eruption: .08, flood: .22 }, loss: { quake: .06, eruption: .10, flood: .04 } };

export function exposure(p) {
  const fault = ringDistance(p.mesh, i => p.boundary[i] === 1 || p.boundary[i] === 3, 4), arc = ringDistance(p.mesh, i => p.boundary[i] === 1, 3);
  return p.settlements.map((s, k) => {
    let flood = p.hydro.discharge[s.cell] >= 2000;
    for (let e = p.mesh.offsets[s.cell]; e < p.mesh.offsets[s.cell + 1]; e++) { const j = p.mesh.neighbors[e]; if (p.elevation[j] >= 0 && p.hydro.discharge[j] >= 2000) flood = true; }
    let volcano = false; if (arc[s.cell] >= 0) { for (let i = 0; i < p.cellCount; i += 1) if (arc[i] >= 0 && arc[i] <= 3 && p.elevation[i] > 1000 && angleBetween(cellDir(p.mesh, i), cellDir(p.mesh, s.cell)) < 4 * p.spacingKm / EARTH_RADIUS_KM) { volcano = true; break; } }
    return { k, name: s.name, cell: s.cell, quake: fault[s.cell] >= 0, eruption: volcano, flood };
  });
}
export function newCampaign(p) { return { turn: 0, budget: RULES.budget, towns: exposure(p).map(e => ({ ...e, population: RULES.population, reinforced: false, levee: false, evacuated: false, lost: 0 })), log: [], over: false }; }
export function forecastRisk(t) {
  const r = (h, prot) => t[h] ? RULES.chance[h] * RULES.loss[h] * (1 - prot) : 0;
  return Math.round(t.population * (r('quake', t.reinforced ? .7 : 0) + r('eruption', t.reinforced ? .7 : 0) + r('flood', t.levee ? .8 : 0)));
}
/** Spend budget on one town: 'reinforce' | 'levee' | 'evacuate'. */
export function act(c, k, action) {
  const t = c.towns[k], cost = RULES.costs[action];
  if (c.over) return { campaign: c, error: 'campaign over' };
  if (!t) return { campaign: c, error: 'unknown settlement' };
  if (c.budget < cost) return { campaign: c, error: 'not enough budget' };
  if ((action === 'reinforce' && t.reinforced) || (action === 'levee' && t.levee) || (action === 'evacuate' && t.evacuated)) return { campaign: c, error: 'already done' };
  if (action === 'levee' && !t.flood) return { campaign: c, error: `${t.name} has no flood exposure` };
  const towns = c.towns.slice(); towns[k] = { ...t, [action === 'reinforce' ? 'reinforced' : action === 'levee' ? 'levee' : 'evacuated']: true };
  return { campaign: { ...c, budget: c.budget - cost, towns, log: [...c.log, { turn: c.turn, text: `${action} at ${t.name} (−${cost})` }] } };
}
/** Advance a year: draw events at exposed towns, apply protections, record losses. Deterministic per seed and plan. */
export function advance(p, c, gameSeed = 0) {
  if (c.over) return c;
  const rand = gameRng(p.seed, 'faultline', `${gameSeed}:${c.turn}`), log = [...c.log], towns = c.towns.map(t => ({ ...t })), events = [];
  for (const t of towns) {
    for (const h of ['quake', 'eruption', 'flood']) {
      const roll = rand(); if (!t[h] || roll >= RULES.chance[h]) continue;
      let loss = RULES.loss[h] * (h === 'flood' ? (t.levee ? .2 : 1) : (t.reinforced ? .3 : 1));
      if (t.evacuated) loss *= .1;
      const dead = Math.round(t.population * loss); t.population -= dead; t.lost += dead;
      events.push({ cell: t.cell, kind: h, town: t.name, lost: dead });
      log.push({ turn: c.turn, text: `Year ${c.turn + 1}: ${h === 'quake' ? 'earthquake' : h} at ${t.name}, ${dead.toLocaleString('en-US')} people lost${t.evacuated ? ' (evacuated)' : ''}.`, cell: t.cell });
    }
    if (t.evacuated) { const cost = Math.round(t.population * .05); t.population -= cost; t.lost += cost; t.evacuated = false; }
  }
  const turn = c.turn + 1, over = turn >= RULES.turns, total = towns.reduce((s, t) => s + t.lost, 0);
  if (over) log.push({ turn, text: `Campaign ended: ${total.toLocaleString('en-US')} people lost across ${towns.length} settlements.` });
  return { ...c, turn, towns, log, over, lastEvents: events, totalLost: total };
}

/**
 * Catastrophe laboratory (separate from the campaign): an impact's crater and severe-damage radius from simple
 * declared scaling (crater ≈ 20 × impactor diameter; severe blast radius ≈ 2.2 × D^0.6 × crater^0.4 km for D in m —
 * illustrative, not Collins et al. 2005), with the settlements inside each zone.
 */
export function impactLab(p, cell, diameterM) {
  const craterKm = 20 * diameterM / 1000, blastKm = 2.2 * Math.pow(diameterM, .6) * Math.pow(craterKm, .4), here = cellDir(p.mesh, cell);
  const hits = p.settlements.map(s => ({ name: s.name, cell: s.cell, km: Math.round(angleBetween(here, cellDir(p.mesh, s.cell)) * EARTH_RADIUS_KM) })).filter(s => s.km <= blastKm).sort((a, b) => a.km - b.km);
  return { cell, diameterM, craterKm: Math.round(craterKm * 10) / 10, blastKm: Math.round(blastKm), ocean: p.elevation[cell] < 0, settlementsInBlast: hits, note: 'Illustrative scaling for gameplay; not a validated impact model.' };
}
