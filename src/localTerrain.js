// Milestone 6 local terrain (PF-19 surface, PF-32 seafloor). Pure and deterministic. A local patch of about
// 4 × 4 mesh cells (≈ 300 km) around a selected cell is resampled onto a grid: the large-scale height is the
// authoritative cell elevation interpolated from the nearest cells (inverse-distance), and only the small-scale detail
// is procedural value noise seeded by the cell id, with an amplitude tied to the local relief. The detail is
// illustrative: the world model does not resolve features smaller than its ≈ 75 km cells.
import { cellDir, nearestCell, ringDistance, EARTH_RADIUS_KM } from './geo.js';
import { valueNoise3 } from './surfaceFields.js';
import { BIOMES } from './planet.js';
import { RIVER_MIN_M3S } from './hydrology.js';

export const GRID = 96;
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const nrm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

export function buildPatch(p, cell, { kind = 'surface', spanCells = 4 } = {}) {
  const c = cellDir(p.mesh, cell), east = nrm(cross([0, 1, 0], c).some(Math.abs) ? cross([0, 1, 0], c) : [1, 0, 0]), north = cross(c, east);
  const spanKm = p.spacingKm * spanCells, near = ringDistance(p.mesh, i => i === cell, spanCells + 2), cand = [];
  for (let i = 0; i < p.cellCount; i++) if (near[i] >= 0) cand.push(i);
  // relief: spread of elevations within two rings sets the procedural detail amplitude (≥ 40 m, ≤ 600 m)
  const ring2 = cand.filter(i => near[i] <= 2), mean = ring2.reduce((s, i) => s + p.elevation[i], 0) / ring2.length;
  const relief = Math.max(40, Math.min(600, Math.sqrt(ring2.reduce((s, i) => s + (p.elevation[i] - mean) ** 2, 0) / ring2.length) * .5));
  const height = new Float32Array(GRID * GRID), cellOf = new Int32Array(GRID * GRID), seed = cell * .0137;
  let prev = cell;
  for (let gy = 0; gy < GRID; gy++) for (let gx = 0; gx < GRID; gx++) {
    const u = (gx / (GRID - 1) - .5) * spanKm / EARTH_RADIUS_KM, v = (gy / (GRID - 1) - .5) * spanKm / EARTH_RADIUS_KM;
    const d = nrm([c[0] + east[0] * u + north[0] * v, c[1] + east[1] * u + north[1] * v, c[2] + east[2] * u + north[2] * v]);
    prev = nearestCell(p.mesh, d, prev);
    let ws = 0, hs = 0; // inverse-distance blend of the nearest cell and its neighbours
    const nb = [prev]; for (let e = p.mesh.offsets[prev]; e < p.mesh.offsets[prev + 1]; e++) nb.push(p.mesh.neighbors[e]);
    for (const j of nb) { const cd = cellDir(p.mesh, j), dist = Math.acos(Math.max(-1, Math.min(1, cd[0] * d[0] + cd[1] * d[1] + cd[2] * d[2]))) + 1e-5, w = 1 / (dist * dist); ws += w; hs += w * p.elevation[j]; }
    let n = 0, a = .5, f = 1; for (let o = 0; o < 5; o++) { n += a * (valueNoise3(gx * .09 * f + seed, gy * .09 * f, seed * 3.1) - .5); a *= .5; f *= 2.05; }
    height[gy * GRID + gx] = hs / ws + n * 2 * relief; cellOf[gy * GRID + gx] = prev;
  }
  const centre = cellOf[(GRID >> 1) * GRID + (GRID >> 1)];
  return { cell, kind, spanKm, grid: GRID, height, cellOf, relief: Math.round(relief), centreCell: centre, authoritativeM: Math.round(p.elevation[cell]),
    biome: BIOMES[p.biome[cell]], note: `Large-scale height: the world's cell elevations (±${Math.round(p.spacingKm)} km cells). Fine detail (±${Math.round(relief)} m) is procedural and illustrative.` };
}
export const heightAt = (patch, x, y) => { // x, y in grid units (bilinear)
  const g = patch.grid, cx = Math.max(0, Math.min(g - 1.001, x)), cy = Math.max(0, Math.min(g - 1.001, y)), x0 = Math.floor(cx), y0 = Math.floor(cy), fx = cx - x0, fy = cy - y0, H = patch.height;
  return (H[y0 * g + x0] * (1 - fx) + H[y0 * g + x0 + 1] * fx) * (1 - fy) + (H[(y0 + 1) * g + x0] * (1 - fx) + H[(y0 + 1) * g + x0 + 1] * fx) * fy;
};

/** Deterministic sample/discovery sites derived from the cells under the patch. */
export function sites(p, patch) {
  const out = [], seen = new Set(), g = patch.grid;
  for (let k = 0; k < g * g && out.length < 6; k += 397) {
    const i = patch.cellOf[k]; const x = k % g, y = Math.floor(k / g); if (x < 6 || y < 6 || x > g - 7 || y > g - 7) continue;
    const el = p.elevation[i]; let type, info;
    if (patch.kind === 'ocean') {
      if (el >= 0) continue;
      if (p.boundary[i] === 2) { type = 'hydrothermal vent'; info = `divergent boundary, seafloor ≈ ${Math.round(p.seafloorAge[i])} Myr`; }
      else if (p.boundary[i] === 1) { type = 'trench sediment'; info = `convergent margin, ${Math.round(-el)} m deep`; }
      else { type = 'basalt sample'; info = `oceanic crust ≈ ${Math.round(p.seafloorAge[i])} Myr old`; }
    } else {
      if (el < 0) continue;
      if (p.hydro.discharge[i] >= RIVER_MIN_M3S) { type = 'river sediment'; info = `${Math.round(p.hydro.discharge[i]).toLocaleString('en-US')} m³/s channel`; }
      else if (p.boundary[i]) { type = 'deformed rock'; info = `plate boundary (${['', 'convergent', 'divergent', 'transform'][p.boundary[i]]})`; }
      else { type = p.continental[i] ? 'granitic rock' : 'basalt'; info = `${BIOMES[p.biome[i]]}, ${Math.round(el)} m`; }
    }
    const key = type + i; if (seen.has(key)) continue; seen.add(key);
    out.push({ x, y, cell: i, type, info });
  }
  return out;
}
export const PRESSURE = { rho: 1025, g: 9.81 }; // seawater density kg m⁻³, gravity m s⁻²
export const pressureBar = depthM => PRESSURE.rho * PRESSURE.g * depthM / 1e5 + 1.013;

/** Vehicle rules (gameplay approximations, shown to players). */
export const VEHICLES = {
  rover: { speedGridPerS: 6, energy: 100, perGrid: .12, slopePenalty: .002, collectRadius: 2.5, text: ['Energy 100; each grid step (≈ 3 km) costs 0.12, plus 0.002 per metre climbed.', 'Collect a sample by driving within 2.5 grid steps of a site.', 'Mission: collect three samples and return to the lander before energy runs out.'] },
  sub: { speedGridPerS: 4, depthRate: 300, energy: 100, perGrid: .08, perMetre: .004, crushDepth: 6500, collectRadius: 3, text: ['Energy 100; each horizontal grid step costs 0.08, each metre of descent or ascent 0.004.', 'Hull rated to 6,500 m (≈ 655 bar): deeper water is unreachable.', 'Pressure = ρgh with ρ = 1,025 kg/m³ and g = 9.81 m/s², plus 1 atm.', 'Mission: reach the seafloor, collect two samples and surface before energy runs out.'] }
};
/** Advance a vehicle state one step given input { dx, dy, dz } (grid units / metres); returns a new state. */
export function moveVehicle(patch, siteList, s, input, kind) {
  if (s.over) return s;
  const V = VEHICLES[kind], nx = Math.max(1, Math.min(patch.grid - 2, s.x + input.dx)), ny = Math.max(1, Math.min(patch.grid - 2, s.y + input.dy));
  const dist = Math.hypot(nx - s.x, ny - s.y); let energy = s.energy - dist * V.perGrid, depth = s.depth, log = s.log.slice();
  if (kind === 'rover') { const climb = Math.max(0, heightAt(patch, nx, ny) - heightAt(patch, s.x, s.y)); energy -= climb * V.slopePenalty; }
  else {
    const floor = -heightAt(patch, nx, ny), want = Math.max(0, Math.min(floor - 2, depth + (input.dz || 0)));
    if (want > V.crushDepth) { log.push('Hull limit: cannot go below 6,500 m.'); }
    const nd = Math.min(want, V.crushDepth); energy -= Math.abs(nd - depth) * V.perMetre; depth = nd;
  }
  const collected = s.collected.slice();
  siteList.forEach((t, k) => { if (!collected.includes(k) && Math.hypot(t.x - nx, t.y - ny) <= V.collectRadius && (kind === 'rover' || depth >= -heightAt(patch, t.x, t.y) - 30)) { collected.push(k); log.push(`Collected ${t.type} (${t.info}).`); } });
  const home = Math.hypot(nx - s.home[0], ny - s.home[1]) < 2.5, need = kind === 'rover' ? 3 : 2;
  let over = false, won = false;
  if (energy <= 0) { over = true; energy = 0; log.push('Energy exhausted: mission failed.'); }
  else if (collected.length >= Math.min(need, siteList.length) && (kind === 'rover' ? home : depth <= 1)) { over = true; won = true; log.push(kind === 'rover' ? 'Back at the lander with the samples: mission complete.' : 'Surfaced with the samples: mission complete.'); }
  return { ...s, x: nx, y: ny, depth, energy: Math.round(energy * 100) / 100, collected, log, over, won };
}
export function newVehicle(patch, kind) { const m = patch.grid >> 1; return { x: m, y: m, home: [m, m], depth: 0, energy: VEHICLES[kind === 'ocean' ? 'sub' : 'rover'].energy, collected: [], log: [], over: false, won: false }; }
