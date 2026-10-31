// Shared gameplay machinery (Milestone 3+). Gameplay never writes to the world: it reads the arrays and keeps its own
// state. Randomness comes only from a seeded stream derived from the world seed + scenario id + gameplay seed, so the
// same world, scenario and decisions always replay to the same outcome.
import { hashSeed, rng } from '../world.js';
import { EARTH_RADIUS_KM } from '../geo.js';

export const gameRng = (worldSeed, scenario, gameSeed = 0) => rng(hashSeed(`${worldSeed}|${scenario}|${gameSeed}`));
export const stepKm = (mesh, a, b) => {
  const P = mesh.positions, d = P[3 * a] * P[3 * b] + P[3 * a + 1] * P[3 * b + 1] + P[3 * a + 2] * P[3 * b + 2];
  return Math.acos(Math.max(-1, Math.min(1, d))) * EARTH_RADIUS_KM;
};

/** Binary-heap Dijkstra over the cell mesh. cost(from, to) returns a step cost or Infinity (impassable). */
export function shortestPath(mesh, from, to, cost, { maxCost = Infinity } = {}) {
  const n = mesh.count, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), O = mesh.offsets, N = mesh.neighbors;
  const heap = [], push = (d, i) => { heap.push([d, i]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  dist[from] = 0; push(0, from);
  while (heap.length) {
    const [d, i] = pop(); if (d > dist[i]) continue; if (i === to) break; if (d > maxCost) break;
    for (let e = O[i]; e < O[i + 1]; e++) { const j = N[e], c = cost(i, j); if (!(c < Infinity)) continue; const nd = d + c; if (nd < dist[j]) { dist[j] = nd; prev[j] = i; push(nd, j); } }
  }
  if (!(dist[to] < Infinity)) return null;
  const path = []; for (let c = to; c >= 0; c = prev[c]) path.push(c);
  return { path: path.reverse(), cost: dist[to] };
}
/** Cells reachable from `from` under a passability rule (BFS); returns a Uint8Array mask. */
export function reachable(mesh, from, passable) {
  const seen = new Uint8Array(mesh.count), q = [from]; seen[from] = 1;
  for (let h = 0; h < q.length; h++) { const i = q[h]; for (let e = mesh.offsets[i]; e < mesh.offsets[i + 1]; e++) { const j = mesh.neighbors[e]; if (!seen[j] && passable(j)) { seen[j] = 1; q.push(j); } } }
  return seen;
}
export const monthName = m => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][((m % 12) + 12) % 12];
