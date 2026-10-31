// PF-04 Constellation cartography: player-authored patterns over the PF-01 catalogue. Only stars brighter than
// PICK_MAG (visible on every quality tier) can be used, and patterns store catalogue ids, so they are identical on
// every tier and after reload. These are the player's own figures, not real astronomical constellations.
export const PICK_MAG = 4.5;
export function addEdge(c, a, b, magnitude) {
  if (a === b) return { c, error: 'a line needs two different stars' };
  for (const s of [a, b]) if (!(magnitude[s] < PICK_MAG)) return { c, error: 'only stars brighter than magnitude 4.5 can be used' };
  if (c.edges.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return { c, error: 'that line already exists' };
  if (c.edges.length >= 40) return { c, error: 'a constellation can have at most 40 lines' };
  return { c: { ...c, edges: [...c.edges, [a, b]] } };
}
export function validateConstellation(c) {
  if (!c.name || !c.name.trim() || c.name.length > 40) return 'name it (1–40 characters)';
  if (c.edges.length < 2) return 'draw at least two lines';
  return null;
}
export const starsOf = c => [...new Set(c.edges.flat())];
