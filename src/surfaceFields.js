// Pure, deterministic per-planet fields derived from the authoritative world arrays for presentation (PF-06, PF-07,
// PF-08). Nothing here writes to the planet. Everything is a function of (planet, options), so it is unit-tested.
import { hashSeed } from './world.js';

const DEG = Math.PI / 180;

/** Cheap deterministic value noise on 3-D directions (from Event-Horizon-Forge Starfield.ts). */
export function valueNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => { let n = Math.imul(a, 374761393) ^ Math.imul(b, 668265263) ^ Math.imul(c, 1274126177); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967295; };
  const L = (a, b, t) => a + (b - a) * t;
  return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
}

/**
 * Zonal-mean fields on 2° latitude bands × 4° longitude bins: precipitation (mm/yr, annual or one month × 12) and the
 * zonal-mean eastward wind of the model's prescribed circulation (m/s, annual = mean of January and July).
 */
export function binnedClimate(planet, month = -1) {
  const LAT = 90, LON = 90, rain = new Float64Array(LAT * LON), cnt = new Float64Array(LAT * LON), u = new Float64Array(LAT), uc = new Float64Array(LAT);
  const P = planet.mesh.positions, J = planet.climate.wind[0], Y = planet.climate.wind[1], pm = planet.climate.precipitationMonthly;
  for (let i = 0; i < planet.cellCount; i++) {
    const la = Math.min(LAT - 1, Math.floor((planet.lat[i] + 90) / 2)), lo = Math.min(LON - 1, Math.floor((planet.lon[i] + 180) / 4));
    rain[la * LON + lo] += month < 0 ? planet.rainfall[i] : pm[12 * i + month] * 12; cnt[la * LON + lo]++;
    const x = P[3 * i], z = P[3 * i + 2], r = Math.hypot(x, z) || 1, ex = -z / r, ez = x / r; // eastward unit vector
    const wx = month === 0 ? J[3 * i] : month === 6 ? Y[3 * i] : (J[3 * i] + Y[3 * i]) / 2, wz = month === 0 ? J[3 * i + 2] : month === 6 ? Y[3 * i + 2] : (J[3 * i + 2] + Y[3 * i + 2]) / 2;
    u[la] += wx * ex + wz * ez; uc[la]++;
  }
  for (let la = 0; la < LAT; la++) { // polar bins are small: fill empty bins from the row mean
    let s = 0, c = 0; for (let lo = 0; lo < LON; lo++) if (cnt[la * LON + lo]) { s += rain[la * LON + lo] / cnt[la * LON + lo]; c++; }
    const mean = c ? s / c : 0;
    for (let lo = 0; lo < LON; lo++) { const k = la * LON + lo; rain[k] = cnt[k] ? rain[k] / cnt[k] : mean; }
    u[la] = uc[la] ? u[la] / uc[la] : 0;
  }
  return { LAT, LON, rain, zonalWind: u };
}

/** Visual cloud cover (0–1) for a precipitation rate: dry air stays clear, wet regions cloud over. */
export const coverFromRain = mm => Math.pow(Math.min(1, Math.max(0, (mm - 120) / 2100)), .75);

/**
 * PF-07 climate-informed cloud field: an equirectangular RGBA8 image (u = longitude via atan2(z, x), v = latitude, row 0
 * at −90°). R = cloud cover from the binned precipitation of the selected month (annual if −1), broken up by seeded
 * value noise; G = zonal drift from the model's zonal-mean wind (128 = calm). A visual approximation of where rain
 * falls, not a simulated cloud or weather field.
 */
export function buildCloudField(planet, { width = 256, height = 128, month = -1 } = {}) {
  const b = binnedClimate(planet, month), data = new Uint8Array(width * height * 4), seed = hashSeed('clouds:' + planet.seed);
  const ox = (seed % 1000) / 37, oy = ((seed >>> 10) % 1000) / 41, oz = ((seed >>> 20) % 1000) / 43;
  const bilinear = (lat, lon) => {
    const fy = Math.min(b.LAT - 1.001, Math.max(0, (lat + 90) / 2 - .5)), fx = ((lon + 180) / 4 - .5 + b.LON) % b.LON;
    const y0 = Math.floor(fy), x0 = Math.floor(fx), ty = fy - y0, tx = fx - x0, x1 = (x0 + 1) % b.LON, y1 = y0 + 1, R = b.rain;
    return (R[y0 * b.LON + x0] * (1 - tx) + R[y0 * b.LON + x1] * tx) * (1 - ty) + (R[y1 * b.LON + x0] * (1 - tx) + R[y1 * b.LON + x1] * tx) * ty;
  };
  let maxU = 1e-6; for (const v of b.zonalWind) maxU = Math.max(maxU, Math.abs(v));
  for (let y = 0; y < height; y++) {
    const lat = ((y + .5) / height) * 180 - 90, cl = Math.cos(lat * DEG), sl = Math.sin(lat * DEG);
    const band = b.zonalWind[Math.min(b.LAT - 1, Math.floor((lat + 90) / 2))] / maxU;
    for (let x = 0; x < width; x++) {
      const lon = ((x + .5) / width) * 360 - 180, dx = cl * Math.cos(lon * DEG), dz = cl * Math.sin(lon * DEG);
      let n = 0, a = .5, f = 3.2;
      for (let o = 0; o < 4; o++) { n += a * valueNoise3(dx * f + ox, sl * f + oy, dz * f + oz); a *= .5; f *= 2.1; }
      const c = Math.min(1, Math.max(0, coverFromRain(bilinear(lat, lon)) * 1.3 + (n / .9375 - .5) * .95 - .2));
      const k = 4 * (y * width + x);
      data[k] = Math.round(c * 255); data[k + 1] = Math.round(128 + band * 127); data[k + 2] = 0; data[k + 3] = 255;
    }
  }
  return { width, height, data, zonalWind: b.zonalWind };
}

/** PF-06: per-cell ocean depth factor (0 on land; 0–1 increasing with depth) for depth-aware water shading. */
export function oceanDepthField(planet) {
  const out = new Float32Array(planet.cellCount);
  for (let i = 0; i < planet.cellCount; i++) if (planet.elevation[i] < 0) out[i] = Math.max(.02, 1 - Math.exp(planet.elevation[i] / 1800));
  return out;
}

/**
 * PF-08: per-cell night-light intensity around the generated settlements (cells within 2 mesh rings, falling off
 * with ring distance). No population model exists yet, so every settlement has the same brightness.
 */
export function settlementLightField(planet, rings = 2, weights = null) {
  const out = new Float32Array(planet.cellCount), { offsets, neighbors } = planet.mesh;
  for (const [k, s] of planet.settlements.entries()) {
    const w = weights ? Math.max(0, Math.min(1, weights[k])) : 1; if (!w) continue; // PF-08/15: brightness follows recorded population when given
    let frontier = [s.cell]; const seen = new Set(frontier);
    for (let r = 0; r <= rings && frontier.length; r++) {
      const next = [];
      for (const c of frontier) {
        // ring falloff with a fixed per-cell jitter so a town reads as scattered lights, not a flat disc
        const jitter = .45 + .55 * (((Math.imul(c + 1, 2654435761) >>> 0) % 997) / 997);
        if (planet.elevation[c] >= 0) out[c] = Math.max(out[c], (1 - r / (rings + 1)) * (r ? jitter : 1) * Math.sqrt(w));
        for (let k = offsets[c]; k < offsets[c + 1]; k++) { const nb = neighbors[k]; if (!seen.has(nb)) { seen.add(nb); next.push(nb); } }
      }
      frontier = next;
    }
  }
  return out;
}

/** Sun direction in the planet frame for a subsolar longitude and declination (degrees); lon = atan2(z, x). */
export function sunDirection(subsolarLonDeg, declinationDeg) {
  const lo = subsolarLonDeg * DEG, d = declinationDeg * DEG;
  return [Math.cos(d) * Math.cos(lo), Math.sin(d), Math.cos(d) * Math.sin(lo)];
}
/** Subsolar declination shown for a season selection: equinox for the annual view, ±tilt at the solstice months. */
export const seasonDeclination = (season, tilt) => season === 'jan' ? -tilt : season === 'jul' ? tilt : 0;
