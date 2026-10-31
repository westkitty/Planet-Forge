// Planet Forge glaciation (world model glacial-0.8, F-0005). Computed on demand (planet.glaciation).
//
// Conceptual approximation of a last glacial maximum, not an ice-sheet model. It chains:
//   1. orbital forcing: the planet's zonal energy-balance model (climate.js) re-solved at its seeded obliquity
//      minimum (tilt − δ, δ seeded 1.0–2.5°; Earth's obliquity varies ≈ 22.1–24.5°, Berger 1978);
//   2. glacial forcing after Köhler et al. (2010): greenhouse gases (CO2 190 vs 280 ppm, 5.35 ln(C/C0), Myhre et al.
//      1998, plus −0.7 W m^-2 CH4/N2O), mineral dust −1.9, exposed-shelf albedo −0.6 (uniform), sea-ice/snow −2.1 (on
//      rows that freeze today), vegetation −1.1 (land at 40–80°). The EBM runs with its albedo frozen at today's
//      values, so its response is linear (ΔT = ΔF / B globally) and the albedo feedbacks are these explicit terms
//      plus the modelled ice sheets (row albedo raised to 0.62 over their area);
//   3. surface mass balance on every land cell from monthly temperature and precipitation: snowfall where the
//      monthly temperature (normally distributed, σ = 5 K) is below 1 °C, melt from positive degree days with
//      degree-day factors 3 (snow) and 8 (ice) mm w.e. K^-1 d^-1 (Reeh 1991; Braithwaite 1995; Calov & Greve 2005);
//      precipitation scaled by Clausius–Clapeyron, ≈ 7 % per K of surface cooling including the lapse-rate cooling
//      of the ice surface (Held & Soden 2006; the elevation-desert effect);
//   4. ice extent from a whole-sheet budget: accumulation cells are ice, a sheet spreads into its ablation ring only
//      while accumulation − ablation over the sheet stays ≥ 0 and the sheet has built its full profile, and a sheet
//      in deficit retreats; thickness from the perfect-plastic profile H = sqrt(2 τ0 d / (ρi g)), τ0 = 100 kPa
//      (Nye 1952; Paterson 1994), scaled down to the snow actually accumulated;
//   5. a 90,000-year build-up (glacial inception ≈ 116 ka to the LGM ≈ 26.5 ka) in 48 steps of 1,875 years; margins
//      move at most one cell (~70 km) per step. The step count is the model's calibrated parameter (see F-0005);
//   6. eustatic sea-level fall = (glacial − present ice volume) · ρi/ρw / ocean area; continental shelves above
//      the lowered sea become land; exposed shelf that joins two present landmasses is a land bridge; named ice
//      sheets and land bridges form the gazetteer.
// Assumptions and sources: docs/features/F-0005-glaciation.md.
import { zonalEnergyBalance, LAPSE } from './climate.js';
import { riverName } from './hydrology.js';

export const GLACIAL = { co2Ratio: 190 / 280, sigma: 5, ddfSnow: 3, ddfIce: 8, tau0: 1e5, rhoIce: 917, rhoWater: 1028, g: 9.81, iceAlbedo: 0.62, cc: 0.07, otherGhgWm2: -0.7, dustWm2: -1.9, vegetationWm2: -1.1, shelfWm2: -0.6, seaIceWm2: -2.1, buildupYears: 90000, iterations: 48, presentIterations: 4, landmassMinCells: 40 };
export const GLACIAL_CELL = { none: 0, ice: 1, shelf: 2, bridge: 3, presentIce: 4 };
const DAYS = 365.25 / 12;

// Standard normal pdf / cdf (Abramowitz & Stegun 26.2.17 for the cdf, |error| < 7.5e-8).
const phi = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
function Phi(x) { const t = 1 / (1 + 0.2316419 * Math.abs(x)); const p = phi(x) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))); return x >= 0 ? 1 - p : p; }
/** Expected positive degree days in a month of mean temperature T (°C) with daily σ (K) (Calov & Greve 2005). */
export function monthlyPDD(T, sigma = GLACIAL.sigma) { return DAYS * (sigma * phi(T / sigma) + T * Phi(T / sigma)); }
/** Annual surface mass balance (mm w.e.) from 12 monthly temperatures (°C) and precipitation (mm/month). */
export function massBalance(tMon, pMon) {
  let snow = 0, pdd = 0;
  for (let m = 0; m < 12; m++) { snow += pMon[m] * Phi((1 - tMon[m]) / GLACIAL.sigma); pdd += monthlyPDD(tMon[m]); }
  const snowMelt = Math.min(snow, GLACIAL.ddfSnow * pdd), rest = pdd - snowMelt / GLACIAL.ddfSnow;
  return snow - snowMelt - GLACIAL.ddfIce * rest;
}
/** Nye/Vialov perfect-plastic ice thickness (m) at distance dKm from the margin. */
export function nyeThickness(dKm) { return Math.sqrt(2 * GLACIAL.tau0 * dKm * 1000 / (GLACIAL.rhoIce * GLACIAL.g)); }

/** ctx: { mesh, elevation, lat, climate, tilt, spacingKm, cellAreaKm2, seedHash }. */
export function computeGlaciation(ctx) {
  const { mesh, elevation, lat, climate, tilt, spacingKm, cellAreaKm2, seedHash } = ctx;
  const { count: n, offsets: O, neighbors: N } = mesh;
  const delta = 1 + ((Math.imul(seedHash ^ 0x61ac1e5, 2654435761) >>> 0) % 1501) / 1000; // 1.000–2.500°
  const minTilt = Math.max(0, tilt - delta);
  const now = climate.ebm, R = now.rows;
  const rowOf = l => Math.min(R - 1, Math.max(0, Math.round((l + 90) * 2)));
  const w = new Float64Array(R); let wsum = 0; for (let k = 0; k < R; k++) { w[k] = Math.max(1e-6, Math.cos((-90 + 0.5 * k) * Math.PI / 180)); wsum += w[k]; }
  // Glacial forcing (W m^-2), Köhler et al. (2010) LGM decomposition. The EBM is run with its albedo frozen at today's
  // monthly values (linear response), so every albedo change enters as an explicit forcing: land ice from the modelled
  // ice sheets (iceRow below); greenhouse gases (CO2 by Myhre et al. 1998 plus CH4/N2O), mineral dust and exposed-shelf
  // albedo spread uniformly; sea-ice/snow expansion on the rows that already have a freezing month today; vegetation
  // (forest to steppe/tundra) on land at 40–80° latitude. Each regional term is scaled to its global-mean value.
  const dFghg = 5.35 * Math.log(GLACIAL.co2Ratio) + GLACIAL.otherGhgWm2, dFuniform = dFghg + GLACIAL.dustWm2 + GLACIAL.shelfWm2;
  const landRow = new Float64Array(R), cellsRow = new Float64Array(R);
  for (let i = 0; i < n; i++) { const k = rowOf(lat[i]); cellsRow[k]++; if (elevation[i] >= 0) landRow[k]++; }
  const seaIceW = new Float64Array(R), vegW = new Float64Array(R); let sW = 0, vW = 0;
  for (let k = 0; k < R; k++) {
    let freezing = false; for (let m = 0; m < 12; m++) if (now.Tann[k] + now.seasonal.zonal[k * 12 + m] < 0) freezing = true;
    const al = Math.abs(-90 + 0.5 * k), lf = cellsRow[k] ? landRow[k] / cellsRow[k] : 0;
    seaIceW[k] = freezing ? now.Qa[k] : 0; sW += w[k] * seaIceW[k];
    vegW[k] = al >= 40 && al <= 80 ? now.Qa[k] * lf : 0; vW += w[k] * vegW[k];
  }
  const forcingRow = new Float64Array(R);
  for (let k = 0; k < R; k++) forcingRow[k] = dFuniform + (sW ? GLACIAL.seaIceWm2 * seaIceW[k] * wsum / sW : 0) + (vW ? GLACIAL.vegetationWm2 * vegW[k] * wsum / vW : 0);
  const dF = dFuniform + (sW ? GLACIAL.seaIceWm2 : 0) + (vW ? GLACIAL.vegetationWm2 : 0);
  const fixedAlbedo = now.seasonal.monthlyAlbedo, base = zonalEnergyBalance(tilt, { albedo: fixedAlbedo });
  const nowT = new Float64Array(R * 12); for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) nowT[k * 12 + m] = base.Tann[k] + base.seasonal.zonal[k * 12 + m];
  const oceanArea0 = (() => { let c = 0; for (let i = 0; i < n; i++) if (elevation[i] < 0) c++; return c * cellAreaKm2; })();
  const tm = new Float64Array(12), pm = new Float64Array(12);

  const warmest = new Float32Array(n);
  for (let i = 0; i < n; i++) { let w = -1e9; for (let m = 0; m < 12; m++) w = Math.max(w, climate.temperatureMonthly[12 * i + m]); warmest[i] = w; }
  // Ice extent from a whole-sheet mass budget (glacial-0.8). Every land cell's surface mass balance is evaluated at its
  // surface: ice cells at bed + ice thickness from the previous iteration (height–mass-balance feedback, Weertman 1961;
  // Oerlemans 1981), other cells at the bed. Cells with positive balance are accumulation area and always ice. A
  // connected sheet may spread into adjacent ablation cells (least negative first) only while its total balance,
  // accumulation minus ablation summed over the sheet, stays ≥ 0, since ice flow carries the interior surplus to the
  // margin; a sheet in deficit loses its most negative margin cells. So the margin advances or retreats at most one
  // cell (~70 km) per iteration and stops where ablation uses up the accumulation (steady-state sheet, Paterson 1994).
  // Precipitation falls with the surface cooling, including the lapse-rate cooling of the ice surface
  // (Clausius–Clapeyron, ≈7 %/K): the elevation-desert effect that starves the interiors of large sheets.
  const isMargin = (ice, i) => { for (let e = O[i]; e < O[i + 1]; e++) if (!ice[N[e]]) return true; return false; };
  function iceSheets(dTrow, seaLevel, prev, dtYears = 0, prevFill = null) {
    const balance = new Float32Array(n), ice = new Uint8Array(n), cand = new Uint8Array(n);
    const dTmin = new Float64Array(R); // coldest monthly change per row, for the quick too-warm test
    if (dTrow) for (let k = 0; k < R; k++) { let v = 0; for (let m = 0; m < 12; m++) v = Math.min(v, dTrow[k * 12 + m]); dTmin[k] = v; }
    for (let i = 0; i < n; i++) {
      if (elevation[i] < seaLevel) continue;
      let ring = false; const lift = prev && prev[i] > 0 ? prev[i] : 0;
      if (prev && !lift) for (let e = O[i]; e < O[i + 1]; e++) if (prev[N[e]] > 0) { ring = true; break; }
      const seaLift = elevation[i] < 0 ? 0 : -seaLevel; // land rises relative to the lowered sea; exposed shelf keeps its maritime temperature
      const k = rowOf(lat[i]);
      if (!lift && !ring && warmest[i] + dTmin[k] - LAPSE * seaLift > 14) { balance[i] = -9999; continue; } // too warm for any positive balance
      for (let m = 0; m < 12; m++) {
        const dT = dTrow ? dTrow[k * 12 + m] : 0, cool = dT - LAPSE * lift;
        tm[m] = climate.temperatureMonthly[12 * i + m] + dT - LAPSE * (lift + seaLift);
        pm[m] = climate.precipitationMonthly[12 * i + m] * Math.exp(GLACIAL.cc * Math.min(0, cool));
      }
      balance[i] = massBalance(tm, pm);
      if (balance[i] > 0 || lift) cand[i] = 1; else if (ring) cand[i] = 2;
    }
    // sheets = connected components of accumulation cells and last iteration's ice; budget per sheet
    const comp = new Int32Array(n).fill(-1), q = new Int32Array(n); let nc = 0;
    for (let s = 0; s < n; s++) {
      if (cand[s] !== 1 || comp[s] >= 0) continue;
      let qh = 0, qt = 0, total = 0, full = !prevFill; q[qt++] = s; comp[s] = nc;
      while (qh < qt) { const i = q[qh++]; total += balance[i]; if (prevFill && prevFill[i] >= 0.999) full = true; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (cand[j] === 1 && comp[j] < 0) { comp[j] = nc; q[qt++] = j; } } }
      const members = q.slice(0, qt);
      for (const i of members) ice[i] = 1;
      if (total >= 0 && full) { // advance (a growing sheet first has to build up its full profile): ring cells, least negative first, while the sheet stays in balance
        const ring = []; for (const i of members) for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (cand[j] === 2 && !ice[j]) { ice[j] = 2; ring.push(j); } }
        ring.sort((x, y) => balance[y] - balance[x] || x - y);
        for (const j of ring) { if (total + balance[j] >= 0) { total += balance[j]; ice[j] = 1; } else ice[j] = 0; }
      } else if (total < 0) { // retreat: drop the most negative margin cells until the budget closes
        const edge = members.filter(i => balance[i] < 0 && isMargin(ice, i)).sort((x, y) => balance[x] - balance[y] || x - y);
        for (const i of edge) { if (total >= 0) break; total -= balance[i]; ice[i] = 0; }
      }
      nc++;
    }
    // distance (km) to the ice margin, multi-source BFS from non-ice neighbours
    const dist = new Int32Array(n).fill(-1); let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (ice[i]) { for (let e = O[i]; e < O[i + 1]; e++) if (!ice[N[e]]) { dist[i] = 0; q[qt++] = i; break; } }
    while (qh < qt) { const i = q[qh++]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (ice[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q[qt++] = j; } } }
    const thick = new Float32Array(n); let vol = 0, cells = 0; // km^3
    for (let i = 0; i < n; i++) if (ice[i]) thick[i] = nyeThickness((Math.max(0, dist[i]) + 0.5) * spacingKm);
    // Growth limited by the snow that has fallen (dtYears > 0): each sheet's volume is last step's ice under it plus
    // its net balance over dtYears; the Nye profile is scaled down until that volume is reached (never up).
    const fill = new Float32Array(n).fill(1);
    if (dtYears > 0) {
      const seen = new Uint8Array(n), kmIcePerMm = cellAreaKm2 / 1e6 * (1000 / GLACIAL.rhoIce) * dtYears; // mm w.e./yr → km³ ice per cell over dt
      for (let s0 = 0; s0 < n; s0++) {
        if (!ice[s0] || seen[s0]) continue;
        let qh2 = 0, qt2 = 0, vNye = 0, v = 0; q[qt2++] = s0; seen[s0] = 1;
        while (qh2 < qt2) { const i = q[qh2++]; vNye += thick[i] / 1000 * cellAreaKm2; v += (prev ? prev[i] : 0) / 1000 * cellAreaKm2 + balance[i] * kmIcePerMm; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (ice[j] && !seen[j]) { seen[j] = 1; q[qt2++] = j; } } }
        const f = v <= 0 ? 0 : Math.min(1, v / vNye);
        for (let t = 0; t < qt2; t++) { const i = q[t]; thick[i] *= f; fill[i] = f; if (f === 0) ice[i] = 0; }
      }
    }
    for (let i = 0; i < n; i++) if (ice[i]) { thick[i] = Math.max(1, Math.round(thick[i])); vol += thick[i] / 1000 * cellAreaKm2; cells++; } else thick[i] = 0;
    return { balance, ice, thick, vol, cells, fill };
  }

  // present-day ice in equilibrium with today's climate (same height feedback, iterated)
  let present = iceSheets(null, 0, null);
  for (let it = 0; it < GLACIAL.presentIterations; it++) present = iceSheets(null, 0, present.thick);
  let seaLevel = 0, dTrow = new Float64Array(R * 12), glacial = null, history = [];
  const iceRow = new Float64Array(R);
  for (let it = 0; it < GLACIAL.iterations; it++) {
    // ΔT per row/month: the EBM re-solved at the obliquity minimum with the prescribed forcing and the current
    // ice sheets, minus today's EBM. Snow/sea-ice albedo feedback and polar amplification emerge from the EBM.
    const cold = zonalEnergyBalance(minTilt, { forcing: forcingRow, iceRow, albedo: fixedAlbedo });
    for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) dTrow[k * 12 + m] = cold.Tann[k] + cold.seasonal.zonal[k * 12 + m] - nowT[k * 12 + m];
    glacial = iceSheets(dTrow, seaLevel, glacial ? glacial.thick : present.thick, GLACIAL.buildupYears / GLACIAL.iterations, glacial ? glacial.fill : null);
    seaLevel = -Math.max(0, glacial.vol - present.vol) * GLACIAL.rhoIce / GLACIAL.rhoWater / oceanArea0 * 1000; // m
    // zonal fraction of each row newly covered by ice sheets, smoothed ±2°
    const iceN = new Float64Array(R), allN = new Float64Array(R);
    for (let i = 0; i < n; i++) { const k = rowOf(lat[i]); allN[k]++; if (glacial.ice[i] && !present.ice[i]) iceN[k]++; }
    for (let k = 0; k < R; k++) { let a = 0, b = 0; for (let d = -4; d <= 4; d++) { const j = k + d; if (j >= 0 && j < R) { a += iceN[j]; b += allN[j]; } } iceRow[k] = b ? a / b : 0; }
    let cm = 0; for (let k = 0; k < R; k++) { let s2 = 0; for (let m = 0; m < 12; m++) s2 += dTrow[k * 12 + m]; cm += w[k] * s2 / 12; }
    history.push({ iteration: it + 1, seaLevelM: Math.round(seaLevel * 10) / 10, iceCells: glacial.cells, coolingK: Math.round(-cm / wsum * 100) / 100 });
  }
  let dTmeanFinal = 0; for (let k = 0; k < R; k++) { let s = 0; for (let m = 0; m < 12; m++) s += dTrow[k * 12 + m]; dTmeanFinal += w[k] * s / 12; } dTmeanFinal /= wsum;

  // Landmasses now and at the glacial maximum; exposed shelf; land bridges.
  const label = (isLand) => { const id = new Int32Array(n).fill(-1), sizes = []; const q = new Int32Array(n);
    for (let s = 0; s < n; s++) { if (!isLand(s) || id[s] >= 0) continue; const c = sizes.length; let qh = 0, qt = 0; q[qt++] = s; id[s] = c;
      while (qh < qt) { const i = q[qh++]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (id[j] < 0 && isLand(j)) { id[j] = c; q[qt++] = j; } } } sizes.push(qt); }
    return { id, sizes }; };
  const nowL = label(i => elevation[i] >= 0), glL = label(i => elevation[i] >= seaLevel);
  const major = c => nowL.sizes[c] >= GLACIAL.landmassMinCells;
  const majorsIn = new Map(); // glacial landmass -> set of major present landmasses
  for (let i = 0; i < n; i++) if (elevation[i] >= 0 && major(nowL.id[i])) { const g = glL.id[i]; if (!majorsIn.has(g)) majorsIn.set(g, new Set()); majorsIn.get(g).add(nowL.id[i]); }
  // exposed-shelf components: a bridge if it touches two or more major present landmasses
  const shelfL = label(i => elevation[i] < 0 && elevation[i] >= seaLevel), touch = shelfL.sizes.map(() => new Set());
  for (let i = 0; i < n; i++) { const s = shelfL.id[i]; if (s < 0) continue; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (elevation[j] >= 0 && major(nowL.id[j])) touch[s].add(nowL.id[j]); } }
  const cell = new Uint8Array(n); let exposed = 0, bridgeCells = 0;
  for (let i = 0; i < n; i++) {
    if (glacial.ice[i]) cell[i] = GLACIAL_CELL.ice;
    else if (elevation[i] < 0 && elevation[i] >= seaLevel) { exposed++; if (touch[shelfL.id[i]].size >= 2) { cell[i] = GLACIAL_CELL.bridge; bridgeCells++; } else cell[i] = GLACIAL_CELL.shelf; }
    if (elevation[i] < 0 && elevation[i] >= seaLevel && glacial.ice[i]) exposed++;
  }
  for (let i = 0; i < n; i++) if (present.ice[i] && !glacial.ice[i]) cell[i] = GLACIAL_CELL.presentIce;
  const bridges = touch.map((t, s) => ({ shelf: s, landmasses: [...t].sort((a, b) => a - b), cells: shelfL.sizes[s] })).filter(b => b.landmasses.length >= 2).sort((a, b) => b.cells - a.cells || a.shelf - b.shelf);
  const joined = [...majorsIn.values()].filter(s => s.size >= 2).length;
  const majorNow = nowL.sizes.filter(s => s >= GLACIAL.landmassMinCells).length;
  let presentCells = 0; for (let i = 0; i < n; i++) if (present.ice[i]) presentCells++;
  // Gazetteer: named ice sheets (connected glacial ice, largest first) and land bridges, with centroids.
  const P = mesh.positions, centroid = cells => { let x = 0, y = 0, z = 0; for (const i of cells) { x += P[3 * i]; y += P[3 * i + 1]; z += P[3 * i + 2]; } const l = Math.hypot(x, y, z) || 1;
    return { lat: Math.round(Math.asin(y / l) * 1800 / Math.PI) / 10, lon: Math.round(Math.atan2(z / l, x / l) * 1800 / Math.PI) / 10 }; };
  const nameOf = (i, salt) => riverName((seedHash ^ Math.imul(i + salt, 2654435761)) >>> 0);
  const sheetL = label(i => glacial.ice[i] === 1), sheetCells = sheetL.sizes.map(() => []);
  for (let i = 0; i < n; i++) if (sheetL.id[i] >= 0) sheetCells[sheetL.id[i]].push(i);
  const iceSheetList = sheetCells.map(cs => { let v = 0, mx = 0, pres = 0; for (const i of cs) { v += glacial.thick[i] / 1000 * cellAreaKm2; mx = Math.max(mx, glacial.thick[i]); if (present.ice[i]) pres++; }
    return { first: cs[0], cells: cs.length, areaKm2: Math.round(cs.length * cellAreaKm2), volumeKm3: Math.round(v), maxThicknessM: mx, survivesToday: pres > 0.5 * cs.length, ...centroid(cs) }; })
    .filter(x => x.areaKm2 >= 100000).sort((a, b) => b.areaKm2 - a.areaKm2 || a.first - b.first).slice(0, 8)
    .map(({ first, cells, ...x }) => ({ name: nameOf(first, 0x1ce) + ' Ice Sheet', ...x }));
  const shelfCells = shelfL.sizes.map(() => []); for (let i = 0; i < n; i++) if (shelfL.id[i] >= 0) shelfCells[shelfL.id[i]].push(i);
  const stats = {
    obliquityMinDeg: Math.round(minTilt * 100) / 100, obliquityDropDeg: Math.round(delta * 1000) / 1000, co2ForcingWm2: Math.round(dFghg * 100) / 100, prescribedForcingWm2: Math.round(dF * 100) / 100,
    globalCoolingK: Math.round(-dTmeanFinal * 100) / 100, seaLevelFallM: Math.round(-seaLevel * 10) / 10,
    presentIceVolumeKm3: Math.round(present.vol), glacialIceVolumeKm3: Math.round(glacial.vol),
    presentIceFraction: presentCells / n, glacialIceFraction: glacial.cells / n, exposedShelfKm2: Math.round(exposed * cellAreaKm2),
    majorLandmassesNow: majorNow, landmassesJoined: joined, landBridges: bridges.length, bridgeCells, iterations: history,
  };
  return { cell, thickness: glacial.thick, presentThickness: present.thick, balance: glacial.balance, presentBalance: present.balance, seaLevel, landmassNow: nowL.id, landmassGlacial: glL.id, bridges: bridges.map(b => ({ name: nameOf(shelfCells[b.shelf][0], 0xb41d) + ' Land Bridge', landmasses: b.landmasses, areaKm2: Math.round(b.cells * cellAreaKm2), ...centroid(shelfCells[b.shelf]) })), iceSheets: iceSheetList, stats };
}
