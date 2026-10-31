import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameStore, makeSave, parseSave, emptyState, SAVE_VERSION } from '../src/gameState.js';

test('PF-13 actions record events and undo/redo restores exact states', () => {
  const s = createGameStore();
  assert.ok(s.apply('discover', { id: 'a', name: 'A', cell: 1 }, { at: 1 }));
  assert.equal(s.apply('discover', { id: 'a', name: 'A', cell: 1 }, { at: 2 }), false, 'duplicate discovery is a no-op');
  s.apply('bookmark', { name: 'home', rx: .1, ry: .2, zoom: 1, cell: 5 }, { at: 3 });
  const after = s.state;
  assert.equal(after.events.length, 2);
  assert.ok(s.undo()); assert.equal(s.state.bookmarks.length, 0); assert.equal(s.state.discoveries.length, 1);
  assert.ok(s.redo()); assert.deepEqual(s.state, after);
  s.undo(); s.apply('flag', { key: 'x', value: 1 }, { at: 4 }); assert.equal(s.canRedo(), false, 'a new action clears redo');
  assert.throws(() => s.apply('eval', {}));
});

test('PF-13 save round-trip and strict rejection of corrupt, future, foreign-model and unsafe files', () => {
  const st = createGameStore(); st.apply('discover', { id: 'p', name: 'Peak', cell: 42 }, { at: 9 });
  const save = makeSave({ seed: 'ATLAS-001', tilt: null, version: 'glacial-0.8' }, { rx: .3, ry: -1, zoom: 1.2, cell: 42 }, st.state, { savedAt: 'T' });
  const back = parseSave(JSON.stringify(save), 'glacial-0.8');
  assert.ok(back.ok); assert.deepEqual(back.save.state, st.state); assert.deepEqual(back.save.view, save.view);
  const bad = (o, why) => { const r = parseSave(typeof o === 'string' ? o : JSON.stringify(o), 'glacial-0.8'); assert.equal(r.ok, false, why); return r.error; };
  bad('{not json', 'syntax');
  bad({ ...save, schema: 'other' }, 'schema');
  assert.match(bad({ ...save, saveVersion: SAVE_VERSION + 1 }, 'future'), /newer than this game supports/);
  assert.match(bad({ ...save, world: { ...save.world, modelVersion: 'glacial-0.9' } }, 'model'), /cannot reproduce/);
  bad({ ...save, world: { ...save.world, seed: '' } }, 'seed');
  bad({ ...save, view: { ...save.view, zoom: 'x' } }, 'camera');
  bad({ ...save, state: { ...save.state, discoveries: 'x' } }, 'list');
  bad('{"schema":"planet-forge-save","saveVersion":1,"world":{"seed":"A","tilt":null,"modelVersion":"glacial-0.8"},"state":{"flags":{"__proto__":{"polluted":1}}}}', 'prototype key');
  bad('x'.repeat(2_000_001), 'size');
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Object.keys(emptyState()).sort(), ['bookmarks', 'constellations', 'decisions', 'discoveries', 'events', 'flags', 'journal', 'scenario']);
});
