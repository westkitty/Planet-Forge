// Milestone 5 celestial systems (PF-24 star, PF-25 moon and eclipses, PF-26 satellites). Pure functions with explicit
// units: km, s, days, AU, W m⁻². Frames:
//   ecliptic — heliocentric inertial frame, x toward the planet at t = 0, z = ecliptic north;
//   body     — planet-fixed: the app's planet frame (y = north pole, longitude = atan2(z, x)).
// The planet's axis is tilted by the world's obliquity about the ecliptic x axis; it spins once per sidereal day.
// Nothing here feeds the climate model: glacial-0.8 assumes 1361 W m⁻² (see stellarFlux), and coupling a different
// star to the climate would need a new, validated, versioned model.
import { SOLAR_CONSTANT } from './climate.js';
import { hashSeed, rng } from './world.js';

export const AU_KM = 149597870.7, R_SUN_KM = 695700, PLANET_RADIUS_KM = 6371, GM_PLANET = 398600.4418, GM_SUN = 1.32712440018e11, SIGMA = 5.670374419e-8, DAY_S = 86400;
// Main-sequence types (approximate representative values: Teff K, L/L☉, M/M☉, R/R☉).
export const STAR_TYPES = {
  M5V: { teff: 3100, L: .0022, M: .16, R: .2 }, M0V: { teff: 3850, L: .072, M: .57, R: .62 }, K5V: { teff: 4440, L: .16, M: .69, R: .72 },
  K0V: { teff: 5270, L: .46, M: .88, R: .85 }, G2V: { teff: 5772, L: 1, M: 1, R: 1 }, F5V: { teff: 6540, L: 3.2, M: 1.33, R: 1.47 }, A0V: { teff: 9700, L: 40, M: 2.4, R: 2.4 }
};

/** PF-24: validate a star configuration { type, distanceAU }. */
export function validateStar(c) {
  if (!c || !STAR_TYPES[c.type]) return 'unknown star type';
  if (!(c.distanceAU >= .01 && c.distanceAU <= 50)) return 'orbital distance must be 0.01–50 AU';
  return null;
}
/** Incoming radiation at the planet: S = 1361 W m⁻² × (L/L☉) / (d/AU)². */
export const stellarFlux = c => SOLAR_CONSTANT * STAR_TYPES[c.type].L / (c.distanceAU * c.distanceAU);
/** Orbital period (days) from Kepler's third law around the star. */
export const yearDays = c => 2 * Math.PI * Math.sqrt((c.distanceAU * AU_KM) ** 3 / (GM_SUN * STAR_TYPES[c.type].M)) / DAY_S;
/**
 * Habitable-zone edges from Kopparapu et al. (2013): S_eff = S_eff☉ + aT + bT² + cT³ + dT⁴, T = Teff − 5780 K, valid
 * 2600–7200 K (clamped outside that range and flagged). Distance = sqrt(L / S_eff) AU.
 */
const HZ = { runaway: [1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15], maximum: [.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16] };
export function habitableZone(type) {
  const s = STAR_TYPES[type], T = Math.max(2600, Math.min(7200, s.teff)) - 5780, seff = k => HZ[k][0] + HZ[k][1] * T + HZ[k][2] * T ** 2 + HZ[k][3] * T ** 3 + HZ[k][4] * T ** 4;
  return { innerAU: Math.sqrt(s.L / seff('runaway')), outerAU: Math.sqrt(s.L / seff('maximum')), extrapolated: s.teff < 2600 || s.teff > 7200 };
}
export function habitability(c) {
  const S = stellarFlux(c), hz = habitableZone(c.type), teq = Math.pow(S * (1 - .3) / (4 * SIGMA), .25);
  return { fluxWm2: Math.round(S * 10) / 10, relativeToModel: Math.round(S / SOLAR_CONSTANT * 1000) / 1000, equilibriumK: Math.round(teq), hz, inHZ: c.distanceAU >= hz.innerAU && c.distanceAU <= hz.outerAU, yearDays: Math.round(yearDays(c) * 10) / 10,
    coupling: Math.abs(S - SOLAR_CONSTANT) < 1 ? 'This star and distance match the 1,361 W m⁻² the climate model assumes.' : 'Not coupled: the climate shown is computed for 1,361 W m⁻². This star would deliver ' + Math.round(S / SOLAR_CONSTANT * 100) + ' % of that; recomputing the climate for it needs a new, validated model version.' };
}

// ---- frames ----
const rotX = (v, a) => [v[0], v[1] * Math.cos(a) - v[2] * Math.sin(a), v[1] * Math.sin(a) + v[2] * Math.cos(a)];
const rotZ = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a), v[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k], norm = a => Math.hypot(...a);
/** Ecliptic vector → planet body frame (app frame) at time t (days). */
export function eclipticToBody(v, t, obliquityDeg, dayHours = 24) {
  const eq = rotX(v, -obliquityDeg * Math.PI / 180), spin = rotZ(eq, -2 * Math.PI * t * 24 / dayHours);
  return [spin[0], spin[2], spin[1]]; // body z (north) → app y; app longitude = atan2(app z, app x)
}
export const bodyToLatLon = b => { const l = norm(b); return { lat: Math.asin(b[1] / l) * 180 / Math.PI, lon: Math.atan2(b[2], b[0]) * 180 / Math.PI }; };

// ---- PF-25 moon and eclipses ----
export function makeMoon(worldSeed) {
  const r = rng(hashSeed('moon:' + worldSeed));
  const radiusKm = 1200 + r() * 900, distanceKm = 300000 + r() * 160000, inclinationDeg = 2 + r() * 6, nodeDeg = r() * 360, phaseDeg = r() * 360;
  const periodDays = 2 * Math.PI * Math.sqrt(distanceKm ** 3 / GM_PLANET) / DAY_S;
  return { radiusKm: Math.round(radiusKm), distanceKm: Math.round(distanceKm), inclinationDeg: Math.round(inclinationDeg * 100) / 100, nodeDeg: Math.round(nodeDeg), phaseDeg: Math.round(phaseDeg), periodDays: Math.round(periodDays * 1000) / 1000, note: 'Circular, fixed-node orbit (no nodal precession or perturbations): a stated approximation.' };
}
function state(t, star, moon) {
  const P = yearDays(star), a = star.distanceAU * AU_KM, th = 2 * Math.PI * t / P, planet = [a * Math.cos(th), a * Math.sin(th), 0];
  const u = moon.phaseDeg * Math.PI / 180 + 2 * Math.PI * t / moon.periodDays, inc = moon.inclinationDeg * Math.PI / 180, node = moon.nodeDeg * Math.PI / 180;
  const m = rotZ(rotX([moon.distanceKm * Math.cos(u), moon.distanceKm * Math.sin(u), 0], inc), node);
  return { planet, moon: m, sunDir: scale(planet, -1 / norm(planet)), sunDistKm: a };
}
/** Geometry at time t: solar-eclipse and lunar-eclipse classification and the shadow centre on the planet. */
export function eclipseAt(t, star, moon) {
  const s = state(t, star, moon), Rs = STAR_TYPES[star.type].R * R_SUN_KM, Rm = moon.radiusKm, Rp = PLANET_RADIUS_KM, along = dot(s.moon, s.sunDir);
  const perp = norm(sub(s.moon, scale(s.sunDir, along)));
  if (along > 0) { // moon toward the star: solar eclipse if its shadow reaches the planet
    const L = along, D = s.sunDistKm, rU = Rm - L * (Rs - Rm) / D, rP = Rm + L * (Rs + Rm) / D;
    if (perp > Rp + rP) return { kind: null, miss: perp - Rp - rP };
    const central = perp < Rp, type = !central ? 'partial solar' : rU > 0 ? 'total solar' : 'annular solar';
    // the shadow axis is the line through the moon along −sunDir; its foot point is the closest approach to the planet
    // centre, and the sub-shadow point is where the axis meets the star-facing surface: (foot + h · sunDir) / R
    let centre = null; if (central) { const foot = sub(s.moon, scale(s.sunDir, along)), h = Math.sqrt(Math.max(0, Rp * Rp - perp * perp)); centre = scale([foot[0] + h * s.sunDir[0], foot[1] + h * s.sunDir[1], foot[2] + h * s.sunDir[2]], 1 / Rp); }
    return { kind: type, perpKm: Math.round(perp), umbraKm: Math.round(Math.abs(rU)), penumbraKm: Math.round(rP), centre };
  }
  const L = -along, D = s.sunDistKm, rU = Rp - L * (Rs - Rp) / D, rP = Rp + L * (Rs + Rp) / D;
  if (perp > rP + Rm) return { kind: null, miss: perp - rP - Rm };
  return { kind: perp < rU - Rm ? 'total lunar' : perp < rU + Rm ? 'partial lunar' : 'penumbral lunar', perpKm: Math.round(perp) };
}
/** Predict eclipses in [t0, t0 + days): scan every syzygy (new and full moon) and refine to the closest approach. */
export function predictEclipses(star, moon, obliquityDeg, t0 = 0, days = 730) {
  const out = [], synodic = 1 / (1 / moon.periodDays - 1 / yearDays(star));
  // first new moon after t0: elongation e(t) = moon longitude − sun longitude measured in the ecliptic
  const elong = t => { const s = state(t, star, moon); return Math.atan2(s.moon[1], s.moon[0]) - Math.atan2(s.sunDir[1], s.sunDir[0]); };
  const wrap = x => ((x % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
  for (let k = 0, t = t0; t < t0 + days; k++) {
    // find the next syzygy by stepping and bisecting the zero of the (wrapped) elongation or elongation − π
    for (const target of [0, Math.PI]) {
      let a = t, b = t + synodic, f = x => wrap(elong(x) - target), fa = f(a), found = null;
      for (let x = a + .25; x <= b; x += .25) { const fx = f(x); if (fa <= 0 && fx > 0 && fx - fa < Math.PI) { found = [x - .25, x]; break; } fa = fx; }
      if (!found) continue;
      let [lo, hi] = found; for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (f(mid) <= 0) lo = mid; else hi = mid; }
      let best = (lo + hi) / 2, e = eclipseAt(best, star, moon);
      for (let dt = -.5; dt <= .5; dt += .01) { const g = eclipseAt(best + dt, star, moon); if (g.kind && (!e.kind || (g.perpKm ?? 1e12) < (e.perpKm ?? 1e12))) { e = g; } }
      if (e.kind && best >= t0 && best < t0 + days && !out.some(o => Math.abs(o.day - best) < 2)) {
        const where = e.centre ? bodyToLatLon(eclipticToBody(e.centre, best, obliquityDeg)) : null;
        const sun = bodyToLatLon(eclipticToBody(state(best, star, moon).sunDir, best, obliquityDeg));
        out.push({ day: Math.round(best * 100) / 100, sunLat: Math.round(sun.lat * 10) / 10, sunLon: Math.round(sun.lon * 10) / 10, type: e.kind, perpKm: e.perpKm, umbraKm: e.umbraKm, centre: where && { lat: Math.round(where.lat * 10) / 10, lon: Math.round(where.lon * 10) / 10 } });
      }
    }
    t += synodic;
  }
  return out.sort((a, b) => a.day - b.day);
}

// ---- PF-26 satellites ----
export const SAT_CLASSES = { imaging: { minElevationDeg: 60, label: 'Imaging (narrow, sharp)' }, survey: { minElevationDeg: 30, label: 'Survey (wide)' }, weather: { minElevationDeg: 10, label: 'Weather (very wide)' } };
export const LIMITS = { minAltKm: 160, maxAltKm: 42164 - PLANET_RADIUS_KM + 2000, deltaVBudgetKms: 2 };
export const circularSpeed = altKm => Math.sqrt(GM_PLANET / (PLANET_RADIUS_KM + altKm));
export const orbitPeriodMin = altKm => 2 * Math.PI * Math.sqrt((PLANET_RADIUS_KM + altKm) ** 3 / GM_PLANET) / 60;
/** Earth-central angle of the footprint radius for a minimum elevation ε: λ = acos(R cos ε / (R + h)) − ε. */
export const footprintDeg = (altKm, minElevDeg) => { const e = minElevDeg * Math.PI / 180; return (Math.acos(PLANET_RADIUS_KM * Math.cos(e) / (PLANET_RADIUS_KM + altKm)) - e) * 180 / Math.PI; };
export function validateOrbit(o) {
  if (!SAT_CLASSES[o.cls]) return 'unknown satellite class';
  if (!(o.altKm >= LIMITS.minAltKm)) return `altitude below ${LIMITS.minAltKm} km decays in days`;
  if (!(o.altKm <= LIMITS.maxAltKm)) return 'altitude above the supported range';
  if (!(o.incDeg >= 0 && o.incDeg <= 180)) return 'inclination must be 0–180°';
  return null;
}
/** Δv (km/s) for a Hohmann altitude change plus a plane change done at the higher orbit's speed. */
export function maneuverDeltaV(from, to) {
  const r1 = PLANET_RADIUS_KM + from.altKm, r2 = PLANET_RADIUS_KM + to.altKm, mu = GM_PLANET;
  const hoh = r1 === r2 ? 0 : Math.abs(Math.sqrt(mu / r1) * (Math.sqrt(2 * r2 / (r1 + r2)) - 1)) + Math.abs(Math.sqrt(mu / r2) * (1 - Math.sqrt(2 * r1 / (r1 + r2))));
  const di = Math.abs(to.incDeg - from.incDeg) * Math.PI / 180, plane = 2 * Math.sqrt(mu / Math.max(r1, r2)) * Math.sin(di / 2);
  return hoh + plane;
}
/** Satellite position (planet-centred inertial, km) at t seconds; ascending node raan, phase at t = 0. */
export function satInertial(o, tS) {
  const r = PLANET_RADIUS_KM + o.altKm, u = (o.phaseDeg || 0) * Math.PI / 180 + 2 * Math.PI * tS / (orbitPeriodMin(o.altKm) * 60);
  return rotZ(rotX([r * Math.cos(u), r * Math.sin(u), 0], o.incDeg * Math.PI / 180), (o.raanDeg || 0) * Math.PI / 180); // equatorial inertial (z = spin axis)
}
/** Sub-satellite point in the app's planet frame (unit vector) at t seconds (planet spins once per 24 h). */
export function subSatellite(o, tS) { const v = rotZ(satInertial(o, tS), -2 * Math.PI * tS / DAY_S), l = norm(v); return [v[0] / l, v[2] / l, v[1] / l]; }
