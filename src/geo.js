// Geodesic helpers over the authoritative cell mesh (PF-10, PF-27, PF-31). Pure functions; no rendering, no writes.
export const EARTH_RADIUS_KM = 6371;
const dot3 = (P, i, d) => P[3 * i] * d[0] + P[3 * i + 1] * d[1] + P[3 * i + 2] * d[2];

/**
 * Nearest cell to a unit direction by greedy walk over mesh adjacency (start anywhere; a warm start from the previous
 * pick makes hover picking O(1)-ish). On a convex geodesic mesh the walk reaches the true nearest cell.
 */
export function nearestCell(mesh, d, start = 0) {
  const P = mesh.positions, O = mesh.offsets, N = mesh.neighbors;
  let best = start, bd = dot3(P, start, d);
  for (let moved = true; moved;) {
    moved = false;
    for (let e = O[best]; e < O[best + 1]; e++) { const j = N[e], v = dot3(P, j, d); if (v > bd) { bd = v; best = j; moved = true; } }
  }
  return best;
}
/** Brute-force reference used by tests. */
export function nearestCellBrute(mesh, d) { let best = 0, bd = -2; for (let i = 0; i < mesh.count; i++) { const v = dot3(mesh.positions, i, d); if (v > bd) { bd = v; best = i; } } return best; }

export const cellDir = (mesh, i) => [mesh.positions[3 * i], mesh.positions[3 * i + 1], mesh.positions[3 * i + 2]];
export const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
export function latLonToDir(lat, lon) { const la = lat * Math.PI / 180, lo = lon * Math.PI / 180; return [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)]; }

/** Points along the great circle from a to b (unit vectors), `n` ≥ 2 samples inclusive of both ends. */
export function greatCircle(a, b, n) {
  const w = angleBetween(a, b), out = [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    if (w < 1e-9) { out.push(a.slice()); continue; }
    const s1 = Math.sin((1 - t) * w) / Math.sin(w), s2 = Math.sin(t * w) / Math.sin(w);
    const v = [s1 * a[0] + s2 * b[0], s1 * a[1] + s2 * b[1], s1 * a[2] + s2 * b[2]], l = Math.hypot(...v);
    out.push([v[0] / l, v[1] / l, v[2] / l]);
  }
  return out;
}

/** Multi-source breadth-first ring distance over the mesh (Int32, −1 = unreached or beyond maxRings). */
export function ringDistance(mesh, isSource, maxRings = Infinity) {
  const n = mesh.count, d = new Int32Array(n).fill(-1), q = new Int32Array(n); let h = 0, t = 0;
  for (let i = 0; i < n; i++) if (isSource(i)) { d[i] = 0; q[t++] = i; }
  while (h < t) {
    const i = q[h++]; if (d[i] >= maxRings) continue;
    for (let e = mesh.offsets[i]; e < mesh.offsets[i + 1]; e++) { const j = mesh.neighbors[e]; if (d[j] < 0) { d[j] = d[i] + 1; q[t++] = j; } }
  }
  return d;
}

/** Ray from `origin` along unit `dir` against a sphere of radius r at the origin: nearest hit point or null. */
export function raySphere(origin, dir, r) {
  const b = origin[0] * dir[0] + origin[1] * dir[1] + origin[2] * dir[2], c = origin[0] ** 2 + origin[1] ** 2 + origin[2] ** 2 - r * r, disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc); if (t < 0) return null;
  return [origin[0] + t * dir[0], origin[1] + t * dir[1], origin[2] + t * dir[2]];
}
/**
 * Surface pick in planet-local coordinates: intersect the ray with the sphere through the candidate cell's displayed
 * radius and re-pick, so relief is honoured at the limb. `radiusOf(cell)` gives the displayed radius.
 */
export function pickSurface(mesh, originLocal, dirLocal, radiusOf, start = 0) {
  let r = 1.04, cell = -1;
  for (let it = 0; it < 4; it++) {
    const hit = raySphere(originLocal, dirLocal, r);
    if (!hit) { if (cell < 0 && it === 0) { r = 1; continue; } break; }
    const l = Math.hypot(...hit), next = nearestCell(mesh, [hit[0] / l, hit[1] / l, hit[2] / l], cell < 0 ? start : cell);
    const nr = radiusOf(next);
    if (next === cell && Math.abs(nr - r) < 1e-6) break;
    cell = next; r = nr;
  }
  return cell;
}
