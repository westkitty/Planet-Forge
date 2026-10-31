// Planet Forge world model (version glacial-0.5: tectonic-0.2 relief + climate-0.3 climate + hydro-0.4 rivers, lakes, basins + glacial-0.5 ice-age glacial maximum).
//
// Conceptual approximation, not a geodynamic simulation. The planet is a
// geodesic cell mesh (10f^2+2 cells); plates grow from seeded nuclei, each
// plate rotates rigidly about its own Euler pole, and relief is derived from
// the relative motion across every plate boundary plus a seafloor-age depth
// model. Assumptions, simplifications and sources are documented in
// docs/features/F-0002-tectonic-plates.md; climate in src/climate.js and docs/features/F-0003-climate-circulation.md.
import { hashSeed, rng } from './world.js';
import { computeClimate, BIOMES, KOPPEN } from './climate.js';
import { computeHydrology, RIVER_MIN_M3S, LAKE } from './hydrology.js';
import { computeGlaciation, GLACIAL_CELL } from './glaciation.js';

export { BIOMES, KOPPEN };
export const MODEL_VERSION = 'glacial-0.5';
export const LAKE_TYPES = ['none', 'fresh lake', 'salt lake', 'salt flat'];
export const EARTH_RADIUS_KM = 6371;
export const BOUNDARY = ['none', 'convergent', 'divergent', 'transform'];
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

// ---------- geodesic mesh ----------
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_V = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
const ICO_F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];

/** Geodesic icosphere with frequency f: 10f^2+2 vertices (cells), 20f^2 triangles, CSR adjacency. */
export function geodesicMesh(f) {
  const n = 10 * f * f + 2;
  const pos = new Float64Array(n * 3);
  const put = (k, x, y, z) => { const l = Math.sqrt(x * x + y * y + z * z); pos[3 * k] = x / l; pos[3 * k + 1] = y / l; pos[3 * k + 2] = z / l; };
  ICO_V.forEach((v, k) => put(k, v[0], v[1], v[2]));
  const edgeIndex = new Map(); let next = 12;
  const edgeKey = (a, b) => (a < b ? a * 12 + b : b * 12 + a);
  for (const [a, b, c] of ICO_F) for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    const key = edgeKey(p, q); if (edgeIndex.has(key)) continue;
    const lo = Math.min(p, q), hi = Math.max(p, q), A = ICO_V[lo], B = ICO_V[hi];
    edgeIndex.set(key, next);
    for (let t = 1; t < f; t++) { const s = t / f; put(next++, A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s); }
  }
  const edgePoint = (p, q, t) => { const base = edgeIndex.get(edgeKey(p, q)); return p < q ? base + t - 1 : base + (f - t) - 1; };
  const tris = new Uint32Array(20 * f * f * 3); let tc = 0;
  for (const [a, b, c] of ICO_F) {
    const A = ICO_V[a], B = ICO_V[b], C = ICO_V[c];
    const idx = new Int32Array((f + 1) * (f + 1));
    for (let i = 0; i <= f; i++) for (let j = 0; i + j <= f; j++) {
      let k;
      if (i === 0 && j === 0) k = a; else if (i === f) k = b; else if (j === f) k = c;
      else if (j === 0) k = edgePoint(a, b, i); else if (i === 0) k = edgePoint(a, c, j); else if (i + j === f) k = edgePoint(b, c, j);
      else { k = next++; const u = i / f, v = j / f; put(k, A[0] + (B[0] - A[0]) * u + (C[0] - A[0]) * v, A[1] + (B[1] - A[1]) * u + (C[1] - A[1]) * v, A[2] + (B[2] - A[2]) * u + (C[2] - A[2]) * v); }
      idx[i * (f + 1) + j] = k;
    }
    const at = (i, j) => idx[i * (f + 1) + j];
    const tri = (p, q, r) => {
      // keep counter-clockwise winding seen from outside
      const ax = pos[3 * q] - pos[3 * p], ay = pos[3 * q + 1] - pos[3 * p + 1], az = pos[3 * q + 2] - pos[3 * p + 2];
      const bx = pos[3 * r] - pos[3 * p], by = pos[3 * r + 1] - pos[3 * p + 1], bz = pos[3 * r + 2] - pos[3 * p + 2];
      const d = (ay * bz - az * by) * pos[3 * p] + (az * bx - ax * bz) * pos[3 * p + 1] + (ax * by - ay * bx) * pos[3 * p + 2];
      if (d >= 0) { tris[tc++] = p; tris[tc++] = q; tris[tc++] = r; } else { tris[tc++] = p; tris[tc++] = r; tris[tc++] = q; }
    };
    for (let i = 0; i < f; i++) for (let j = 0; i + j < f; j++) {
      tri(at(i, j), at(i + 1, j), at(i, j + 1));
      if (i + j + 1 < f) tri(at(i + 1, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  if (next !== n || tc !== tris.length) throw new Error('geodesic mesh construction mismatch');
  // CSR adjacency: each undirected edge is shared by two triangles; keep unique neighbours, sorted.
  const tmp = Array.from({ length: n }, () => []);
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const p = tris[t + e], q = tris[t + (e + 1) % 3];
    if (!tmp[p].includes(q)) tmp[p].push(q);
    if (!tmp[q].includes(p)) tmp[q].push(p);
  }
  const offsets = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) offsets[i + 1] = offsets[i] + tmp[i].length;
  const neighbors = new Uint32Array(offsets[n]);
  for (let i = 0; i < n; i++) { tmp[i].sort((x, y) => x - y); neighbors.set(tmp[i], offsets[i]); }
  return { frequency: f, count: n, positions: pos, triangles: tris, offsets, neighbors };
}

// ---------- deterministic value noise (integer hashing, no trig) ----------
function hash3(x, y, z, s) { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ s; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296 * 2 - 1; }
const fade = t => t * t * (3 - 2 * t);
function valueNoise(x, y, z, s) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(hash3(xi, yi, zi, s), hash3(xi + 1, yi, zi, s), u), l(hash3(xi, yi + 1, zi, s), hash3(xi + 1, yi + 1, zi, s), u), v),
    l(l(hash3(xi, yi, zi + 1, s), hash3(xi + 1, yi, zi + 1, s), u), l(hash3(xi, yi + 1, zi + 1, s), hash3(xi + 1, yi + 1, zi + 1, s), u), v), w);
}
export function fbm(x, y, z, s, octaves = 4) { let a = 0, amp = 0.5, fr = 2; for (let o = 0; o < octaves; o++) { a += amp * valueNoise(x * fr, y * fr, z * fr, s + o * 1013); amp *= 0.5; fr *= 2.03; } return a; }

// ---------- min-heap for deterministic priority flood ----------
class Heap {
  constructor() { this.c = []; this.v = []; }
  get size() { return this.c.length; }
  less(i, j) { return this.c[i] < this.c[j] || (this.c[i] === this.c[j] && this.v[i] < this.v[j]); }
  swap(i, j) { [this.c[i], this.c[j]] = [this.c[j], this.c[i]]; [this.v[i], this.v[j]] = [this.v[j], this.v[i]]; }
  push(cost, val) { this.c.push(cost); this.v.push(val); let i = this.c.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (!this.less(i, p)) break; this.swap(i, p); i = p; } }
  pop() { const val = this.v[0], last = this.c.length - 1; this.swap(0, last); this.c.pop(); this.v.pop(); let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < this.c.length && this.less(l, m)) m = l; if (r < this.c.length && this.less(r, m)) m = r; if (m === i) break; this.swap(i, m); i = m; } return val; }
}

// Seafloor depth from crustal age, GDH1 plate model (Stein & Stein 1992). age in Myr, returns metres (positive down).
export function gdh1Depth(age) { return age < 20 ? 2600 + 365 * Math.sqrt(age) : 5651 - 2473 * Math.exp(-0.0278 * age); }

/**
 * Build a deterministic tectonic planet.
 * @param {string} seed
 * @param {{frequency?: number, mesh?: object, tilt?: number}} [opts] geodesic frequency (cells = 10f^2+2; f=100 -> 100,002
 *   cells); axial tilt in degrees (default: seeded 10-35°, drawn from an independent stream so relief does not change)
 */
export function createPlanet(seed, opts = {}) {
  const f = opts.frequency ?? 100;
  const mesh = opts.mesh && opts.mesh.frequency === f ? opts.mesh : geodesicMesh(f);
  const { count: n, positions: P, offsets: O, neighbors: N } = mesh;
  const s32 = hashSeed(seed), random = rng(s32), noiseSeed = s32 | 0;
  const spacingKm = EARTH_RADIUS_KM * Math.sqrt(4 * Math.PI / n) * 1.07; // mean neighbour distance on the mesh

  // 1. Plate nuclei and weighted priority-flood growth (irregular plate sizes).
  const plateCount = 9 + Math.floor(random() * 6);
  const plate = new Int16Array(n).fill(-1);
  const heap = new Heap();
  const growth = [];
  for (let k = 0; k < plateCount; k++) {
    growth.push(0.45 + random() * 1.4);
    let c; do { c = Math.floor(random() * n); } while (plate[c] !== -1);
    plate[c] = k; heap.push(0, c);
  }
  const cost = new Float64Array(n).fill(Infinity);
  for (let i = 0; i < n; i++) if (plate[i] >= 0) cost[i] = 0;
  while (heap.size) {
    const i = heap.pop(), k = plate[i];
    for (let e = O[i]; e < O[i + 1]; e++) {
      const j = N[e]; if (plate[j] !== -1) continue;
      const jx = P[3 * j], jy = P[3 * j + 1], jz = P[3 * j + 2];
      const c = cost[i] + (1 + 0.9 * fbm(jx * 2.2, jy * 2.2, jz * 2.2, noiseSeed ^ 0x51ab)) / growth[k];
      if (plate[j] === -1) { plate[j] = k; cost[j] = c; heap.push(c, j); } // first claim wins (Eden-style growth)
    }
  }

  // 2. Plate kinematics: Euler pole + angular speed (surface speed at 90° from pole, cm/yr), crust type.
  const plates = [];
  const area = new Array(plateCount).fill(0);
  for (let i = 0; i < n; i++) area[plate[i]]++;
  for (let k = 0; k < plateCount; k++) {
    const z = random() * 2 - 1, phi = random() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
    plates.push({ id: k, pole: [r * Math.cos(phi), z, r * Math.sin(phi)], speedCmYr: +(1.5 + random() * 7.5).toFixed(2), density: random(), crust: 'oceanic', cells: area[k] });
  }
  // Continental plates are chosen in seeded order until ~30-42% of the surface is continental crust.
  const target = 0.30 + random() * 0.12;
  const order = plates.map(p => p.id).sort((a, b) => plates[a].density - plates[b].density);
  let contArea = 0;
  for (const k of order) { if (Math.abs(contArea + area[k] - target * n) < Math.abs(contArea - target * n)) { plates[k].crust = 'continental'; contArea += area[k]; } }
  const continental = new Uint8Array(n);
  for (let i = 0; i < n; i++) continental[i] = plates[plate[i]].crust === 'continental' ? 1 : 0;
  // velocity (cm/yr) of cell i: omega x p
  const vel = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    const p = plates[plate[i]], [ax, ay, az] = p.pole, x = P[3 * i], y = P[3 * i + 1], zz = P[3 * i + 2], w = p.speedCmYr;
    vel[3 * i] = w * (ay * zz - az * y); vel[3 * i + 1] = w * (az * x - ax * zz); vel[3 * i + 2] = w * (ax * y - ay * x);
  }

  // 3. Boundary classification from relative motion across each plate-boundary edge.
  const boundary = new Uint8Array(n), bConv = new Float64Array(n), bShear = new Float64Array(n), bOther = new Int16Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    let best = 0;
    for (let e = O[i]; e < O[i + 1]; e++) {
      const j = N[e]; if (plate[j] === plate[i]) continue;
      let nx = P[3 * j] - P[3 * i], ny = P[3 * j + 1] - P[3 * i + 1], nz = P[3 * j + 2] - P[3 * i + 2];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz); nx /= l; ny /= l; nz /= l;
      const rx = vel[3 * i] - vel[3 * j], ry = vel[3 * i + 1] - vel[3 * j + 1], rz = vel[3 * i + 2] - vel[3 * j + 2];
      const conv = rx * nx + ry * ny + rz * nz; // > 0: closing
      const sx = rx - conv * nx, sy = ry - conv * ny, sz = rz - conv * nz, shear = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const mag = Math.abs(conv) + shear;
      if (mag > best || bOther[i] === -1) { best = mag; bConv[i] = conv; bShear[i] = shear; bOther[i] = plate[j]; }
    }
  }
  // Smooth the boundary signals along each plate-pair segment (3 passes over boundary neighbours with the same
  // plate pair) so the zig-zag mesh edges do not flip the classification cell by cell.
  for (let pass = 0; pass < 3; pass++) {
    const c2 = Float64Array.from(bConv), s2 = Float64Array.from(bShear);
    for (let i = 0; i < n; i++) {
      if (bOther[i] < 0) continue;
      let sc = bConv[i], ss = bShear[i], m = 1;
      for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (bOther[j] < 0) continue; const same = plate[j] === plate[i] && bOther[j] === bOther[i], mirror = plate[j] === bOther[i] && bOther[j] === plate[i]; if (same || mirror) { sc += bConv[j]; ss += bShear[j]; m++; } }
      c2[i] = sc / m; s2[i] = ss / m;
    }
    bConv.set(c2); bShear.set(s2);
  }
  for (let i = 0; i < n; i++) if (bOther[i] >= 0) boundary[i] = Math.abs(bConv[i]) >= bShear[i] ? (bConv[i] > 0 ? 1 : 2) : 3;

  // 4. Multi-source BFS: hop distance to nearest boundary cell, carrying that boundary's source cell.
  const dist = new Int32Array(n).fill(-1), src = new Int32Array(n).fill(-1);
  let queue = new Int32Array(n), qh = 0, qt = 0;
  for (let i = 0; i < n; i++) if (boundary[i]) { dist[i] = 0; src[i] = i; queue[qt++] = i; }
  while (qh < qt) { const i = queue[qh++]; for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e]; if (dist[j] !== -1 || plate[j] !== plate[i]) continue; dist[j] = dist[i] + 1; src[j] = src[i]; queue[qt++] = j; } }

  // 5. Seafloor age: distance from the nearest divergent boundary through oceanic crust / half spreading rate.
  const age = new Float32Array(n).fill(NaN);
  const ageCost = new Float64Array(n).fill(Infinity);
  const ridgeRate = new Float64Array(n); // half spreading rate (km/Myr) of the ridge each cell's crust came from
  const ah = new Heap();
  for (let i = 0; i < n; i++) if (!continental[i] && boundary[i] === 2) {
    ridgeRate[i] = Math.max(0.5, Math.abs(bConv[i]) / 2) * 10; // 1 cm/yr = 10 km/Myr; floor avoids divide-by-zero
    ageCost[i] = 0; ah.push(0, i);
  }
  while (ah.size) {
    const i = ah.pop();
    for (let e = O[i]; e < O[i + 1]; e++) {
      const j = N[e]; if (continental[j] || plate[j] !== plate[i]) continue;
      const c = ageCost[i] + spacingKm / ridgeRate[i];
      if (c < ageCost[j]) { ageCost[j] = c; ridgeRate[j] = ridgeRate[i]; ah.push(c, j); }
    }
  }
  for (let i = 0; i < n; i++) if (!continental[i]) age[i] = Number.isFinite(ageCost[i]) ? Math.min(200, ageCost[i]) : 180;

  // 6. Relief.
  const elevation = new Int16Array(n);
  const gauss = (d, w) => Math.exp(-(d * d) / (w * w));
  for (let i = 0; i < n; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    const detail = fbm(x * 3, y * 3, z * 3, noiseSeed ^ 0x2f61, 5);
    const regional = fbm(x * 1.3, y * 1.3, z * 1.3, noiseSeed ^ 0x4c1d, 3); // basins, shields and shallow seas
    let h = continental[i] ? 420 + 1100 * regional + 450 * detail : -gdh1Depth(age[i]) + 350 * detail;
    const b = src[i];
    if (b >= 0) {
      const d = dist[i] * spacingKm, conv = bConv[b], shear = bShear[b], type = boundary[b];
      const otherCont = plates[bOther[b]].crust === 'continental', selfCont = !!continental[i];
      const s = clamp(Math.abs(conv) / 5, 0.25, 1.6);
      if (type === 1) {
        if (selfCont && otherCont) h += 4800 * s * gauss(d, 380);                          // collision orogen
        else if (!selfCont && otherCont) h -= 2400 * Math.min(s, 1.2) * gauss(d, 90);                    // trench on subducting oceanic plate
        else if (selfCont && !otherCont) h += 3600 * s * gauss(d - 180, 160);              // continental volcanic arc
        else {                                                                              // ocean-ocean: denser plate subducts
          const sub = plates[plate[i]].density > plates[bOther[b]].density;
          h += sub ? -2400 * Math.min(s, 1.2) * gauss(d, 80) : 4200 * s * gauss(d - 110, 90);              // trench / island arc
        }
      } else if (type === 2) {
        if (selfCont) h -= (otherCont ? 1400 : 900) * s * gauss(d, 140);                   // continental rift / passive margin
      } else {
        h += 500 * s * gauss(d, 70) * (detail > 0 ? 1 : -1);                               // transform relief
      }
      // passive continental margins slope down into oceanic crust
      if (selfCont && !otherCont && type !== 1) h -= 1100 * gauss(Math.max(0, d + 260 * regional), 240);
    }
    elevation[i] = Math.round(clamp(h, -11000, 8800));
  }

  // 7. Climate: energy balance, seasonal circulation, moisture advection with rain shadows, Köppen and biomes.
  const lat = new Float64Array(n), lon = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = P[3 * i], y = P[3 * i + 1], z = P[3 * i + 2];
    lat[i] = Math.round(Math.asin(clamp(y, -1, 1)) * 18000 / Math.PI) / 100; lon[i] = Math.round(Math.atan2(z, x) * 18000 / Math.PI) / 100;
  }
  const tilt = opts.tilt ?? Math.round((10 + rng(s32 ^ 0x7117c0de)() * 25) * 100) / 100;
  const climate = computeClimate({ mesh, elevation, lat, spacingKm, noise: i => fbm(P[3 * i] * 2, P[3 * i + 1] * 2, P[3 * i + 2] * 2, noiseSeed ^ 0x77) }, tilt);
  const { temperature, rainfall, biome } = climate;

  // 8. Hydrology: runoff, Priority-Flood drainage, rivers, lakes with water balance, basins.
  const cellAreaKm2 = 4 * Math.PI * EARTH_RADIUS_KM ** 2 / n;
  const hydro = computeHydrology({ mesh, elevation, lat, climate, tilt, spacingKm, cellAreaKm2, seedHash: s32 });
  // 8b. Glacial maximum: orbital + CO2 forcing, ice-sheet mass balance and albedo feedback, sea-level fall, land bridges.
  const glaciation = computeGlaciation({ mesh, elevation, lat, climate, tilt, spacingKm, cellAreaKm2, seedHash: s32 });
  const riverOfBasin = new Map(hydro.rivers.map(r => [hydro.basin[r.mouth], r]));
  // fresh water within one cell: a river (discharge >= threshold) or a fresh lake
  const waterAt = i => { let best = null; for (const j of [i, ...N.subarray(O[i], O[i + 1])]) { if (hydro.lake[j] === LAKE.fresh) return 'lake'; if (hydro.discharge[j] >= RIVER_MIN_M3S / 3 && !best) best = 'river'; } return best; };

  // 9. Settlements on habitable land cells with fresh water (river or fresh lake), tectonic setting recorded.
  const names = ['Aster', 'Vela', 'Orin', 'Keth', 'Nadir', 'Sora', 'Mira', 'Eris'];
  const settlements = []; let attempts = 0;
  while (settlements.length < 8 && attempts < 6000) {
    attempts++;
    const i = Math.floor(random() * n);
    const el = elevation[i];
    if (!(el > 0 && el < 1800 && temperature[i] > 3 && rainfall[i] > 300) || hydro.lake[i]) continue;
    const water = waterAt(i); if (!water && attempts < 4500) continue; // after 4,500 tries accept rain-fed sites
    const far = settlements.every(st => { const j = st.cell; return P[3 * i] * P[3 * j] + P[3 * i + 1] * P[3 * j + 1] + P[3 * i + 2] * P[3 * j + 2] < Math.cos(24 * Math.PI / 180); });
    if (!far) continue;
    const setting = src[i] >= 0 && dist[i] * spacingKm < 500 ? BOUNDARY[boundary[src[i]]] + ' margin' : 'plate interior';
    const riv = riverOfBasin.get(hydro.basin[i]);
    const waterText = water === 'lake' ? 'lakeshore' : water === 'river' ? (riv && !riv.endorheic ? 'on the ' + riv.name + ' system' : riv ? 'in the ' + riv.name + ' basin' : 'riverside') : 'rain-fed';
    settlements.push({ name: names[settlements.length], cell: i, water: waterText, lat: Math.round(lat[i] * 10) / 10, lon: Math.round(lon[i] * 10) / 10, founded: Math.floor(random() * 1400) + 100, biome: BIOMES[biome[i]], climate: KOPPEN[climate.koppen[i]], setting });
  }
  const timeline = settlements.map(t => ({ year: t.founded, event: `${t.name} founded ${t.water === 'rain-fed' ? '' : t.water + ', '}in ${t.biome.toLowerCase()} (${t.climate} climate, ${t.setting})` })).sort((a, b) => a.year - b.year || a.event.localeCompare(b.event));

  return { seed: String(seed), version: MODEL_VERSION, frequency: f, cellCount: n, spacingKm, mesh, plates, plate, continental, boundary, boundaryConvergence: bConv, boundaryDistance: dist, seafloorAge: age, elevation, tilt, climate, temperature, rainfall, biome, koppen: climate.koppen, hydro, glaciation, cellAreaKm2, lat, lon, settlements, timeline, prehistory: prehistoryText(glaciation) };
}

function prehistoryText(g) {
  const s = g.stats;
  return `Last glacial maximum: obliquity fell to ${s.obliquityMinDeg}° and CO2 to 190 ppm; the world cooled ${s.globalCoolingK} K, ice sheets covered ${(s.glacialIceFraction * 100).toFixed(1)}% of the surface and the sea fell ${s.seaLevelFallM} m` + (s.landBridges ? `, opening ${s.landBridges} land bridge${s.landBridges > 1 ? 's' : ''}` : ', but no land bridges opened') + '.';
}

/** Plain-object view of one cell, used for inspection and export. */
const GLACIAL_NAMES = ['unglaciated', 'glacial ice sheet', 'exposed glacial shelf', 'glacial land bridge', 'present ice, retreated at glacial'];
export function cellInfo(planet, i) {
  const p = planet.plates[planet.plate[i]];
  const tm = Array.from(planet.climate.temperatureMonthly.subarray(12 * i, 12 * i + 12));
  const info = { cell: i, lat: planet.lat[i], lon: planet.lon[i], elevation: planet.elevation[i], temperature: planet.temperature[i], temperatureJan: tm[0], temperatureJul: tm[6], rainfall: planet.rainfall[i], koppen: KOPPEN[planet.koppen[i]], biome: BIOMES[planet.biome[i]], plate: p.id, crust: p.crust, boundary: BOUNDARY[planet.boundary[i]] };
  if (!planet.continental[i]) info.seafloorAgeMyr = Math.round(planet.seafloorAge[i]);
  const h = planet.hydro;
  if (planet.elevation[i] >= 0) {
    info.runoffMm = h.runoff[i]; info.petMm = h.pet[i]; info.dischargeM3s = Math.round(h.discharge[i]);
    const b = h.basins[h.basin[i]], r = h.rivers.find(x => h.basin[x.mouth] === h.basin[i]);
    info.basin = (r ? r.name : (b.endorheic ? 'unnamed endorheic' : 'unnamed coastal')) + (b.endorheic ? ' (endorheic)' : '');
    info.basinKm2 = Math.round(b.cells * planet.cellAreaKm2);
    if (h.lake[i]) info.lake = LAKE_TYPES[h.lake[i]];
  }
  const g = planet.glaciation;
  if (g) { info.glacial = GLACIAL_NAMES[g.cell[i]]; if (g.thickness[i]) info.glacialIceM = g.thickness[i]; if (g.presentThickness[i]) info.presentIceM = g.presentThickness[i]; }
  return info;
}

/** Summary statistics used by the UI, the seed report and tests. */
export function planetSummary(planet) {
  const n = planet.cellCount; let land = 0; const bt = [0, 0, 0, 0]; let maxEl = -1e9, minEl = 1e9;
  for (let i = 0; i < n; i++) { if (planet.elevation[i] >= 0) land++; bt[planet.boundary[i]]++; maxEl = Math.max(maxEl, planet.elevation[i]); minEl = Math.min(minEl, planet.elevation[i]); }
  const kc = {}; let pSum = 0, tSum = 0;
  for (let i = 0; i < n; i++) { pSum += planet.rainfall[i]; tSum += planet.temperature[i]; if (planet.koppen[i]) { const k = KOPPEN[planet.koppen[i]][0]; kc[k] = (kc[k] || 0) + 1; } }
  const hs = planet.hydro.stats, gs = planet.glaciation.stats;
  return { glaciation: { globalCoolingK: gs.globalCoolingK, seaLevelFallM: gs.seaLevelFallM, glacialIceFraction: Math.round(gs.glacialIceFraction * 1000) / 1000, presentIceFraction: Math.round(gs.presentIceFraction * 1000) / 1000, glacialIceVolumeKm3: gs.glacialIceVolumeKm3, landBridges: gs.landBridges, landmassesJoined: gs.landmassesJoined, exposedShelfKm2: gs.exposedShelfKm2 }, hydrology: { riverCells: hs.riverCells, endorheicLandFraction: Math.round(hs.endorheicFraction * 1000) / 1000, runoffRatio: Math.round(hs.runoffRatio * 1000) / 1000, freshLakes: hs.freshLakes, saltLakes: hs.saltLakes, toSeaM3s: hs.toSeaM3s, largestRiver: planet.hydro.rivers[0] ? planet.hydro.rivers[0].name : null }, cells: n, plates: planet.plates.length, tilt: planet.tilt, meanTemperature: Math.round(tSum / n * 10) / 10, meanPrecipitation: Math.round(pSum / n), koppenGroups: kc, landFraction: land / n, continentalFraction: planet.continental.reduce((a, b) => a + b, 0) / n, boundaryCells: { convergent: bt[1], divergent: bt[2], transform: bt[3] }, maxElevation: maxEl, minElevation: minEl };
}
