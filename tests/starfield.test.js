import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildStarCatalogue, brightestIds, starAppearance, autoSkyQuality, createStarfield, blackbodyRgb, SKY_SEED, SKY_QUALITY, CATALOGUE_SIZE } from '../src/starfield.js';

const cat = buildStarCatalogue();
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dir = (c, i) => [c.direction[3 * i], c.direction[3 * i + 1], c.direction[3 * i + 2]];

test('same sky seed reproduces the catalogue exactly; a different seed does not', () => {
  const again = buildStarCatalogue(SKY_SEED);
  assert.equal(again.signature, cat.signature);
  assert.deepEqual(again.direction, cat.direction);
  assert.deepEqual(again.magnitude, cat.magnitude);
  assert.deepEqual(again.color, cat.color);
  assert.deepEqual(again.galaxies, cat.galaxies);
  const other = buildStarCatalogue('ANOTHER-SKY');
  assert.notEqual(other.signature, cat.signature);
});

test('catalogue values are finite unit directions, bounded magnitudes and in-gamut colours', () => {
  assert.equal(cat.count, CATALOGUE_SIZE);
  for (let i = 0; i < cat.count; i++) {
    const d = dir(cat, i), m = cat.magnitude[i];
    assert.ok(Math.abs(Math.hypot(...d) - 1) < 1e-5, 'unit direction ' + i);
    assert.ok(m >= -1.6001 && m <= 7.0001, 'magnitude ' + m);
    assert.equal(cat.id[i], i);
    for (let c = 0; c < 3; c++) assert.ok(cat.color[3 * i + c] >= 0 && cat.color[3 * i + c] <= 1);
  }
});

test('brightness is non-uniform: bright stars are rare and counts rise toward faint magnitudes', () => {
  const below = m => cat.magnitude.filter(x => x < m).length;
  assert.ok(below(1) >= 5 && below(1) <= 60, 'stars brighter than m1: ' + below(1));
  assert.ok(below(1) < below(3) && below(3) < below(5) && below(5) < below(7.01));
  assert.ok(below(5) / cat.count < 0.2, 'most of the catalogue is faint');
  const faint = starAppearance(7), bright = starAppearance(-1);
  assert.ok(bright.size > faint.size && bright.brightness > faint.brightness);
  assert.ok(bright.size <= 7 && faint.size >= 1.5, 'no giant or sub-pixel sprites');
});

test('stars concentrate toward the galactic plane and colours span hot and cool stars', () => {
  const p = cat.frame.pole, s15 = Math.sin(15 * Math.PI / 180);
  const near = Array.from({ length: cat.count }, (_, i) => Math.abs(dot(dir(cat, i), p)) < s15).filter(Boolean).length / cat.count;
  assert.ok(near > 0.5, 'fraction within 15° of the plane ' + near.toFixed(3) + ' (isotropic 0.259)');
  assert.ok(Math.min(...cat.temperature) < 3700 && Math.max(...cat.temperature) > 10000);
  const hot = blackbodyRgb(20000), cool = blackbodyRgb(3000);
  assert.ok(hot[2] > hot[0] && cool[0] > cool[2], 'blue-white hot stars, amber cool stars');
});

test('galactic frame is orthonormal and the band and bulge lie in the default view', () => {
  const { pole, centre, east } = cat.frame;
  assert.ok(Math.abs(Math.hypot(...pole) - 1) < 1e-9 && Math.abs(dot(pole, centre)) < 1e-9 && Math.abs(dot(east, centre)) < 1e-9);
  const view = [0, 0, -1];
  assert.ok(Math.abs(dot(view, pole)) < Math.sin(20 * Math.PI / 180), 'plane passes within 20° of the view axis');
  assert.ok(Math.acos(dot(view, centre)) < 36 * Math.PI / 180, 'bulge within 36° of the view axis');
  assert.equal(cat.galaxies.length, 10);
  for (const g of cat.galaxies) assert.ok(Math.abs(dot(g.direction, pole)) >= Math.sin(9 * Math.PI / 180) - 1e-9, 'galaxies avoid the plane');
});

test('quality tiers draw the brightest subset, so star ids are identical across tiers', () => {
  const low = brightestIds(cat, SKY_QUALITY.low.stars), med = brightestIds(cat, SKY_QUALITY.medium.stars), high = brightestIds(cat, SKY_QUALITY.high.stars);
  assert.equal(low.length, SKY_QUALITY.low.stars);
  assert.equal(high.length, CATALOGUE_SIZE);
  const inMed = new Set(med);
  assert.ok(Array.from(low).every(i => inMed.has(i)));
  const lim = ids => Math.max(...Array.from(ids, i => cat.magnitude[i]));
  assert.ok(lim(low) < lim(med) && lim(med) <= lim(high));
  assert.equal(autoSkyQuality({ location: { search: '?sky=low' } }), 'low');
  assert.equal(autoSkyQuality({ navigator: { hardwareConcurrency: 2 } }), 'low');
  assert.equal(autoSkyQuality({ navigator: { hardwareConcurrency: 8 }, innerWidth: 390, matchMedia: () => ({ matches: false }) }), 'medium');
  assert.equal(autoSkyQuality({ navigator: { hardwareConcurrency: 8 }, innerWidth: 1280, matchMedia: () => ({ matches: false }) }), 'high');
});

test('one sky per scene; tier changes and disposal free every superseded geometry and material', () => {
  const scene = new THREE.Scene(), live = new Set();
  const track = o => { for (const r of [o.geometry, o.material]) if (r && !live.has(r)) { live.add(r); r.addEventListener('dispose', () => live.delete(r)); } };
  const renderer = { getPixelRatio: () => 1, properties: { get: () => ({}) } };
  const sky = createStarfield(scene, renderer, { quality: 'high' });
  const owned = () => { scene.traverse(o => (o.isPoints || o.isMesh) && track(o)); return live.size; };
  assert.equal(owned(), 4, 'stars + galaxy dome');
  assert.equal(scene.children.filter(o => o.name === 'pf-starfield').length, 1);
  for (const q of ['low', 'medium', 'high', 'low', 'high']) { sky.setQuality(q); assert.equal(owned(), 4); assert.equal(sky.info().quality, q); }
  assert.equal(sky.info().signature, cat.signature);
  sky.dispose();
  assert.equal(live.size, 0);
  assert.equal(scene.children.length, 0);
});

test('a sky shader that fails to link falls back to plain points without the dome', () => {
  const scene = new THREE.Scene();
  const renderer = { getPixelRatio: () => 1, properties: { get: () => ({ currentProgram: { diagnostics: { runnable: false } } }) } };
  const sky = createStarfield(scene, renderer, { quality: 'medium' });
  assert.equal(sky.checkShaders(), false);
  const info = sky.info(), group = scene.getObjectByName('pf-starfield');
  assert.equal(info.fallback, true);
  assert.equal(group.children.length, 1);
  assert.ok(group.children[0].material.isPointsMaterial);
  assert.equal(info.drawn, SKY_QUALITY.medium.stars);
  sky.dispose();
});
