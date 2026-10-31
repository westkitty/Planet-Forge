import test from 'node:test';
import assert from 'node:assert/strict';
import { createQualityController, deviceCeiling, PROFILES, TIERS } from '../src/quality.js';

const run = (qc, ms, seconds, t0) => { let t = t0, out = []; while (t < t0 + seconds * 1000) { t += ms; const r = qc.sample(ms, t); if (r) out.push([t, r]); } return { t, out }; };

test('profiles are ordered: each tier is at least as expensive as the one below', () => {
  assert.deepEqual(TIERS, ['low', 'medium', 'high']);
  assert.ok(PROFILES.low.pixelRatioCap <= PROFILES.medium.pixelRatioCap && PROFILES.medium.pixelRatioCap <= PROFILES.high.pixelRatioCap);
  assert.ok(PROFILES.low.cloudTexture[0] < PROFILES.medium.cloudTexture[0] && PROFILES.medium.cloudTexture[0] < PROFILES.high.cloudTexture[0]);
  assert.equal(PROFILES.low.ocean, false);
  assert.equal(PROFILES.low.twinkle, false);
});

test('device ceiling follows capability hints', () => {
  assert.equal(deviceCeiling({ hardwareConcurrency: 8 }), 'high');
  assert.equal(deviceCeiling({ hardwareConcurrency: 8, coarsePointer: true }), 'medium');
  assert.equal(deviceCeiling({ hardwareConcurrency: 2 }), 'low');
  assert.equal(deviceCeiling({ hardwareConcurrency: 8, deviceMemory: 2 }), 'low');
  assert.equal(deviceCeiling({ hardwareConcurrency: 8, maxTextureSize: 2048 }), 'low');
});

test('slow frames step down one tier at a time after sustained measurement, never instantly', () => {
  const qc = createQualityController({ start: 'high', now: 0 });
  assert.equal(qc.sample(200, 3500), null, 'one slow frame does nothing');
  const { out } = run(qc, 60, 20, 3500);
  assert.deepEqual(out.map(o => o[1]), ['medium', 'low']);
  assert.ok(out[0][0] >= 3500 + 4000, 'needs two slow 2 s windows');
  assert.ok(out[1][0] - out[0][0] >= 3000 + 4000, 'quiet period after a change');
  assert.equal(qc.tier, 'low');
});

test('fast frames step up only after five fast windows and never above the ceiling', () => {
  const qc = createQualityController({ start: 'low', ceiling: 'medium', now: 0 });
  const { out } = run(qc, 8, 60, 0);
  assert.deepEqual(out.map(o => o[1]), ['medium']);
  assert.ok(out[0][0] >= 3000 + 10000);
  assert.equal(qc.tier, 'medium');
});

test('hysteresis: frames between the thresholds never change the tier', () => {
  const qc = createQualityController({ start: 'medium', now: 0 });
  assert.equal(run(qc, 22, 120, 0).out.length, 0);
});

test('oscillation guard: up then down within 30 s locks the ceiling, so no further up-steps', () => {
  const qc = createQualityController({ start: 'medium', now: 0 });
  let { t, out } = run(qc, 8, 20, 0);
  assert.deepEqual(out.map(o => o[1]), ['high']);
  ({ t, out } = run(qc, 60, 8, t));
  assert.deepEqual(out.map(o => o[1]), ['medium']);
  assert.equal(qc.state().ceiling, 'medium');
  ({ out } = run(qc, 8, 120, t));
  assert.equal(out.length, 0, 'locked at medium');
});

test('stalls and manual mode are ignored by the measurement', () => {
  const qc = createQualityController({ start: 'high', now: 0 });
  assert.equal(run(qc, 1500, 60, 0).out.length, 0, 'intervals > 1 s are stalls, not rendering cost');
  const slowDevice = createQualityController({ start: 'high', now: 0 });
  assert.deepEqual(run(slowDevice, 400, 30, 0).out.map(o => o[1]), ['medium', 'low'], 'a device at 2.5 fps is slow, not stalled');
  const m = createQualityController({ mode: 'medium', now: 0 });
  assert.equal(m.tier, 'medium');
  assert.equal(run(m, 100, 30, 0).out.length, 0);
  assert.equal(m.setMode('low', 1), 'low');
  assert.equal(m.setMode('auto', 2), null);
  assert.equal(m.state().mode, 'auto');
});
