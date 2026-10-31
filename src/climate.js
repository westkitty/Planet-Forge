// Planet Forge climate model (part of world model climate-0.3).
//
// Conceptual approximation, not a general circulation model. It chains:
//   1. daily-mean top-of-atmosphere insolation for each month from axial tilt (circular orbit);
//   2. a zonal Budyko-Sellers / North energy-balance model (linear outgoing longwave, diffusive-to-mean heat
//      transport, temperature-dependent ice albedo) for annual-mean and seasonal temperature by latitude;
//   3. per-cell surface temperature: lapse rate, ocean/land heat-capacity damping, thermal lag, continentality;
//   4. a prescribed three-cell circulation (Hadley / Ferrel / polar) whose belts follow the seasonal ITCZ;
//   5. steady-state moisture advection on the 100k-cell mesh: ocean evaporation from Magnus saturation vapour
//      pressure, upwind transport, precipitation from ascent, orographic uplift and saturation, lee-side
//      suppression and land recycling, so rain shadows emerge downwind of the tectonic mountain belts;
//   6. Köppen-Geiger classification (Peel et al. 2007 rules) and Whittaker-inspired biomes.
// Assumptions, constants and sources: docs/features/F-0003-climate-circulation.md.

export const SOLAR_CONSTANT = 1361;            // W m^-2 (Kopp & Lean 2011)
const OLR_A = 203.3, OLR_B = 2.09;            // W m^-2, W m^-2 K^-1 (North, Cahalan & Coakley 1981)
const TRANSPORT = 3.81;                        // W m^-2 K^-1, Budyko-type transport toward global mean (North 1975)
const LAPSE = 0.0065;                          // K m^-1 (ICAO standard atmosphere)
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
const iceAlbedo = T => (T > -2 ? 0.3 : T < -18 ? 0.62 : 0.3 + 0.32 * (-2 - T) / 16);

/** Zonal energy-balance model on 0.5° latitude rows. Returns annual temperature and monthly anomalies per row. */
export function zonalEnergyBalance(tiltDeg) {
  const R = 361, Qm = new Float64Array(R * 12), Qa = new Float64Array(R), lat = new Float64Array(R), w = new Float64Array(R);
  const decl = Array.from({ length: 12 }, (_, m) => declination(tiltDeg, m));
  let wsum = 0;
  for (let k = 0; k < R; k++) {
    const phi = (-90 + 0.5 * k) * Math.PI / 180; lat[k] = phi; w[k] = Math.max(1e-6, Math.cos(phi)); wsum += w[k];
    for (let m = 0; m < 12; m++) { const q = Math.max(0, dailyInsolation(phi, decl[m])); Qm[k * 12 + m] = q; Qa[k] += q / 12; }
  }
  const Tann = new Float64Array(R).fill(15), albedo = new Float64Array(R).fill(0.3);
  let Tmean = 15;
  for (let it = 0; it < 8; it++) {
    let absorbed = 0; for (let k = 0; k < R; k++) { albedo[k] = iceAlbedo(Tann[k]); absorbed += w[k] * Qa[k] * (1 - albedo[k]); }
    Tmean = (absorbed / wsum - OLR_A) / OLR_B; // global balance: transport sums to zero
    for (let k = 0; k < R; k++) Tann[k] = (Qa[k] * (1 - albedo[k]) - OLR_A + TRANSPORT * Tmean) / (OLR_B + TRANSPORT);
  }
  const anomaly = new Float64Array(R * 12);
  for (let k = 0; k < R; k++) for (let m = 0; m < 12; m++) anomaly[k * 12 + m] = (Qm[k * 12 + m] - Qa[k]) * (1 - albedo[k]) / (OLR_B + TRANSPORT);
  return { rows: R, Tann, anomaly, Qa, Qm, albedo, globalMean: Tmean };
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
 * Compute climate fields for a planet. ctx: { mesh, elevation, lat (deg), spacingKm, noise(i) in [-1,1] }.
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

  // Monthly surface temperature.
  const tMon = new Float32Array(n * 12), tAnn = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [k, f] = rowOf(ctx.lat[i]);
    const base = ebm.Tann[k] * (1 - f) + ebm.Tann[k + 1] * f;
    const cont = ocean[i] ? 0 : Math.min(1, coastDist[i] * spacingKm / 1800);
    const amp = ocean[i] ? 0.35 : 0.7 + 1.1 * cont, lag = ocean[i] ? 2 : 1;
    const lapse = LAPSE * Math.max(0, elevation[i]), jitter = 1.5 * ctx.noise(i);
    let sum = 0;
    for (let m = 0; m < 12; m++) {
      const mm = (m - lag + 12) % 12;
      const an = ebm.anomaly[k * 12 + mm] * (1 - f) + ebm.anomaly[(k + 1) * 12 + mm] * f;
      const t = clamp(base + amp * an - lapse + jitter, -80, 55);
      tMon[i * 12 + m] = Math.round(t * 10) / 10; sum += tMon[i * 12 + m];
    }
    tAnn[i] = Math.round(sum / 12 * 10) / 10;
  }

  // Seasonal circulation and moisture transport for January (m=0) and July (m=6).
  const wind = [new Float32Array(3 * n), new Float32Array(3 * n)], precipSeason = [new Float64Array(n), new Float64Array(n)];
  const outW = new Float32Array(N.length), uplift = new Float64Array(n), rate = new Float64Array(n), sat = new Float64Array(n), evap = new Float64Array(n);
  let qIn = new Float64Array(n), qNext = new Float64Array(n);
  const budget = { evaporation: 0, precipitation: 0 };
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
    const Pseas = precipSeason[s]; qIn.fill(0); Pseas.fill(0);
    let E = 0, Ptot = 0;
    for (let it = 0; it < 90; it++) {
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
      const t = qIn; qIn = qNext; qNext = t;
    }
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
  return { tilt: tiltDeg, ebm, temperatureMonthly: tMon, temperature: tAnn, precipitationMonthly: pMon, rainfall: pAnn, koppen, biome, wind, uplift, coastDist, budget, itcz: [itczLatitude(tiltDeg, 0), itczLatitude(tiltDeg, 6)] };
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
