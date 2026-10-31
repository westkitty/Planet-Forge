// Planet Forge climate model (part of world model eddy-0.6; climate-0.3 with season-0.5 heat-capacity-damped seasons
// and eddy-0.6 diffusive poleward moisture transport).
//
// Conceptual approximation, not a general circulation model. It chains:
//   1. daily-mean top-of-atmosphere insolation for each month from axial tilt (circular orbit);
//   2. a zonal Budyko-Sellers / North energy-balance model (linear outgoing longwave, diffusive-to-mean heat
//      transport, temperature-dependent ice albedo) for annual-mean and seasonal temperature by latitude;
//   3. per-cell surface temperature: lapse rate, ocean/land heat-capacity damping, thermal lag, continentality;
//   4. a prescribed three-cell circulation (Hadley / Ferrel / polar) whose belts follow the seasonal ITCZ;
//   5. steady-state moisture advection on the 100k-cell mesh: ocean evaporation from Magnus saturation vapour
//      pressure, upwind transport, precipitation from ascent, orographic uplift and saturation, lee-side
//      suppression and land recycling, so rain shadows emerge downwind of the tectonic mountain belts, plus a
//      zonal-band eddy diffusion of moisture (eddy-0.6, F-0007);
//   6. Köppen-Geiger classification (Peel et al. 2007 rules) and Whittaker-inspired biomes.
// Assumptions, constants and sources: docs/features/F-0003-climate-circulation.md.

export const SOLAR_CONSTANT = 1361;            // W m^-2 (Kopp & Lean 2011)
export const OLR_A = 203.3, OLR_B = 2.09;            // W m^-2, W m^-2 K^-1 (North, Cahalan & Coakley 1981)
export const TRANSPORT = 3.81;                        // W m^-2 K^-1, Budyko-type transport toward global mean (North 1975)
export const LAPSE = 0.0065;                          // K m^-1 (ICAO standard atmosphere)
// Seasonal heat capacity (season-0.5, F-0006 seasonal damping). Annual harmonic angular frequency and heat capacities in
// J m^-2 K^-1: ocean = 50 m mixed layer (rho c_p h = 1025 x 3990 x 50, de Boyer Montegut et al. 2004 typical depth);
// land = atmospheric column (c_p p_s / g = 1004 x 1e5 / 9.81 = 1.0e7) plus the soil layer reached by the annual
// thermal wave (~1.5 m x 2e6 J m^-3 K^-1). Land is coupled to the zonal ocean anomaly by advected maritime air with an
// exchange coefficient that decays inland (e-folding MARITIME_KM), the "ocean heat transport to land" term.
export const OMEGA = 2 * Math.PI / (365.25 * 86400);
export const C_OCEAN = 1025 * 3990 * 50, C_LAND = 1.0e7 + 3.0e6;
export const MARITIME_K = 12, MARITIME_KM = 1000; // W m^-2 K^-1 at the coast; km
const HARMONICS = 3;
export const KOPPEN = ['Ocean', 'Af', 'Am', 'Aw', 'BWh', 'BWk', 'BSh', 'BSk', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc', 'Cfa', 'Cfb', 'Cfc', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'Dfa', 'Dfb', 'Dfc', 'Dfd', 'ET', 'EF'];
// Colours from the Köppen-Geiger legend of Peel, Finlayson & McMahon (2007).
export const KOPPEN_COLORS = { Ocean: '#175d83', Af: '#0000ff', Am: '#0078ff', Aw: '#46aafa', BWh: '#ff0000', BWk: '#ff9696', BSh: '#f5a500', BSk: '#ffdc64', Csa: '#ffff00', Csb: '#c8c800', Csc: '#969600', Cwa: '#96ff96', Cwb: '#64c864', Cwc: '#329632', Cfa: '#c8ff50', Cfb: '#64ff50', Cfc: '#32c800', Dsa: '#ff00ff', Dsb: '#c800c8', Dsc: '#963296', Dsd: '#966496', Dwa: '#aaafff', Dwb: '#5a78dc', Dwc: '#4b50b4', Dwd: '#320087', Dfa: '#00ffff', Dfb: '#37c8ff', Dfc: '#007d7d', Dfd: '#00465f', ET: '#b2b2b2', EF: '#666666' };
export const BIOMES = ['Ocean', 'Ice', 'Tundra', 'Boreal forest', 'Cold desert', 'Temperate grassland', 'Woodland / shrubland', 'Temperate seasonal forest', 'Temperate rainforest', 'Subtropical desert', 'Tropical seasonal forest / savanna', 'Tropical rainforest'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/** Solar declination (radians) at mid-month m (0 = January), circular orbit, vernal equinox on day 79. */
export function declination(tiltDeg, m) {
  const day = (m + 0.5) * 365 / 12, lambda = 2 * Math.PI * (day - 79) / 365;
  return Math.asin(Math.sin(tiltDeg * Math.PI / 180) * Math.sin(lambda));
}
/** Daily-mean top-of-atmosphere insolation (W m^-2) at latitude phi (rad) for declination d (rad). */
export function dailyInsolation(phi, d) {
  const x = -Math.tan(phi) * Math.tan(d);
  const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
  return SOLAR_CONSTANT / Math.PI * (h0 * Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.sin(h0));
}
/** Magnus-Tetens saturation vapour pressure (hPa) over water (T >= 0) or ice (T < 0); Murray (1967). */
export function satVapour(T) { return T >= 0 ? 6.1078 * Math.exp(17.27 * T / (T + 237.3)) : 6.1078 * Math.exp(21.875 * T / (T + 265.5)); }
// Surface-plus-cloud albedo of a zonal band for one month: 0.3 when snow- and ice-free, ramping to 0.62 as monthly
// temperature falls from 0 °C (snow and sea ice start to persist) to -10 °C (complete cover). climate-0.3 used the
// annual mean temperature from -2 to -18 °C instead, which let high latitudes stay dark for most of the year.
export const snowAlbedo = T => (T > SNOW_T0 ? 0.3 : T < SNOW_T1 ? 0.62 : 0.3 + 0.32 * (SNOW_T0 - T) / (SNOW_T0 - SNOW_T1));
const SNOW_T0 = 0, SNOW_T1 = -10, EBM_ITER = 30, ZONAL_LAND_KM = 500;

/** Zonal energy-balance model on 0.5° latitude rows. Returns annual temperature and monthly anomalies per row. */
// opts (glacial-0.8, F-0005; omitted for the interglacial climate, whose output is unchanged):
//   forcing: radiative forcing (W m^-2) added to the absorbed sunlight, one number or one value per row;
//   iceRow: per-row fraction covered by an ice sheet, whose surface albedo is at least ICE_SHEET_ALBEDO all year;
//   albedo: fixed monthly albedo per row (R x 12). The temperature-dependent snow/sea-ice albedo is then not updated,
//   the model is linear and one pass is exact.
export const ICE_SHEET_ALBEDO = 0.62;
export function zonalEnergyBalance(tiltDeg, opts = null) {
  const R = 361, Qm = new Float64Array(R * 12), Qa = new Float64Array(R), lat = new Float64Array(R), w = new Float64Array(R);
  const decl = Array.from({ length: 12 }, (_, m) => declination(tiltDeg, m));
  let wsum = 0;
  for (let k = 0; k < R; k++) {
    const phi = (-90 + 0.5 * k) * Math.PI / 180; lat[k] = phi; w[k] = Math.max(1e-6, Math.cos(phi)); wsum += w[k];
    for (let m = 0; m < 12; m++) { const q = Math.max(0, dailyInsolation(phi, decl[m])); Qm[k * 12 + m] = q; Qa[k] += q / 12; }
  }
  // Seasonal energy balance (season-0.5): albedo is evaluated per month from the month's zonal surface temperature
  // (snow and sea ice come and go with the seasons, North & Coakley 1979), absorbed sunlight is averaged over the year,
  // and the seasonal anomaly is the heat-capacity-damped response to the monthly absorbed-sunlight harmonics.
  const H = HARMONICS, Tann = new Float64Array(R).fill(15), albedo = new Float64Array(R), alM = new Float64Array(R * 12), Am = new Float64Array(R * 12), Aa = new Float64Array(R);
  const Fre = new Float64Array(R * H), Fim = new Float64Array(R * H), Ore = new Float64Array(R * H), Oim = new Float64Array(R * H), ocean = new Float64Array(R * 12), zonal = new Float64Array(R * 12);
  const ab = OLR_B + TRANSPORT, Kz = MARITIME_K * Math.exp(-ZONAL_LAND_KM / MARITIME_KM);
  for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) alM[k * 12 + m] = 0.3;
  let Tmean = 15; const forcingOpt = opts?.forcing ?? 0, iceRow = opts?.iceRow ?? null, fixedAlbedo = opts?.albedo ?? null;
  const forcingAt = typeof forcingOpt === 'number' ? () => forcingOpt : k => forcingOpt[k];
  if (fixedAlbedo) alM.set(fixedAlbedo);
  for (let it = 0; it < (fixedAlbedo ? 1 : EBM_ITER); it++) {
    let absorbed = 0;
    for (let k = 0; k < R; k++) {
      Aa[k] = 0; const fi = iceRow ? iceRow[k] : 0, forcing = forcingAt(k);
      for (let m = 0; m < 12; m++) { const a = alM[k * 12 + m], ae = fi > 0 && a < ICE_SHEET_ALBEDO ? a + fi * (ICE_SHEET_ALBEDO - a) : a; const v = Qm[k * 12 + m] * (1 - ae) + forcing; Am[k * 12 + m] = v; Aa[k] += v / 12; }
      absorbed += w[k] * Aa[k];
    }
    Tmean = (absorbed / wsum - OLR_A) / OLR_B; // global balance: transport sums to zero
    for (let k = 0; k < R; k++) {
      Tann[k] = (Aa[k] - OLR_A + TRANSPORT * Tmean) / ab;
      for (let m = 0; m < 12; m++) { ocean[k * 12 + m] = 0; zonal[k * 12 + m] = 0; }
      for (let h = 1; h <= H; h++) {
        let re = 0, im = 0;
        for (let m = 0; m < 12; m++) { const f = Am[k * 12 + m] - Aa[k], th = 2 * Math.PI * h * (m + 0.5) / 12; re += f * Math.cos(th) * 2 / 12; im += f * Math.sin(th) * 2 / 12; }
        const j = k * H + h - 1; Fre[j] = re; Fim[j] = im;
        // Harmonic stored as f = re cos(nwt) + im sin(nwt), complex amplitude re - i im; response = amplitude / (a + i b).
        let bb = h * OMEGA * C_OCEAN, d = ab * ab + bb * bb; // ocean: F / (B + D + i n w C_o)
        Ore[j] = (re * ab - im * bb) / d; Oim[j] = (im * ab + re * bb) / d;
        const fr = re + Kz * Ore[j], fi = im + Kz * Oim[j], al = ab + Kz; bb = h * OMEGA * C_LAND; d = al * al + bb * bb; // representative land
        const lr = (fr * al - fi * bb) / d, li = (fi * al + fr * bb) / d;
        for (let m = 0; m < 12; m++) { const th = 2 * Math.PI * h * (m + 0.5) / 12, c = Math.cos(th), sn = Math.sin(th); ocean[k * 12 + m] += Ore[j] * c + Oim[j] * sn; zonal[k * 12 + m] += 0.5 * (Ore[j] * c + Oim[j] * sn + lr * c + li * sn); }
      }
      if (!fixedAlbedo) for (let m = 0; m < 12; m++) alM[k * 12 + m] = 0.5 * alM[k * 12 + m] + 0.5 * snowAlbedo(Tann[k] + zonal[k * 12 + m]);
    }
  }
  for (let k = 0; k < R; k++) albedo[k] = Qa[k] > 1e-6 ? 1 - (Aa[k] - forcingAt(k)) / Qa[k] : snowAlbedo(Tann[k]);
  // Equilibrium (zero-heat-capacity) anomaly, kept for diagnostics and the glaciation work: (A_m - A_ann)/(B + D).
  const anomaly = new Float64Array(R * 12);
  for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) anomaly[k * 12 + m] = (Am[k * 12 + m] - Aa[k]) / ab;
  const seasonal = { harmonics: H, Fre, Fim, Ore, Oim, ocean, zonal, monthlyAlbedo: alM };
  return { rows: R, Tann, anomaly, seasonal, Qa, Qm, albedo, globalMean: Tmean };
}

// Three-cell circulation in "ITCZ-relative latitude" (degrees): returns [eastward, poleward] wind and ascent factor.
function belts(phiRel) {
  const a = Math.abs(phiRel);
  let u, vp;
  if (a < 30) { u = -0.8 * Math.cos(Math.PI * a / 60); vp = -0.45 * Math.sin(Math.PI * a / 30); }        // trade easterlies, equatorward
  else if (a < 60) { const s = Math.sin(Math.PI * (a - 30) / 30); u = 1.0 * s; vp = 0.3 * s; }           // westerlies, poleward
  else { const s = Math.sin(Math.PI * (a - 60) / 30); u = -0.5 * s; vp = -0.25 * s; }                      // polar easterlies
  const ascent = Math.max(0.06, 0.35 + 1.5 * Math.exp(-((a / 8) ** 2)) + 0.65 * Math.exp(-(((a - 55) / 12) ** 2)) - 0.25 * Math.exp(-(((a - 26) / 9) ** 2)) - 0.2 * Math.exp(-(((a - 90) / 12) ** 2)));
  return [u, vp, ascent];
}
/** ITCZ latitude (degrees) for month m: follows the thermal equator, ~0.35 x solar declination. */
export function itczLatitude(tiltDeg, m) { return 0.35 * declination(tiltDeg, m) * 180 / Math.PI; }

/**
 * Compute climate fields for a planet. ctx: { mesh, elevation, lat (deg), spacingKm, noise(i) in [-1,1], eddyMoisture? }.
 * Returns typed arrays; monthly arrays are cell-major (12 values per cell).
 */
export function computeClimate(ctx, tiltDeg) {
  const { mesh, elevation, spacingKm } = ctx; const { count: n, positions: P, offsets: O, neighbors: N } = mesh;
  const ebm = zonalEnergyBalance(tiltDeg);
  const rowOf = latD => { const f = (latD + 90) * 2; const k = Math.min(359, Math.max(0, Math.floor(f))); return [k, f - k]; };
  const ocean = new Uint8Array(n); for (let i = 0; i < n; i++) ocean[i] = elevation[i] < 0 ? 1 : 0;

  // Continentality: hop distance to the nearest ocean cell.
  const coastDist = new Int32Array(n).fill(-1), queue = new Int32Array(n); let qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (ocean[i]) { coastDist[i] = 0; queue[qt++] = i; }
  while (qh < qt) { const i = queue[qh++]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (coastDist[j] < 0) { coastDist[j] = coastDist[i] + 1; queue[qt++] = j; } } }

  // Monthly surface temperature: annual EBM temperature plus the heat-capacity-damped seasonal anomaly.
  // Ocean cells take the mixed-layer response T_o. Land cells solve C_l dT/dt = F - (B + D) T + K (T_o - T), i.e.
  // T_l,n = (F_n + K T_o,n) / (B + D + K + i n w C_l), with K = MARITIME_K exp(-d / MARITIME_KM), d = distance to coast.
  const tMon = new Float32Array(n * 12), tAnn = new Float32Array(n), sz = ebm.seasonal, H = sz.harmonics;
  const cosT = new Float64Array(12 * H), sinT = new Float64Array(12 * H);
  for (let h = 1; h <= H; h++) for (let m = 0; m < 12; m++) { const th = 2 * Math.PI * h * (m + 0.5) / 12; cosT[(h - 1) * 12 + m] = Math.cos(th); sinT[(h - 1) * 12 + m] = Math.sin(th); }
  const an = new Float64Array(12), ab = OLR_B + TRANSPORT;
  for (let i = 0; i < n; i++) {
    const [k, f] = rowOf(ctx.lat[i]);
    const base = ebm.Tann[k] * (1 - f) + ebm.Tann[k + 1] * f;
    const lapse = LAPSE * Math.max(0, elevation[i]), jitter = 1.5 * ctx.noise(i);
    if (ocean[i]) { for (let m = 0; m < 12; m++) an[m] = sz.ocean[k * 12 + m] * (1 - f) + sz.ocean[(k + 1) * 12 + m] * f; }
    else {
      an.fill(0);
      const K = MARITIME_K * Math.exp(-(coastDist[i] - 0.5) * spacingKm / MARITIME_KM);
      for (let h = 1; h <= H; h++) {
        const j0 = k * H + h - 1, j1 = (k + 1) * H + h - 1;
        const fr = sz.Fre[j0] * (1 - f) + sz.Fre[j1] * f + K * (sz.Ore[j0] * (1 - f) + sz.Ore[j1] * f);
        const fi = sz.Fim[j0] * (1 - f) + sz.Fim[j1] * f + K * (sz.Oim[j0] * (1 - f) + sz.Oim[j1] * f);
        const a = ab + K, b = h * OMEGA * C_LAND, d = a * a + b * b, re = (fr * a - fi * b) / d, im = (fi * a + fr * b) / d;
        for (let m = 0; m < 12; m++) an[m] += re * cosT[(h - 1) * 12 + m] + im * sinT[(h - 1) * 12 + m];
      }
    }
    let sum = 0;
    for (let m = 0; m < 12; m++) {
      const t = clamp(base + an[m] - lapse + jitter, -80, 55);
      tMon[i * 12 + m] = Math.round(t * 10) / 10; sum += tMon[i * 12 + m];
    }
    tAnn[i] = Math.round(sum / 12 * 10) / 10;
  }

  // Seasonal circulation and moisture transport for January (m=0) and July (m=6).
  const wind = [new Float32Array(3 * n), new Float32Array(3 * n)], precipSeason = [new Float64Array(n), new Float64Array(n)];
  const outW = new Float32Array(N.length), uplift = new Float64Array(n), rate = new Float64Array(n), sat = new Float64Array(n), evap = new Float64Array(n);
  const qIn = new Float64Array(n), qNext = new Float64Array(n), pWork = new Float64Array(n);
  const budget = { evaporation: 0, precipitation: 0 };
  // Latitude bands for the eddy moisture flux (eddy-0.6, F-0007).
  const eddy = { ...eddyStep(spacingKm), on: ctx.eddyMoisture !== false }; // eddyMoisture: false = season-0.5 baseline (diagnostics)
  const band = new Uint8Array(n);
  const [bandCount, bandQ, bandMul, bandAdd, stepMul, stepAdd] = Array.from({ length: 6 }, () => new Float64Array(EDDY_BANDS));
  const bandM = new Float64Array(EDDY_BANDS);
  for (let i = 0; i < n; i++) { const b = Math.min(EDDY_BANDS - 1, Math.floor((ctx.lat[i] + 90) / (180 / EDDY_BANDS))); band[i] = b; bandCount[b]++; }
  [0, 6].forEach((month, s) => {
    const itcz = itczLatitude(tiltDeg, month), W = wind[s];
    for (let i = 0; i < n; i++) {
      const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2], r = Math.sqrt(x * x + z * z), la = ctx.lat[i];
      const rel = la >= itcz ? 90 * (la - itcz) / (90 - itcz) : 90 * (la - itcz) / (90 + itcz);
      const [u, vp, asc] = belts(rel), v = vp * (rel >= 0 ? 1 : -1);
      const ex = r > 1e-9 ? -z / r : 1, ez = r > 1e-9 ? x / r : 0;
      const nx = r > 1e-9 ? -y * x / r : 0, ny = r, nz = r > 1e-9 ? -y * z / r : 1;
      W[3 * i] = u * ex + v * nx; W[3 * i + 1] = v * ny; W[3 * i + 2] = u * ez + v * nz;
      rate[i] = 0.035 * asc;
      const T = tMon[i * 12 + month];
      sat[i] = 40 * satVapour(T);
      evap[i] = ocean[i] ? satVapour(T) * (T < -2 ? 0.1 : 1) : 0;
    }
    // Downwind transport weights (positive projection of wind on each outgoing edge) and orographic uplift.
    for (let j = 0; j < n; j++) {
      let sum = 0; const wx = W[3 * j], wy = W[3 * j + 1], wz = W[3 * j + 2];
      for (let e = O[j]; e < O[j + 1]; e++) {
        const i = N[e]; let dx = P[3 * i] - P[3 * j], dy = P[3 * i + 1] - P[3 * j + 1], dz = P[3 * i + 2] - P[3 * j + 2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz); const d = Math.max(0, (wx * dx + wy * dy + wz * dz) / l);
        outW[e] = d; sum += d;
      }
      const deg = O[j + 1] - O[j]; let up = 0; const hj = Math.max(0, elevation[j]);
      for (let e = O[j]; e < O[j + 1]; e++) { outW[e] = sum > 1e-6 ? outW[e] / sum : 1 / deg; up += outW[e] * (Math.max(0, elevation[N[e]]) - hj); }
      uplift[j] = up;
      // windward ascent boosts precipitation; descending lee air suppresses it (foehn-type drying)
      rate[j] = Math.min(0.9, up > 0 ? rate[j] * (1 + up / 250) : rate[j] * Math.max(0.2, 1 + up / 500));
    }
    const { E, Ptot } = transportMoisture(n, O, N, ocean, evap, rate, sat, outW, band, bandCount, eddy, pWork, precipSeason[s], qIn, qNext, bandM, bandQ, bandMul, bandAdd, stepMul, stepAdd);
    budget.evaporation += E; budget.precipitation += Ptot;
  });

  // Monthly precipitation: blend of the January and July regimes. Annual total in mm.
  const pMon = new Float32Array(n * 12), pAnn = new Uint16Array(n), koppen = new Uint8Array(n), biome = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    let raw = 0;
    for (let m = 0; m < 12; m++) { const wJul = (1 - Math.cos(2 * Math.PI * m / 12)) / 2; raw += ((1 - wJul) * precipSeason[0][i] + wJul * precipSeason[1][i]) * PRECIP_SCALE / 12; }
    // Cap at 12,000 mm/yr (close to Earth's wettest stations) so coarse meshes cannot dump a whole air column on one cell.
    const cap = raw > MAX_ANNUAL_MM ? MAX_ANNUAL_MM / raw : 1;
    let sum = 0;
    for (let m = 0; m < 12; m++) {
      const wJul = (1 - Math.cos(2 * Math.PI * m / 12)) / 2;
      const v = Math.round(((1 - wJul) * precipSeason[0][i] + wJul * precipSeason[1][i]) * PRECIP_SCALE / 12 * cap * 10) / 10;
      pMon[i * 12 + m] = v; sum += v;
    }
    pAnn[i] = Math.min(65535, Math.round(sum));
    koppen[i] = ocean[i] ? 0 : classifyKoppen(tMon, pMon, i, ctx.lat[i] >= 0);
    biome[i] = ocean[i] ? 0 : whittaker(tAnn[i], pAnn[i], KOPPEN[koppen[i]]);
  }
  return { tilt: tiltDeg, ebm, temperatureMonthly: tMon, temperature: tAnn, precipitationMonthly: pMon, rainfall: pAnn, koppen, biome, wind, uplift, coastDist, budget, eddy, itcz: [itczLatitude(tiltDeg, 0), itczLatitude(tiltDeg, 6)] };
}
// Steady-state moisture transport: 90 one-hop iterations of evaporation, precipitation, advection along the wind
// weights outW, and the eddy-0.6 band diffusion applied to the moisture arriving at each iteration.
// Pout receives the precipitation averaged over the last EDDY_EVERY iterations (one full eddy cycle) and the returned
// budget is averaged the same way, so the operator-split eddy pulse does not bias the result.
function transportMoisture(n, O, N, ocean, evap, rate, sat, outW, band, bandCount, eddy, Pseas, Pout, qA, qB, bandM, bandQ, bandMul, bandAdd, stepMul, stepAdd) {
  let qIn = qA, qNext = qB, E = 0, Ptot = 0, Eavg = 0, Pavg = 0;
  const ITER = 90, AVG = EDDY_EVERY;
  qIn.fill(0); Pseas.fill(0); Pout.fill(0);
  for (let it = 0; it < ITER; it++) {
    // Eddy step (operator splitting): every EDDY_EVERY iterations, diffuse the band totals of the arriving moisture
    // over EDDY_EVERY iterations' worth of time, as eddy.sub stable sub-steps composed into per-band factors.
    const doEddy = eddy.on && it > 0 && it % EDDY_EVERY === 0;
    if (doEddy) {
      bandM.fill(0); for (let j = 0; j < n; j++) bandM[band[j]] += qIn[j];
      bandMul.fill(1); bandAdd.fill(0);
      for (let k = 0; k < eddy.sub; k++) { eddyFactors(bandCount, bandM, bandQ, stepMul, stepAdd, eddy.step); for (let b = 0; b < EDDY_BANDS; b++) { bandMul[b] *= stepMul[b]; bandAdd[b] = bandAdd[b] * stepMul[b] + stepAdd[b]; } }
      for (let j = 0; j < n; j++) { const b = band[j]; qIn[j] = qIn[j] * bandMul[b] + bandAdd[b]; }
    }
    qNext.fill(0); E = 0; Ptot = 0;
    for (let j = 0; j < n; j++) {
      const e0 = ocean[j] ? evap[j] : 0.7 * Pseas[j]; // land: evapotranspiration recycles part of local rain
      const avail = qIn[j] + e0;
      const keep = (1 - rate[j]) * avail;
      const p = rate[j] * avail + (keep > sat[j] ? keep - sat[j] : 0);
      Pseas[j] = p; E += e0; Ptot += p;
      const out = avail - p;
      for (let e = O[j]; e < O[j + 1]; e++) qNext[N[e]] += out * outW[e];
    }
    if (it >= ITER - AVG) { for (let j = 0; j < n; j++) Pout[j] += Pseas[j] / AVG; Eavg += E / AVG; Pavg += Ptot / AVG; }
    const t = qIn; qIn = qNext; qNext = t;
  }
  return { E: Eavg, Ptot: Pavg };
}

// Eddy moisture transport (eddy-0.6, F-0007). Conceptual approximation: transient midlatitude eddies carry water
// vapour poleward down the zonal-mean humidity gradient, which moist energy-balance models represent as meridional
// diffusion F = -D dq/dy. D = 1.87e6 m^2 s^-1 is the extratropical effective moist-static-energy diffusivity of the
// control aquaplanet GCM in Frierson, Held & Zurita-Gotor (2007, J. Atmos. Sci. 64, 1680; their EBM2 used 1.84e6;
// Hwang & Frierson 2010 used 1.06e6 for the 20C3M models). Here the in-transit moisture of each EDDY_BANDS latitude
// band (2 degrees, dy = pi R / 90 ~ 222 km) is diffused to its neighbouring bands every EDDY_EVERY = 3 transport
// iterations (operator splitting, for speed) by the diffusion accumulated over those iterations. One
// iteration moves air one mesh hop, so it stands for dt = spacing / EDDY_HOP_SPEED (an assumed representative
// lower-tropospheric wind speed of 7 m/s; ~1.1e4 s at 100,002 cells), giving D dt / dy^2 ~ 0.41 per iteration.
// Steps above 0.45 are split into sub-steps (explicit-scheme stability on coarse meshes). Band gains are added
// uniformly to the band's cells and band losses removed in proportion to each cell's moisture, so moisture is
// conserved and stays non-negative.
export const EDDY_BANDS = 90, EDDY_DIFFUSIVITY = 1.87e6, EDDY_HOP_SPEED = 7, EDDY_EVERY = 3;
/** Per-application diffusion step: alpha = D (EDDY_EVERY dt) / dy^2 with dt = spacing / EDDY_HOP_SPEED, sub-stepped. */
export function eddyStep(spacingKm) {
  const dy = Math.PI * 6371e3 / EDDY_BANDS, alpha = EDDY_EVERY * EDDY_DIFFUSIVITY * (spacingKm * 1000 / EDDY_HOP_SPEED) / (dy * dy);
  const sub = Math.max(1, Math.ceil(alpha / 0.45));
  return { alpha, sub, step: alpha / sub };
}
/**
 * One eddy-diffusion step on the band totals of q. Writes per-band factors: q_i -> q_i * mul[b] + add[b]
 * (gaining bands: mul 1, uniform add; losing bands: proportional removal, add 0). Returns nothing.
 */
export function eddyFactors(count, M, Q, mul, add, alpha) {
  const B = count.length;
  for (let b = 0; b < B; b++) { Q[b] = count[b] > 0 ? M[b] / count[b] : 0; add[b] = 0; }
  for (let b = 0; b + 1 < B; b++) {
    if (!count[b] || !count[b + 1]) continue;
    const f = alpha * 0.5 * (count[b] + count[b + 1]) * (Q[b] - Q[b + 1]); // moisture moved from band b to b+1
    add[b] -= f; add[b + 1] += f;
  }
  for (let b = 0; b < B; b++) {
    const d = add[b];
    if (d > 0) { mul[b] = 1; add[b] = d / count[b]; } else { mul[b] = M[b] > 0 ? Math.max(0, 1 + d / M[b]) : 1; add[b] = 0; }
    M[b] = M[b] * mul[b] + add[b] * count[b]; // band total after this step (for further sub-steps)
  }
}

// Converts the model's moisture units to mm/yr; calibrated so seed ATLAS-001 at Earth's tilt has a global
// mean near 1,000 mm/yr (Earth's observed mean is about 1,000 mm/yr; Adler et al. 2003). Fixed constant, so
// warmer or wetter planets still produce more rain.
const PRECIP_SCALE = 76;
const MAX_ANNUAL_MM = 12000;

/** Köppen-Geiger class index (Peel, Finlayson & McMahon 2007 criteria). Summer = Apr-Sep in the north. */
export function classifyKoppen(tMon, pMon, i, north) {
  let Tann = 0, Pann = 0, Thot = -1e9, Tcold = 1e9, n10 = 0, Pdry = 1e9, Ps = 0;
  let Psdry = 1e9, Pswet = 0, Pwdry = 1e9, Pwwet = 0;
  for (let m = 0; m < 12; m++) {
    const t = tMon[i * 12 + m], p = pMon[i * 12 + m];
    Tann += t / 12; Pann += p; if (t > Thot) Thot = t; if (t < Tcold) Tcold = t; if (t >= 10) n10++; if (p < Pdry) Pdry = p;
    const summer = north ? m >= 3 && m <= 8 : m <= 2 || m >= 9;
    if (summer) { Ps += p; if (p < Psdry) Psdry = p; if (p > Pswet) Pswet = p; } else { if (p < Pwdry) Pwdry = p; if (p > Pwwet) Pwwet = p; }
  }
  const idx = c => KOPPEN.indexOf(c);
  if (Thot < 10) return idx(Thot > 0 ? 'ET' : 'EF');
  const Pw = Pann - Ps;
  const Pth = Pw >= 0.7 * Pann ? 2 * Tann : Ps >= 0.7 * Pann ? 2 * Tann + 28 : 2 * Tann + 14; // mm (Peel et al. 2007)
  if (Pann < 10 * Math.max(0, Pth)) return idx((Pann < 5 * Pth ? 'BW' : 'BS') + (Tann >= 18 ? 'h' : 'k'));
  if (Tcold >= 18) return idx(Pdry >= 60 ? 'Af' : Pdry >= 100 - Pann / 25 ? 'Am' : 'Aw');
  const second = Psdry < 40 && Psdry < Pwwet / 3 ? 's' : Pwdry < Pswet / 10 ? 'w' : 'f';
  const third = Thot >= 22 ? 'a' : n10 >= 4 ? 'b' : Tcold < -38 ? 'd' : 'c';
  return idx((Tcold > 0 ? 'C' : 'D') + second + (Tcold > 0 && third === 'd' ? 'c' : third));
}

/** Whittaker-inspired biome from annual mean temperature (°C) and precipitation (mm). Boundaries approximate. */
export function whittaker(T, P, koppen) {
  const B = name => BIOMES.indexOf(name);
  if (koppen === 'EF') return B('Ice');
  if (T < -5) return B('Tundra');
  if (T < 3) return P < 250 ? B('Tundra') : B('Boreal forest');
  if (T < 20) {
    if (P < 300) return B('Cold desert');
    if (P < 600) return B('Temperate grassland');
    if (P < 1000 && T >= 10) return B('Woodland / shrubland');
    if (P < 2200) return B('Temperate seasonal forest');
    return B('Temperate rainforest');
  }
  if (P < 600) return B('Subtropical desert');
  if (P < 1000) return B('Woodland / shrubland');
  if (P < 2500) return B('Tropical seasonal forest / savanna');
  return B('Tropical rainforest');
}
