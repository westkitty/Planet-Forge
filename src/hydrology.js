// Planet Forge hydrology (part of world model hydro-0.4).
//
// Conceptual approximation, not a hydrodynamic model. It chains:
//   1. monthly potential evapotranspiration (Thornthwaite 1948, Willmott et al. 1985 hot-month branch) from the
//      climate model's monthly temperature and day length;
//   2. long-term annual actual evapotranspiration and runoff from the Budyko framework in Fu's (1981) form
//      (Zhang et al. 2004), w = 2.6;
//   3. depression filling and drainage directions by Priority-Flood (Barnes, Lehman & Mulla 2014) seeded from the
//      coast, with steepest descent (O'Callaghan & Mark 1984, D8 generalised to the geodesic mesh) wherever a
//      lower neighbour exists;
//   4. flow accumulation of runoff to river discharge (m^3/s), in reverse flood order;
//   5. lakes in filled depressions with a closed water balance: inflow + rain on the lake versus open-water
//      evaporation (≈ PET). A lake whose evaporation exceeds its inflow does not overflow: it becomes a terminal
//      (endorheic) salt lake that shrinks to the area its inflow can sustain, leaving a salt flat around it,
//      and its whole catchment becomes an endorheic basin;
//   6. drainage basins, river names, main-stem lengths (Hack 1957 style: follow the largest tributary upstream).
// Assumptions and sources: docs/features/F-0004-hydrology.md.
import { declination } from './climate.js';

export const FU_W = 2.6;               // Fu-equation shape parameter (Zhang et al. 2004 global fit, ~2.6)
export const RIVER_MIN_M3S = 150;      // discharge above which a cell is drawn as a river
export const LAKE = { none: 0, fresh: 1, salt: 2, saltFlat: 3 };
const MM_KM2_YR_TO_M3S = 1000 / (365.25 * 86400); // 1 mm over 1 km^2 per year in m^3/s

/** Mean daylight hours for latitude phi (rad) and declination d (rad). */
function dayLength(phi, d) { const x = -Math.tan(phi) * Math.tan(d); return x >= 1 ? 0 : x <= -1 ? 24 : 24 * Math.acos(x) / Math.PI; }

/** Thornthwaite monthly PET (mm) for 12 monthly mean temperatures (°C) at latitude phi (rad), axial tilt in degrees. */
export function thornthwaitePET(temps, phi, tiltDeg) {
  let I = 0; for (let m = 0; m < 12; m++) if (temps[m] > 0) I += (temps[m] / 5) ** 1.514;
  const a = 6.75e-7 * I ** 3 - 7.71e-5 * I ** 2 + 1.792e-2 * I + 0.49239;
  let total = 0;
  for (let m = 0; m < 12; m++) {
    const T = temps[m]; if (T <= 0 || I <= 0) continue;
    const base = T >= 26.5 ? -415.85 + 32.24 * T - 0.43 * T * T : 16 * (10 * T / I) ** a; // mm per 30-day month of 12 h days
    total += Math.max(0, base) * (dayLength(phi, declination(tiltDeg, m)) / 12) * (30.44 / 30);
  }
  return total;
}
/** Fu (1981) Budyko curve: actual evapotranspiration (mm) from precipitation P and PET (mm). */
export function fuAET(P, PET, w = FU_W) { if (P <= 0) return 0; if (PET <= 0) return 0; const r = PET / P; return P * (1 + r - (1 + r ** w) ** (1 / w)); }

class Heap { // binary min-heap on (key, pushOrder) for deterministic ties
  constructor(cap) { this.k = new Float64Array(cap); this.t = new Float64Array(cap); this.v = new Int32Array(cap); this.n = 0; this.c = 0; }
  less(i, j) { return this.k[i] < this.k[j] || (this.k[i] === this.k[j] && this.t[i] < this.t[j]); }
  sw(i, j) { let a = this.k[i]; this.k[i] = this.k[j]; this.k[j] = a; a = this.t[i]; this.t[i] = this.t[j]; this.t[j] = a; const b = this.v[i]; this.v[i] = this.v[j]; this.v[j] = b; }
  push(key, val) { let i = this.n++; this.k[i] = key; this.t[i] = this.c++; this.v[i] = val; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.sw(i, p); i = p; } }
  pop() { const val = this.v[0]; this.n--; if (this.n > 0) { this.sw(0, this.n); let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.n && this.less(l, m)) m = l; if (r < this.n && this.less(r, m)) m = r; if (m === i) break; this.sw(i, m); i = m; } } return val; }
}

const SYL = ['ar', 'ven', 'tal', 'or', 'ush', 'mir', 'ka', 'dor', 'el', 'sa', 'rin', 'tho', 'va', 'lun', 'es', 'kor', 'an', 'ith', 'ra', 'nos', 'bel', 'yr', 'gal', 'ume'];
function riverName(h) { let s = ''; const k = 2 + (h % 2); for (let i = 0; i < k; i++) { s += SYL[(h >>> (3 + 5 * i)) % SYL.length]; } return s[0].toUpperCase() + s.slice(1); }

/**
 * ctx: { mesh, elevation, lat (deg), spacingKm, cellAreaKm2, climate (from computeClimate), tilt, seedHash }.
 */
export function computeHydrology(ctx) {
  const { mesh, elevation, lat, climate, tilt, spacingKm, cellAreaKm2 } = ctx;
  const { count: n, offsets: O, neighbors: N } = mesh;
  const land = i => elevation[i] >= 0;

  // 1-2. PET, AET, runoff (mm/yr) on land; lakes evaporate at PET.
  const pet = new Uint16Array(n), runoff = new Uint16Array(n), aet = new Uint16Array(n);
  const tm = new Float64Array(12);
  for (let i = 0; i < n; i++) {
    for (let m = 0; m < 12; m++) tm[m] = climate.temperatureMonthly[12 * i + m];
    const e = Math.round(thornthwaitePET(tm, lat[i] * Math.PI / 180, tilt)); pet[i] = Math.min(65535, e);
    if (!land(i)) continue;
    const P = climate.rainfall[i], a = Math.round(fuAET(P, e)); aet[i] = a; runoff[i] = Math.max(0, P - a);
  }

  // 3. Priority-Flood from the coast. order = pop order (receivers always popped first).
  const filled = new Float64Array(n), receiver = new Int32Array(n).fill(-1), order = new Int32Array(n), rank = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n), heap = new Heap(n + 8); let oc = 0;
  for (let i = 0; i < n; i++) if (!land(i)) { seen[i] = 1; for (let e = O[i]; e < O[i + 1]; e++) if (land(N[e])) { const j = N[e]; if (!seen[j]) { seen[j] = 1; filled[j] = elevation[j]; receiver[j] = i; heap.push(filled[j], j); } } }
  while (heap.n) {
    const i = heap.pop(); rank[i] = oc; order[oc++] = i;
    for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (seen[j]) continue; seen[j] = 1; filled[j] = Math.max(elevation[j], filled[i]); receiver[j] = i; heap.push(filled[j], j); }
  }
  const landCount = oc;
  // Steepest descent on the filled surface where a strictly lower neighbour exists (it is always popped earlier).
  const P = mesh.positions;
  for (let k = 0; k < landCount; k++) {
    const i = order[k]; if (filled[i] > elevation[i]) continue; // inside a depression: keep the flood route
    let best = -1, bs = 0;
    for (let e = O[i]; e < O[i + 1]; e++) {
      const j = N[e], hj = land(j) ? filled[j] : 0; // sea surface is 0 m
      const dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2];
      const s = (filled[i] - hj) / Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (hj < filled[i] && s > bs) { bs = s; best = j; }
    }
    if (best >= 0) receiver[i] = best;
  }

  // 5a. Lakes: connected components of flooded cells.
  const lakeId = new Int32Array(n).fill(-1), lakes = [];
  for (let k = 0; k < landCount; k++) {
    const s = order[k]; if (lakeId[s] >= 0 || filled[s] <= elevation[s]) continue;
    const id = lakes.length, cells = [s]; lakeId[s] = id;
    for (let q = 0; q < cells.length; q++) { const i = cells[q]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (lakeId[j] < 0 && land(j) && filled[j] > elevation[j]) { lakeId[j] = id; cells.push(j); } } }
    let first = cells[0]; for (const c of cells) if (rank[c] < rank[first]) first = c;
    lakes.push({ id, cells, first, level: filled[first], inflow: 0, evaporation: 0, outflow: 0, type: 'fresh', wetCells: cells.length });
  }

  // 4 + 5b. Accumulate discharge (m^3/s) upstream-first; finalise each lake at its first-popped cell.
  const Q = new Float64Array(n), lakeIn = new Float64Array(lakes.length);
  for (let k = landCount - 1; k >= 0; k--) {
    const i = order[k], L = lakeId[i];
    if (L >= 0) {
      lakeIn[L] += (Q[i] + climate.rainfall[i] * cellAreaKm2 * MM_KM2_YR_TO_M3S); Q[i] = 0;
      lakes[L].evaporation += pet[i] * cellAreaKm2 * MM_KM2_YR_TO_M3S;
      if (i !== lakes[L].first) continue;
      const lake = lakes[L]; lake.inflow = lakeIn[L];
      lake.outflow = Math.max(0, lake.inflow - lake.evaporation);
      Q[i] = lake.outflow;
      if (lake.outflow <= 0) {
        lake.type = 'salt';
        // the terminal lake shrinks until evaporation from its surface balances inflow (deepest cells stay wet)
        const frac = lake.evaporation > 0 ? lake.inflow / lake.evaporation : 1;
        lake.wetCells = Math.max(1, Math.min(lake.cells.length, Math.round(frac * lake.cells.length)));
      }
    } else Q[i] += runoff[i] * cellAreaKm2 * MM_KM2_YR_TO_M3S;
    const r = receiver[i];
    if (r >= 0 && land(r)) { if (lakeId[r] >= 0 && lakeId[r] !== L) Q[r] += Q[i]; else if (L < 0 || i === lakes[L].first) Q[r] += Q[i]; }
  }
  // For display, lake cells carry the lake's throughput.
  const lake = new Uint8Array(n), discharge = new Float32Array(n);
  for (const l of lakes) {
    const sorted = l.cells.slice().sort((a, b) => elevation[a] - elevation[b] || a - b);
    sorted.forEach((c, q) => { lake[c] = l.type === 'fresh' ? LAKE.fresh : q < l.wetCells ? LAKE.salt : LAKE.saltFlat; });
    l.area = l.cells.length; l.inflow = +l.inflow.toFixed(1); l.evaporation = +l.evaporation.toFixed(1); l.outflow = +l.outflow.toFixed(1);
  }
  for (let i = 0; i < n; i++) discharge[i] = land(i) ? (lakeId[i] >= 0 ? lakes[lakeId[i]].inflow : Q[i]) : 0;

  // 6. Basins (forward pass: receivers first). Mouth = land cell draining to the sea, or a terminal lake.
  const basin = new Int32Array(n).fill(-1), basins = [], flowLen = new Float32Array(n);
  for (let k = 0; k < landCount; k++) {
    const i = order[k], L = lakeId[i], r = receiver[i];
    if (L >= 0 && i !== lakes[L].first) { basin[i] = basin[lakes[L].first]; flowLen[i] = flowLen[lakes[L].first]; continue; }
    if (L >= 0 && lakes[L].type === 'salt') { basin[i] = basins.length; basins.push({ id: basin[i], mouth: i, endorheic: true, lake: L, cells: 0 }); continue; }
    if (r < 0 || !land(r)) { basin[i] = basins.length; basins.push({ id: basin[i], mouth: i, endorheic: false, lake: -1, cells: 0 }); continue; }
    basin[i] = basin[r]; flowLen[i] = flowLen[r] + spacingKm;
  }
  for (let i = 0; i < n; i++) if (basin[i] >= 0) basins[basin[i]].cells++;

  // Rivers: name the largest basins and measure their main stem by following the largest tributary upstream.
  const donors = new Int32Array(n).fill(-1), nextDonor = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) { const r = receiver[i]; if (r >= 0 && land(r) && land(i)) { nextDonor[i] = donors[r]; donors[r] = i; } }
  const mouthQ = b => b.endorheic ? lakes[b.lake].inflow : discharge[b.mouth];
  const ranked = basins.filter(b => b.cells >= 20).sort((a, b) => mouthQ(b) - mouthQ(a) || a.mouth - b.mouth).slice(0, 12);
  const rivers = ranked.map((b, idx) => {
    let cur = b.mouth, len = 0, steps = 0; const path = [cur];
    for (;;) {
      let best = -1, bq = -1;
      for (let d = donors[cur]; d >= 0; d = nextDonor[d]) if (discharge[d] > bq) { bq = discharge[d]; best = d; }
      if (best < 0 || bq < RIVER_MIN_M3S / 15 || ++steps > 5000) break;
      cur = best; path.push(cur); len += spacingKm;
    }
    const name = riverName((ctx.seedHash ^ Math.imul(b.mouth + 1, 2654435761)) >>> 0);
    return { rank: idx + 1, name: b.endorheic ? 'Lake ' + name : name + ' River', mouth: b.mouth, source: cur, lengthKm: Math.round(len), dischargeM3s: Math.round(mouthQ(b)), basinKm2: Math.round(b.cells * cellAreaKm2), endorheic: b.endorheic, path };
  });
  let riverCells = 0, endoCells = 0, landN = 0, runoffSum = 0, precipSum = 0, freshLakes = 0, saltLakes = 0;
  for (let i = 0; i < n; i++) if (land(i)) { landN++; runoffSum += runoff[i]; precipSum += climate.rainfall[i]; if (discharge[i] >= RIVER_MIN_M3S && lakeId[i] < 0) riverCells++; if (basins[basin[i]].endorheic) endoCells++; }
  for (const l of lakes) { if (l.cells.length < 3) continue; if (l.type === 'fresh') freshLakes++; else saltLakes++; }
  // Water balance check: total runoff + lake-surface rain = sea outflow + net lake evaporation (numerical identity).
  let toSea = 0; for (const b of basins) if (!b.endorheic) toSea += discharge[b.mouth];
  const stats = { riverCells, landCells: landN, endorheicFraction: landN ? endoCells / landN : 0, runoffRatio: precipSum ? runoffSum / precipSum : 0, freshLakes, saltLakes, toSeaM3s: Math.round(toSea) };
  return { pet, aet, runoff, filled, receiver, order, landCount, discharge, lake, lakeId, lakes, basin, basins, rivers, flowLength: flowLen, stats };
}
