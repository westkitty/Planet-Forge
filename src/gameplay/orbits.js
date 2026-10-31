// PF-26 Orbit Architect: coverage and missions for a small satellite fleet in circular Keplerian orbits.
// Coverage is evaluated on every 7th cell (≈ 14,300 cells, spacing ≈ 200 km) every 2 minutes over 24 hours.
import { subSatellite, footprintDeg, SAT_CLASSES, validateOrbit, maneuverDeltaV, LIMITS } from '../celestial.js';

const STEP_S = 120, SPAN_S = 86400, STRIDE = 7;
export function coverage(p, fleet) {
  const P = p.mesh.positions, idx = []; for (let i = 0; i < p.cellCount; i += STRIDE) idx.push(i);
  const seen = new Uint16Array(idx.length), visits = p.settlements.map(() => 0), lastVisit = p.settlements.map(() => -1e9);
  for (const o of fleet) {
    const cosR = Math.cos(footprintDeg(o.altKm, SAT_CLASSES[o.cls].minElevationDeg) * Math.PI / 180);
    for (let t = 0; t < SPAN_S; t += STEP_S) {
      const d = subSatellite(o, t);
      for (let k = 0; k < idx.length; k++) { const i = idx[k]; if (P[3 * i] * d[0] + P[3 * i + 1] * d[1] + P[3 * i + 2] * d[2] >= cosR && seen[k] < 65535) seen[k]++; }
      p.settlements.forEach((s, k) => { const c = s.cell; if (P[3 * c] * d[0] + P[3 * c + 1] * d[1] + P[3 * c + 2] * d[2] >= cosR && t - lastVisit[k] > 1800) { visits[k]++; lastVisit[k] = t; } });
    }
  }
  let land = 0, landSeen = 0, polar = 0, polarSeen = 0, all = 0; const cells = [];
  idx.forEach((i, k) => { if (seen[k]) { all++; cells.push(i); } if (p.elevation[i] >= 0) { land++; if (seen[k]) landSeen++; } if (Math.abs(p.lat[i]) > 60) { polar++; if (seen[k]) polarSeen++; } });
  return { cells, surface: all / idx.length, land: land ? landSeen / land : 0, polar: polar ? polarSeen / polar : 0, settlementPasses: visits, sampledCells: idx.length, stepS: STEP_S };
}
export const MISSIONS = {
  polar: { title: 'Map the polar caps', goal: '≥ 80 % of land and sea poleward of 60° seen within 24 h', met: c => c.polar >= .8 },
  towns: { title: 'Watch every settlement', goal: 'each settlement overflown at least twice (passes ≥ 30 min apart) within 24 h', met: c => c.settlementPasses.every(v => v >= 2) },
  land: { title: 'Survey the continents', goal: '≥ 60 % of land seen within 24 h', met: c => c.land >= .6 }
};
/** Add a satellite (validated) or apply a manoeuvre against its remaining Δv budget. */
export function launch(fleet, o) { const e = validateOrbit(o); if (e) return { fleet, error: e }; if (fleet.length >= 6) return { fleet, error: 'fleet limit is six satellites' }; return { fleet: [...fleet, { ...o, id: fleet.length ? Math.max(...fleet.map(f => f.id)) + 1 : 0, dvUsed: 0 }] }; }
export function maneuver(fleet, id, to) {
  const k = fleet.findIndex(f => f.id === id); if (k < 0) return { fleet, error: 'unknown satellite' };
  const from = fleet[k], next = { ...from, ...to }, e = validateOrbit(next); if (e) return { fleet, error: e };
  const dv = maneuverDeltaV(from, next); if (from.dvUsed + dv > LIMITS.deltaVBudgetKms) return { fleet, error: `needs ${dv.toFixed(2)} km/s; only ${(LIMITS.deltaVBudgetKms - from.dvUsed).toFixed(2)} km/s left` };
  const f = fleet.slice(); f[k] = { ...next, dvUsed: Math.round((from.dvUsed + dv) * 1000) / 1000 }; return { fleet: f, dv };
}
