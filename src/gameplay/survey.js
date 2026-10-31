// PF-17 The Cartographer's Oath. An optional survey campaign: the planet starts unmapped, the player has a limited
// budget of probes and orbital passes, and each scan reveals cells deterministically. Coverage is never stored as a
// mask: it is reconstructed from the list of scans, so a save stays small and replays exactly. The free atlas is
// unaffected outside the mode.
import { ringDistance } from '../geo.js';
import { RIVER_MIN_M3S } from '../hydrology.js';

export const SURVEY = { probes: 14, probeRings: 12, passCost: 3, passHalfWidthDeg: 3 };

export function newSurvey() { return { budget: SURVEY.probes, scans: [], findings: [] }; }

/** Reconstruct the revealed-cell mask from the scan log. */
export function coverage(p, scans) {
  const mask = new Uint8Array(p.cellCount);
  for (const s of scans) {
    if (s.type === 'probe') { const d = ringDistance(p.mesh, i => i === s.cell, SURVEY.probeRings); for (let i = 0; i < p.cellCount; i++) if (d[i] >= 0) mask[i] = 1; }
    else if (s.type === 'pass') for (let i = 0; i < p.cellCount; i++) if (Math.abs(p.lat[i] - s.lat) <= SURVEY.passHalfWidthDeg) mask[i] = 1;
  }
  return mask;
}
/** Targets the campaign asks the player to find (each is one specific, deterministic cell set). */
export function objectives(p) {
  let peak = 0, deep = 0; for (let i = 1; i < p.cellCount; i++) { if (p.elevation[i] > p.elevation[peak]) peak = i; if (p.elevation[i] < p.elevation[deep]) deep = i; }
  const out = [{ id: 'peak', title: 'Chart the highest summit', cells: [peak] }, { id: 'trench', title: 'Sound the deepest trench', cells: [deep] }];
  const r = p.hydro.rivers[0]; if (r) out.push({ id: 'river', title: `Trace the mouth of the ${r.name}`, cells: [r.mouth] });
  const lake = p.hydro.lakes.filter(l => l.type === 1 && l.area >= 3).sort((a, b) => b.area - a.area)[0]; if (lake) out.push({ id: 'lake', title: 'Find the largest freshwater lake', cells: [lake.first] });
  if (p.settlements.length) out.push({ id: 'towns', title: 'Make contact with every settlement', cells: p.settlements.map(s => s.cell) });
  // each objective carries a coarse clue: the 20° latitude band it lies in
  return out.map(o => ({ ...o, clue: `between ${Math.floor(p.lat[o.cells[0]] / 20) * 20}° and ${Math.floor(p.lat[o.cells[0]] / 20) * 20 + 20}° latitude` }));
}
/** Geological findings revealed by a scan: notable cells newly inside the coverage. Deterministic order. */
function findingsFor(p, before, after) {
  const f = [];
  for (let i = 0; i < p.cellCount; i++) {
    if (!after[i] || before[i]) continue;
    if (p.boundary[i] === 1 && p.elevation[i] > 3000) f.push({ cell: i, kind: 'collision range', note: `${Math.round(p.elevation[i])} m on a convergent boundary` });
    else if (p.boundary[i] === 2 && p.elevation[i] < -3500 && p.seafloorAge[i] < 2) f.push({ cell: i, kind: 'spreading ridge', note: 'seafloor younger than 2 Myr' });
    else if (p.hydro.lake[i] === 2) f.push({ cell: i, kind: 'salt lake', note: 'closed basin evaporating its inflow' });
    else if (p.elevation[i] >= 0 && p.hydro.discharge[i] >= 50 * RIVER_MIN_M3S && p.hydro.receiver[i] >= 0 && p.elevation[p.hydro.receiver[i]] < 0) f.push({ cell: i, kind: 'great river mouth', note: `${Math.round(p.hydro.discharge[i]).toLocaleString('en-US')} m³/s` });
  }
  const seen = new Set(), out = []; // one finding per kind per scan keeps the journal readable
  for (const x of f) if (!seen.has(x.kind)) { seen.add(x.kind); out.push(x); }
  return out;
}
/** Spend survey resources. action = { type: 'probe', cell } | { type: 'pass', lat }. Returns { survey, error?, revealed, findings }. */
export function scan(p, survey, action) {
  const cost = action.type === 'pass' ? SURVEY.passCost : 1;
  if (survey.budget < cost) return { survey, error: 'not enough survey budget left' };
  if (action.type === 'probe' && !(action.cell >= 0 && action.cell < p.cellCount)) return { survey, error: 'select a place to probe' };
  if (action.type === 'pass' && !(Math.abs(action.lat) <= 90)) return { survey, error: 'invalid latitude' };
  const before = coverage(p, survey.scans), scans = [...survey.scans, action.type === 'pass' ? { type: 'pass', lat: Math.round(action.lat * 10) / 10 } : { type: 'probe', cell: action.cell }];
  const after = coverage(p, scans), found = findingsFor(p, before, after);
  let revealed = 0; for (let i = 0; i < p.cellCount; i++) if (after[i] && !before[i]) revealed++;
  return { survey: { budget: survey.budget - cost, scans, findings: [...survey.findings, ...found] }, revealed, findings: found };
}
export function progress(p, survey) {
  const mask = coverage(p, survey.scans); let land = 0, seenLand = 0, seen = 0;
  for (let i = 0; i < p.cellCount; i++) { if (mask[i]) seen++; if (p.elevation[i] >= 0) { land++; if (mask[i]) seenLand++; } }
  const obj = objectives(p).map(o => ({ ...o, done: o.cells.every(c => mask[c]) }));
  return { mask, mapped: seen / p.cellCount, landMapped: land ? seenLand / land : 0, objectives: obj, complete: obj.every(o => o.done), outOfBudget: survey.budget <= 0 };
}
