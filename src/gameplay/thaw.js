// PF-14 The Great Thaw. A migrating band must cross a glacial land bridge before the rising sea closes it.
// The model computes two states only: the glacial maximum and today. Between them this mode uses a DECLARED gameplay
// approximation: sea level rises linearly from the glacial low stand to today over RULES.turns turns, and a cell is
// passable when its present-day elevation is above the current sea level and it is not glacial ice. This is not a
// simulated deglaciation.
import { GLACIAL_CELL, GLACIAL } from '../glaciation.js';
import { shortestPath, reachable, gameRng } from './core.js';

export const RULES = { turns: 24, people: 40, startSupplies: 400, marchCells: 6, steadyCells: 3,
  text: ['Sea level rises in equal steps from the glacial low stand to today over 24 turns (a gameplay approximation; the model only computes the two end states).', 'A cell is passable while its present-day elevation is above the current sea level and it is not under an ice sheet.', 'Each turn the band eats one ration per person. Steady travel moves 3 cells and forages; forced marches move 6 cells but forage nothing; resting forages twice.', 'Foraging yields rations from the cell\'s present-day rainfall and warmth (more in wet, mild places).', 'Victory: reach the far landmass. Defeat: rations run out, or no passable route remains.'] };

const seaAt = (g, turn) => -g.stats.seaLevelFallM * (1 - turn / RULES.turns); // metres relative to today's sea level
export function passableAt(p, g, turn) { const s = seaAt(g, turn); return i => p.elevation[i] > s && g.cell[i] !== GLACIAL_CELL.ice && !p.hydro.lake[i]; }

/** Find a scenario: a bridge whose two sides are separate landmasses today. Returns null if the world has none. */
export function setupThaw(p) {
  const g = p.glaciation; if (!g.bridges.length) return null;
  const today = i => p.elevation[i] >= 0 && !p.hydro.lake[i], open = passableAt(p, g, 0), sizeOf = m => m.reduce((s, v) => s + v, 0);
  // start: the largest present-day landmass touching a bridge cell
  let start = -1, startMask = null, best = 0; const tried = new Uint8Array(p.cellCount);
  for (let c = 0; c < p.cellCount; c++) {
    if (g.cell[c] !== GLACIAL_CELL.bridge) continue;
    for (let e = p.mesh.offsets[c]; e < p.mesh.offsets[c + 1]; e++) { const j = p.mesh.neighbors[e]; if (!today(j) || tried[j]) continue; const m = reachable(p.mesh, j, today); for (let k = 0; k < m.length; k++) if (m[k]) tried[k] = 1; const n = sizeOf(m); if (n > best) { best = n; start = j; startMask = m; } }
  }
  if (start < 0) return null;
  // goal: the largest other present-day landmass joined to the start only in the glacial world
  const glacial = reachable(p.mesh, start, open), done = new Uint8Array(p.cellCount); let goal = -1, goalMask = null, gBest = 0;
  for (let i = 0; i < p.cellCount; i++) {
    if (!glacial[i] || startMask[i] || done[i] || !today(i)) continue;
    const m = reachable(p.mesh, i, today); for (let k = 0; k < m.length; k++) if (m[k]) done[k] = 1; const n = sizeOf(m); if (n > gBest) { gBest = n; goal = i; goalMask = m; }
  }
  if (goal < 0 || gBest < GLACIAL.landmassMinCells) return null; // the glaciation model's own landmass threshold
  return { bridge: g.bridges[0].name, start, goal, goalLandmassCells: gBest, startLandmassCells: best, goalMask, seaFallM: g.stats.seaLevelFallM };
}
export function newThaw(setup) { return { turn: 0, at: setup.start, people: RULES.people, supplies: RULES.startSupplies, log: [], over: false, won: false }; }
function forage(p, i, rand) { const wet = Math.min(1, p.rainfall[i] / 1500), warm = Math.max(0, Math.min(1, (p.temperature[i] + 5) / 25)); return Math.round(RULES.people * (.4 + 1.2 * wet * warm) * (.75 + .5 * rand())); }

/** Advance one turn with the band's choice: 'march' | 'steady' | 'rest'. */
export function thawTurn(p, setup, s, choice, gameSeed = 0) {
  if (s.over) return s;
  const g = p.glaciation, rand = gameRng(p.seed, 'thaw:' + setup.bridge, `${gameSeed}:${s.turn}:${choice}`), ok = passableAt(p, g, s.turn);
  const route = shortestPath(p.mesh, s.at, setup.goal, (a, c) => ok(c) ? 1 : Infinity);
  const log = [...s.log], next = { ...s, turn: s.turn + 1, log };
  if (!route) { log.push({ turn: s.turn, text: `The sea has cut the crossing (sea level ${Math.round(seaAt(g, s.turn))} m). No route remains.` }); return { ...next, over: true, won: false }; }
  const steps = choice === 'march' ? RULES.marchCells : choice === 'steady' ? RULES.steadyCells : 0;
  const path = route.path.slice(0, steps + 1), at = path[path.length - 1];
  let food = s.supplies - s.people, gain = 0;
  if (choice !== 'march') { gain = forage(p, at, rand) * (choice === 'rest' ? 2 : 1); food += gain; }
  log.push({ turn: s.turn, text: `Turn ${s.turn + 1}: ${choice}, moved ${path.length - 1} cells, foraged ${gain}; sea at ${Math.round(seaAt(g, s.turn + 1))} m; ${Math.max(0, food)} rations left.`, cell: at });
  if (setup.goalMask[at]) { log.push({ turn: s.turn, text: `The band reached the far shore after ${s.turn + 1} turns.` }); return { ...next, at, supplies: food, over: true, won: true }; }
  if (food <= 0) { log.push({ turn: s.turn, text: 'The rations ran out.' }); return { ...next, at, supplies: 0, over: true, won: false }; }
  if (next.turn >= RULES.turns) { log.push({ turn: s.turn, text: 'The sea reached its present level before the band crossed.' }); return { ...next, at, supplies: food, over: true, won: false }; }
  return { ...next, at, supplies: food };
}
