// PF-28 Seasons as Strategy. Overland expeditions whose speed and risk depend on terrain and on the model's monthly
// temperature and precipitation. All rules below are gameplay approximations, stated in RULES and shown to players.
import { shortestPath, stepKm, gameRng, monthName } from './core.js';

export const RULES = {
  paceKmDay: 25, forcedPace: 1.3, forcedRisk: 1.5, daysPerMonth: 30.4,
  text: [
    'Base pace 25 km/day over flat land; forced marches go 30 % faster at 50 % more risk.',
    'Slope slows travel: time × (1 + 25 × grade); land above 3,000 m adds +50 %.',
    'Month of travel (from the climate model at each cell): below −5 °C snow adds +80 %; above 150 mm of rain adds +30 % plus +20 % per extra 100 mm (mud, swollen streams); above 32 °C heat adds +30 %.',
    'Daily incident chance: cold below −15 °C 3 %, flooding above 250 mm 3 %, heat above 38 °C 2 %, altitude above 4,000 m 2 %. An incident costs two days of supplies or two days of delay.',
    'Each person eats one ration a day. Passing within one cell of a settlement restocks to the starting load.',
    'Only land is passable (no lakes, no sea).'
  ]
};
const monthIndex = (dep, days) => (dep + Math.floor(days / RULES.daysPerMonth)) % 12;
const passable = (p, i) => p.elevation[i] >= 0 && !p.hydro.lake[i];
function seasonFactor(p, i, m) {
  const T = p.climate.temperatureMonthly[12 * i + m], P = p.climate.precipitationMonthly[12 * i + m];
  return 1 + (T < -5 ? .8 : 0) + (P > 150 ? .3 + (P - 150) / 500 : 0) + (T > 32 ? .3 : 0);
}
function stepDays(p, a, b, m, forced) {
  const km = stepKm(p.mesh, a, b), grade = Math.abs(p.elevation[b] - p.elevation[a]) / (km * 1000);
  const terrain = (1 + 25 * grade) * (p.elevation[b] > 3000 ? 1.5 : 1);
  return km / (RULES.paceKmDay * (forced ? RULES.forcedPace : 1)) * terrain * seasonFactor(p, b, m);
}
export function dailyRisk(p, i, m) {
  const T = p.climate.temperatureMonthly[12 * i + m], P = p.climate.precipitationMonthly[12 * i + m], r = { cold: T < -15 ? .03 : 0, flood: P > 250 ? .03 : 0, heat: T > 38 ? .02 : 0, altitude: p.elevation[i] > 4000 ? .02 : 0 };
  return { ...r, total: r.cold + r.flood + r.heat + r.altitude };
}
/** Least-time land route for a departure month (costs evaluated in that month). */
export function planRoute(p, from, to, month, forced = false) {
  if (!passable(p, from) || !passable(p, to)) return null;
  return shortestPath(p.mesh, from, to, (a, b) => passable(p, b) ? stepDays(p, a, b, month, forced) : Infinity);
}
/**
 * Walk a route day by day: the month advances with elapsed days and costs/risks follow it. With `rand` incidents are
 * drawn; without it the expected values are returned (used for the forecast). Deterministic for a given rand stream.
 */
export function simulate(p, path, { month, party = 6, supplies = 300, forced = false, rand = null }) {
  const towns = new Set(); for (const s of p.settlements) { towns.add(s.cell); for (let e = p.mesh.offsets[s.cell]; e < p.mesh.offsets[s.cell + 1]; e++) towns.add(p.mesh.neighbors[e]); }
  let days = 0, food = supplies, incidents = [], expectedIncidents = 0, restocks = 0;
  for (let k = 1; k < path.length; k++) {
    const m = monthIndex(month, days), d = stepDays(p, path[k - 1], path[k], m, forced), risk = dailyRisk(p, path[k], m), pr = risk.total * (forced ? RULES.forcedRisk : 1) * d;
    days += d; food -= d * party; expectedIncidents += pr;
    if (rand && rand() < pr) {
      const kind = Object.entries(risk).filter(([k]) => k !== 'total').sort((a, b) => b[1] - a[1])[0][0];
      const delay = rand() < .5; if (delay) days += 2; else food -= 2 * party;
      incidents.push({ day: Math.round(days), cell: path[k], kind, effect: delay ? 'two days lost' : 'two days of rations lost' });
    }
    if (towns.has(path[k]) && food < supplies) { food = supplies; restocks++; }
    if (food < 0) return { arrived: false, days: Math.round(days), failedAt: path[k], suppliesLeft: 0, incidents, expectedIncidents, restocks, endMonth: monthName(monthIndex(month, days)) };
  }
  return { arrived: true, days: Math.round(days), suppliesLeft: Math.round(food), incidents, expectedIncidents: Math.round(expectedIncidents * 100) / 100, restocks, endMonth: monthName(monthIndex(month, days)) };
}
/** Twelve-month travel-window forecast: route length, expected days, expected incidents and rations needed. */
export function forecast(p, from, to, { party = 6, forced = false } = {}) {
  return Array.from({ length: 12 }, (_, m) => {
    const r = planRoute(p, from, to, m, forced);
    if (!r) return { month: m, name: monthName(m), possible: false };
    const s = simulate(p, r.path, { month: m, party, supplies: 1e9, forced });
    return { month: m, name: monthName(m), possible: true, km: Math.round(r.path.slice(1).reduce((a, c, k) => a + stepKm(p.mesh, r.path[k], c), 0)), days: s.days, expectedIncidents: s.expectedIncidents, rations: Math.ceil(s.days * party) };
  });
}
/** Run an expedition with the player's decisions; same inputs and seed → same outcome. */
export function runExpedition(p, { from, to, month, party = 6, supplies = 300, forced = false, seed = 0 }) {
  const r = planRoute(p, from, to, month, forced);
  if (!r) return { ok: false, reason: 'no land route between these places' };
  const out = simulate(p, r.path, { month, party, supplies, forced, rand: gameRng(p.seed, `expedition:${from}:${to}`, `${seed}:${month}:${party}:${supplies}:${forced}`) });
  return { ok: true, path: r.path, departure: monthName(month), ...out };
}
