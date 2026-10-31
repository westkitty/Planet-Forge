// PF-13 gameplay state, persistence and undo/redo. Gameplay state is separate from the scientific world: a save stores
// the world's seed, tilt and model version (enough to regenerate it exactly) plus player state, never world arrays.
// Every change goes through apply(action), so it is recorded in the event log and can be undone and redone.
export const SAVE_SCHEMA = 'planet-forge-save';
export const SAVE_VERSION = 1;
const MAX_BYTES = 2_000_000, MAX_LIST = 5000, MAX_TEXT = 400;

export function emptyState() {
  return { discoveries: [], bookmarks: [], journal: [], constellations: [], decisions: [], events: [], scenario: null, flags: {} };
}

// Action reducers: (state, payload) → new state. Pure; every action appends one event.
const reducers = {
  discover: (s, p) => s.discoveries.some(d => d.id === p.id) ? s : { ...s, discoveries: [...s.discoveries, p] },
  bookmark: (s, p) => ({ ...s, bookmarks: [...s.bookmarks.filter(b => b.name !== p.name), p] }),
  unbookmark: (s, p) => ({ ...s, bookmarks: s.bookmarks.filter(b => b.name !== p.name) }),
  journal: (s, p) => ({ ...s, journal: [...s.journal, p] }),
  decide: (s, p) => ({ ...s, decisions: [...s.decisions, p] }),
  scenario: (s, p) => ({ ...s, scenario: p }),
  flag: (s, p) => ({ ...s, flags: { ...s.flags, [p.key]: p.value } }),
  constellation: (s, p) => ({ ...s, constellations: [...s.constellations.filter(c => c.id !== p.id), p] }),
  unconstellation: (s, p) => ({ ...s, constellations: s.constellations.filter(c => c.id !== p.id) })
};
export const ACTIONS = Object.keys(reducers);

export function createGameStore(initial = emptyState(), { limit = 200 } = {}) {
  let state = initial, undo = [], redo = [], seq = initial.events.length;
  const listeners = new Set(), emit = () => listeners.forEach(f => f(state));
  return {
    get state() { return state; },
    subscribe(f) { listeners.add(f); return () => listeners.delete(f); },
    apply(type, payload, { at = Date.now() } = {}) {
      if (!reducers[type]) throw new Error('unknown action ' + type);
      const next = reducers[type](state, payload);
      if (next === state) return false;
      undo.push(state); if (undo.length > limit) undo.shift(); redo = [];
      state = { ...next, events: [...state.events, { seq: ++seq, type, at, summary: summarize(type, payload) }] };
      emit(); return true;
    },
    undo() { if (!undo.length) return false; redo.push(state); state = undo.pop(); emit(); return true; },
    redo() { if (!redo.length) return false; undo.push(state); state = redo.pop(); emit(); return true; },
    canUndo: () => undo.length > 0, canRedo: () => redo.length > 0,
    replace(s) { state = s; undo = []; redo = []; seq = s.events.length ? s.events[s.events.length - 1].seq : 0; emit(); }
  };
}
function summarize(type, p) {
  const name = p && (p.name || p.title || p.id || p.key);
  return (type + (name ? ': ' + name : '')).slice(0, MAX_TEXT);
}

/** Build a save object. `world` = { seed, tilt (number|null for seeded), version }. */
export function makeSave(world, view, state, { savedAt = new Date().toISOString() } = {}) {
  return { schema: SAVE_SCHEMA, saveVersion: SAVE_VERSION, savedAt, world: { seed: world.seed, tilt: world.tilt, modelVersion: world.version }, view, state };
}

/**
 * Validate untrusted save text. Never evaluates anything: JSON.parse plus explicit type and size checks. Returns
 * { ok, save } or { ok: false, error }. Future save versions and other world-model versions are refused, not guessed.
 */
export function parseSave(text, currentModel) {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, error: 'save file is missing or larger than 2 MB' };
  let o; try { o = JSON.parse(text); } catch { return { ok: false, error: 'not valid JSON' }; }
  const fail = e => ({ ok: false, error: e });
  if (!o || typeof o !== 'object' || o.schema !== SAVE_SCHEMA) return fail('not a Planet Forge save');
  if (!Number.isInteger(o.saveVersion)) return fail('missing save version');
  if (o.saveVersion > SAVE_VERSION) return fail(`save version ${o.saveVersion} is newer than this game supports (${SAVE_VERSION})`);
  const w = o.world;
  if (!w || typeof w.seed !== 'string' || !w.seed || w.seed.length > 64) return fail('invalid world seed');
  if (!(w.tilt === null || (typeof w.tilt === 'number' && w.tilt >= 0 && w.tilt <= 90))) return fail('invalid axial tilt');
  if (w.modelVersion !== currentModel) return fail(`save was made with world model ${String(w.modelVersion).slice(0, 40)}; this game runs ${currentModel} and cannot reproduce that world`);
  const v = o.view || {};
  for (const k of ['rx', 'ry', 'zoom']) if (v[k] !== undefined && !Number.isFinite(v[k])) return fail('invalid camera ' + k);
  if (v.cell !== undefined && v.cell !== null && !(Number.isInteger(v.cell) && v.cell >= 0 && v.cell < 1e7)) return fail('invalid selected cell');
  const s = o.state;
  if (!s || typeof s !== 'object') return fail('missing gameplay state');
  const base = emptyState();
  for (const k of ['discoveries', 'bookmarks', 'journal', 'constellations', 'decisions', 'events']) {
    if (s[k] === undefined) continue;
    if (!Array.isArray(s[k]) || s[k].length > MAX_LIST) return fail('invalid ' + k);
    if (!s[k].every(isPlainData)) return fail('invalid entry in ' + k);
  }
  if (s.flags !== undefined && (!isPlainData(s.flags) || Array.isArray(s.flags))) return fail('invalid flags');
  if (s.scenario !== undefined && s.scenario !== null && !isPlainData(s.scenario)) return fail('invalid scenario');
  return { ok: true, save: { ...o, state: { ...base, ...s } } };
}
/** JSON-only data (no functions, no prototype tricks), bounded depth and string length. */
function isPlainData(x, depth = 0) {
  if (depth > 8) return false;
  if (x === null || typeof x === 'number' && Number.isFinite(x) || typeof x === 'boolean') return true;
  if (typeof x === 'string') return x.length <= 4000;
  if (Array.isArray(x)) return x.length <= MAX_LIST && x.every(v => isPlainData(v, depth + 1));
  if (typeof x === 'object') {
    if (Object.getPrototypeOf(x) !== Object.prototype) return false;
    return Object.keys(x).every(k => k !== '__proto__' && k !== 'constructor' && k.length <= 64 && isPlainData(x[k], depth + 1));
  }
  return false;
}
