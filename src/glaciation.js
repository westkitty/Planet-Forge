// Planet Forge glaciation (part of world model glacial-0.6).
//
// Conceptual approximation of a glacial maximum, not an ice-sheet model. It chains:
//   1. orbital forcing: the planet's own zonal energy-balance model (climate.js) re-solved at its seeded obliquity
//      minimum (tilt − δ, δ seeded 1.0–2.5°; Earth ≈ 1.2°, Berger 1978), giving a monthly temperature change per
//      latitude row that already includes the EBM's sea-ice/snow albedo feedback;
//   2. glacial greenhouse forcing: CO2 at 190 ppm vs 280 ppm, ΔF = 5.35 ln(C/C0) ≈ −2.1 W m^-2 (Myhre et al. 1998),
//      spread through the same EBM (global mean ΔF / B);
//   3. surface mass balance on every land cell from monthly temperature and precipitation: snowfall where the
//      monthly temperature (normally distributed, σ = 5 K) is below 1 °C, melt from positive degree days with
//      degree-day factors 3 (snow) and 8 (ice) mm w.e. K^-1 d^-1 (Reeh 1991; Braithwaite 1995); glacial
//      precipitation scaled by Clausius–Clapeyron, ≈7 % per K (Held & Soden 2006);
//   4. ice sheets = land with positive mass balance evaluated at the ice surface (height–mass-balance feedback); thickness from the perfect-plastic (Nye 1952 / Vialov)
//      profile H = sqrt(2 τ0 d / (ρi g)), τ0 = 100 kPa, d = distance to the ice margin (Paterson 1994);
//   5. ice-sheet albedo feedback: the zonal ice-covered fraction raises albedo to 0.62 on those rows; the extra
//      absorbed-sunlight loss is fed back through the EBM (local + transport-to-mean terms), and steps 3–6
//      iterate to a fixed point;
//   6. eustatic sea-level fall = (glacial − present ice volume) · ρi/ρw / ocean area; continental shelves above
//      the lowered sea become land; exposed shelf that joins two present landmasses is a land bridge.
// Assumptions and sources: docs/features/F-0005-glaciation.md.
import { zonalEnergyBalance, OLR_B, TRANSPORT, LAPSE } from './climate.js';

export const GLACIAL = { co2Ratio: 190 / 280, sigma: 5, ddfSnow: 3, ddfIce: 8, tau0: 1e5, rhoIce: 917, rhoWater: 1028, g: 9.81, iceAlbedo: 0.62, cc: 0.07, otherGhgWm2: -0.7, sensitivity: 0.8, iterations: 12, presentIterations: 4, landmassMinCells: 40 };
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
  const now = climate.ebm, cold = zonalEnergyBalance(minTilt), R = now.rows;
  const rowOf = l => Math.min(R - 1, Math.max(0, Math.round((l + 90) * 2)));
  const w = new Float64Array(R); let wsum = 0; for (let k = 0; k < R; k++) { w[k] = Math.max(1e-6, Math.cos((-90 + 0.5 * k) * Math.PI / 180)); wsum += w[k]; }
  const dF = 5.35 * Math.log(GLACIAL.co2Ratio) + GLACIAL.otherGhgWm2, dTco2 = dF * GLACIAL.sensitivity;
  const orbital = new Float64Array(R * 12); // monthly ΔT per row from obliquity minimum
  for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) orbital[k * 12 + m] = (cold.Tann[k] + cold.seasonal.zonal[k * 12 + m]) - (now.Tann[k] + now.seasonal.zonal[k * 12 + m]); // glacial-0.6: damped seasonal response (season-0.5)
  const oceanArea0 = (() => { let c = 0; for (let i = 0; i < n; i++) if (elevation[i] < 0) c++; return c * cellAreaKm2; })();
  const tm = new Float64Array(12), pm = new Float64Array(12);

  const warmest = new Float32Array(n);
  for (let i = 0; i < n; i++) { let w = -1e9; for (let m = 0; m < 12; m++) w = Math.max(w, climate.temperatureMonthly[12 * i + m]); warmest[i] = w; }
  const marginLift = nyeThickness(0.25 * spacingKm); // surface of an advancing ice margin (m)
  // prev: thickness from the previous iteration (height–mass-balance feedback, Weertman 1961 / Oerlemans 1981):
  // ice cells are evaluated at their ice-surface elevation, cells next to ice at a thin advancing margin, so a
  // sheet can advance at most one cell (~70 km) per iteration.
  function iceSheets(dTrow, seaLevel, prev) {
    const balance = new Float32Array(n), ice = new Uint8Array(n);
    let dTmin = 0; if (dTrow) for (let k = 0; k < dTrow.length; k++) dTmin = Math.min(dTmin, dTrow[k]);
    for (let i = 0; i < n; i++) {
      if (elevation[i] < seaLevel) continue;
      let lift = 0;
      if (prev) { if (prev[i] > 0) lift = prev[i]; else for (let e = O[i]; e < O[i + 1]; e++) if (prev[N[e]] > 0) { lift = marginLift; break; } }
      const seaLift = elevation[i] < 0 ? 0 : -seaLevel; // land rises relative to the lowered sea; exposed shelf keeps its maritime temperature
      if (warmest[i] + dTmin - LAPSE * (lift + seaLift) > 14) { balance[i] = -9999; continue; } // too warm for any positive balance
      const k = rowOf(lat[i]);
      for (let m = 0; m < 12; m++) {
        const dT = dTrow ? dTrow[k * 12 + m] : 0;
        tm[m] = climate.temperatureMonthly[12 * i + m] + dT - LAPSE * (lift + seaLift);
        pm[m] = climate.precipitationMonthly[12 * i + m] * Math.exp(GLACIAL.cc * Math.min(0, dT));
      }
      balance[i] = massBalance(tm, pm); if (balance[i] > 0) ice[i] = 1;
    }
    // distance (km) to the ice margin, multi-source BFS from non-ice neighbours
    const dist = new Int32Array(n).fill(-1), q = new Int32Array(n); let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (ice[i]) { for (let e = O[i]; e < O[i + 1]; e++) if (!ice[N[e]]) { dist[i] = 0; q[qt++] = i; break; } }
    while (qh < qt) { const i = q[qh++]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (ice[j] && dist[j] < 0) { dist[j] = dist[i] + 1; q[qt++] = j; } } }
    const thick = new Float32Array(n); let vol = 0, cells = 0; // km^3
    for (let i = 0; i < n; i++) if (ice[i]) { thick[i] = Math.round(nyeThickness((Math.max(0, dist[i]) + 0.5) * spacingKm)); vol += thick[i] / 1000 * cellAreaKm2; cells++; }
    return { balance, ice, thick, vol, cells };
  }

  // present-day ice in equilibrium with today's climate (same height feedback, iterated)
  let present = iceSheets(null, 0, null);
  for (let it = 0; it < GLACIAL.presentIterations; it++) present = iceSheets(null, 0, present.thick);
  let seaLevel = 0, dTrow = new Float64Array(R * 12), glacial = null, history = [];
  const albedoRow = new Float64Array(R);
  for (let it = 0; it < GLACIAL.iterations; it++) {
    // ΔT per row/month = orbital + CO2 + ice-sheet albedo (linear EBM response: local and transport-to-mean terms)
    let dQmean = 0; for (let k = 0; k < R; k++) dQmean += w[k] * albedoRow[k]; dQmean /= wsum;
    const dTmean = dTco2 - dQmean * GLACIAL.sensitivity;
    for (let k = 0; k < R; k++) {
      const dTalb = (-albedoRow[k] + TRANSPORT * (dTmean - dTco2)) / (OLR_B + TRANSPORT);
      for (let m = 0; m < 12; m++) dTrow[k * 12 + m] = orbital[k * 12 + m] + dTco2 + dTalb;
    }
    glacial = iceSheets(dTrow, seaLevel, glacial ? glacial.thick : present.thick);
    seaLevel = -Math.max(0, glacial.vol - present.vol) * GLACIAL.rhoIce / GLACIAL.rhoWater / oceanArea0 * 1000; // m
    // zonal ice fraction (all cells) → extra reflected sunlight, smoothed ±2°
    const iceN = new Float64Array(R), allN = new Float64Array(R);
    for (let i = 0; i < n; i++) { const k = rowOf(lat[i]); allN[k]++; if (glacial.ice[i] && !present.ice[i]) iceN[k]++; }
    for (let k = 0; k < R; k++) { let a = 0, b = 0; for (let d = -4; d <= 4; d++) { const j = k + d; if (j >= 0 && j < R) { a += iceN[j]; b += allN[j]; } } const f = b ? a / b : 0; albedoRow[k] = f * Math.max(0, GLACIAL.iceAlbedo - now.albedo[k]) * now.Qa[k]; }
    history.push({ iteration: it + 1, seaLevelM: Math.round(seaLevel * 10) / 10, iceCells: glacial.cells });
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
  const stats = {
    obliquityMinDeg: Math.round(minTilt * 100) / 100, obliquityDropDeg: Math.round(delta * 1000) / 1000, co2ForcingWm2: Math.round(dF * 100) / 100,
    globalCoolingK: Math.round(-dTmeanFinal * 100) / 100, seaLevelFallM: Math.round(-seaLevel * 10) / 10,
    presentIceVolumeKm3: Math.round(present.vol), glacialIceVolumeKm3: Math.round(glacial.vol),
    presentIceFraction: presentCells / n, glacialIceFraction: glacial.cells / n, exposedShelfKm2: Math.round(exposed * cellAreaKm2),
    majorLandmassesNow: majorNow, landmassesJoined: joined, landBridges: bridges.length, bridgeCells, iterations: history,
  };
  return { cell, thickness: glacial.thick, presentThickness: present.thick, balance: glacial.balance, presentBalance: present.balance, seaLevel, landmassNow: nowL.id, landmassGlacial: glL.id, bridges: bridges.map(b => ({ landmasses: b.landmasses, areaKm2: Math.round(b.cells * cellAreaKm2) })), stats };
}
