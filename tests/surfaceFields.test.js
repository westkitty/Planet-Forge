import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanet, geodesicMesh } from '../src/planet.js';
import { buildCloudField, coverFromRain, oceanDepthField, settlementLightField, sunDirection, seasonDeclination, binnedClimate } from '../src/surfaceFields.js';

const mesh = geodesicMesh(100);
const planet = createPlanet('ATLAS-001', { frequency: 100, mesh });
const fingerprint = p => [p.elevation, p.temperature, p.rainfall, p.biome, p.koppen, p.hydro.discharge].map(a => { let h = 2166136261; const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i += 7) h = Math.imul(h ^ b[i], 16777619); return h >>> 0; }).join('-');
const before = fingerprint(planet);

test('cloud field is deterministic and its cover follows precipitation (wetter → cloudier)', () => {
  const a = buildCloudField(planet, { width: 128, height: 64 }), b = buildCloudField(planet, { width: 128, height: 64 });
  assert.deepEqual(a.data, b.data);
  const bins = binnedClimate(planet), pairs = [];
  for (let y = 0; y < 64; y++) for (let x = 0; x < 128; x++) {
    const lat = ((y + .5) / 64) * 180 - 90, lon = ((x + .5) / 128) * 360 - 180;
    pairs.push([bins.rain[Math.min(89, Math.floor((lat + 90) / 2)) * 90 + Math.min(89, Math.floor((lon + 180) / 4))], a.data[4 * (y * 128 + x)]]);
  }
  const mean = k => pairs.reduce((s, p) => s + p[k], 0) / pairs.length, mx = mean(0), my = mean(1);
  let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy);
  assert.ok(r > 0.5, 'rain–cloud correlation ' + r.toFixed(3));
  const sorted = pairs.slice().sort((p, q) => p[0] - q[0]), q = Math.floor(pairs.length / 4);
  const dry = sorted.slice(0, q).reduce((s, p) => s + p[1], 0) / q, wet = sorted.slice(-q).reduce((s, p) => s + p[1], 0) / q;
  assert.ok(wet > dry + 40, `wettest quarter cover ${wet.toFixed(0)} vs driest ${dry.toFixed(0)}`);
  assert.equal(coverFromRain(0), 0);
  assert.equal(coverFromRain(5000), 1);
});

test('cloud drift channel follows the model zonal wind sign (trade easterlies at the equator)', () => {
  const f = buildCloudField(planet, { width: 64, height: 90 });
  const eq = f.data[4 * (45 * 64) + 1];
  assert.ok(f.zonalWind[45] < 0 && eq < 128, 'equatorial drift westward');
  const seasonal = buildCloudField(planet, { width: 64, height: 32, month: 6 });
  assert.notDeepEqual(seasonal.data, buildCloudField(planet, { width: 64, height: 32, month: 0 }).data, 'January and July differ');
});

test('ocean depth and settlement-light fields correspond to the world arrays', () => {
  const o = oceanDepthField(planet);
  for (let i = 0; i < planet.cellCount; i += 13) assert.equal(o[i] > 0, planet.elevation[i] < 0);
  const L = settlementLightField(planet);
  for (const s of planet.settlements) assert.equal(L[s.cell], 1, s.name + ' is lit at its own cell');
  let lit = 0; for (let i = 0; i < planet.cellCount; i++) if (L[i] > 0) { lit++; assert.ok(planet.elevation[i] >= 0, 'no lights at sea'); }
  assert.ok(lit >= planet.settlements.length && lit < planet.settlements.length * 25, 'lit cells ' + lit);
});

test('sun direction and seasonal declination are geometric and unit length', () => {
  const d = sunDirection(90, 0);
  assert.ok(Math.abs(d[0]) < 1e-12 && Math.abs(d[2] - 1) < 1e-12, 'lon 90 → +z (lon = atan2(z, x))');
  const n = sunDirection(-30, 23.44); assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-12);
  assert.equal(seasonDeclination('jul', 20), 20); assert.equal(seasonDeclination('jan', 20), -20); assert.equal(seasonDeclination('annual', 20), 0);
});

test('presentation fields never modify the scientific world', () => {
  buildCloudField(planet, { width: 64, height: 32, month: 0 }); oceanDepthField(planet); settlementLightField(planet);
  assert.equal(fingerprint(planet), before);
});
