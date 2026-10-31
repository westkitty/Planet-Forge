import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStar, stellarFlux, yearDays, habitableZone, habitability, makeMoon, eclipseAt, predictEclipses, eclipticToBody, bodyToLatLon, footprintDeg, orbitPeriodMin, circularSpeed, maneuverDeltaV, validateOrbit, subSatellite, STAR_TYPES } from '../src/celestial.js';

const sun = { type: 'G2V', distanceAU: 1 };
test('PF-24 stellar flux, year and habitable zone are dimensionally consistent and match the Sun–Earth case', () => {
  assert.equal(stellarFlux(sun), 1361);
  assert.ok(Math.abs(yearDays(sun) - 365.25) < .3, 'Kepler year ' + yearDays(sun));
  const hz = habitableZone('G2V'); assert.ok(Math.abs(hz.innerAU - .95) < .02 && Math.abs(hz.outerAU - 1.676) < .02, JSON.stringify(hz));
  assert.ok(Math.abs(stellarFlux({ type: 'G2V', distanceAU: 2 }) - 1361 / 4) < 1e-9, 'inverse square');
  const h = habitability(sun); assert.ok(h.inHZ && Math.abs(h.equilibriumK - 255) < 2 && /match the 1,361/.test(h.coupling));
  assert.match(habitability({ type: 'M0V', distanceAU: 1 }).coupling, /Not coupled/);
  assert.ok(habitableZone('M0V').outerAU < habitableZone('F5V').innerAU, 'cooler stars have closer zones');
  assert.equal(validateStar({ type: 'X', distanceAU: 1 }), 'unknown star type'); assert.ok(validateStar({ type: 'G2V', distanceAU: 0 }));
  assert.equal(validateStar(sun), null);
});

test('PF-25 eclipses: reproducible timetable, physically ordered geometry, shadow centre on the planet', () => {
  const moon = makeMoon('ATLAS-001'); assert.deepEqual(makeMoon('ATLAS-001'), moon);
  assert.ok(moon.periodDays > 15 && moon.periodDays < 40, 'Kepler period ' + moon.periodDays);
  const a = predictEclipses(sun, moon, 13.74, 0, 1095), b = predictEclipses(sun, moon, 13.74, 0, 1095);
  assert.deepEqual(a, b); assert.ok(a.length >= 2, 'eclipses in three years: ' + a.length);
  assert.ok(a.some(e => /solar/.test(e.type)) && a.some(e => /lunar/.test(e.type)));
  for (const e of a) { const g = eclipseAt(e.day, sun, moon); assert.ok(g.kind, 'eclipse at its predicted time ' + e.day); if (e.centre) assert.ok(Math.abs(e.centre.lat) <= 90 && Math.abs(e.centre.lon) <= 180); }
  for (let k = 1; k < a.length; k++) assert.ok(a[k].day >= a[k - 1].day);
  const head = a.filter(e => /solar/.test(e.type)).map(e => e.day), seasonGap = head.length > 1 ? head[1] - head[0] : null;
  assert.ok(seasonGap === null || seasonGap > 10, 'solar eclipses are separated by at least a lunation');
});

test('frame conversion: the north pole stays the north pole; one sidereal day returns the same longitude', () => {
  const north = bodyToLatLon(eclipticToBody([0, -Math.sin(.3), Math.cos(.3)], 0, .3 * 180 / Math.PI));
  assert.ok(Math.abs(north.lat - 90) < 1e-6, JSON.stringify(north));
  const v = [1, .2, .1], x = bodyToLatLon(eclipticToBody(v, .25, 20)), y = bodyToLatLon(eclipticToBody(v, 1.25, 20));
  assert.ok(Math.abs(x.lat - y.lat) < 1e-9 && Math.abs(x.lon - y.lon) < 1e-9);
});

test('PF-26 orbits: periods, speeds, footprints and manoeuvre budgets', () => {
  assert.ok(Math.abs(orbitPeriodMin(420) - 92.8) < .5, 'ISS-like period ' + orbitPeriodMin(420));
  assert.ok(Math.abs(orbitPeriodMin(35786) - 1436.1) < 1, 'geostationary period');
  assert.ok(Math.abs(circularSpeed(0) - 7.91) < .01);
  assert.ok(footprintDeg(800, 10) > footprintDeg(800, 30) && footprintDeg(2000, 30) > footprintDeg(800, 30));
  assert.ok(Math.abs(maneuverDeltaV({ altKm: 300, incDeg: 28.5 }, { altKm: 35786, incDeg: 28.5 }) - 3.89) < .05, 'LEO→GEO Hohmann ≈ 3.9 km/s');
  assert.equal(maneuverDeltaV({ altKm: 500, incDeg: 50 }, { altKm: 500, incDeg: 50 }), 0);
  assert.ok(validateOrbit({ cls: 'imaging', altKm: 100, incDeg: 50 })); assert.equal(validateOrbit({ cls: 'imaging', altKm: 600, incDeg: 98 }), null);
  const o = { altKm: 700, incDeg: 98, raanDeg: 0, phaseDeg: 0 }, p0 = subSatellite(o, 0), lat = s => Math.asin(s[1]) * 180 / Math.PI;
  assert.ok(Math.abs(Math.hypot(...p0) - 1) < 1e-12);
  let maxLat = 0; for (let t = 0; t < 6000; t += 60) maxLat = Math.max(maxLat, Math.abs(lat(subSatellite(o, t))));
  assert.ok(Math.abs(maxLat - 82) < 1.5, 'a 98° orbit reaches 82° latitude: ' + maxLat);
  assert.deepEqual(subSatellite(o, 1234), subSatellite(o, 1234));
});

test('PF-26 fleet: coverage follows the orbits, missions are measurable, invalid manoeuvres are rejected', async () => {
  const { createPlanet, geodesicMesh } = await import('../src/planet.js');
  const { coverage, MISSIONS, launch, maneuver } = await import('../src/gameplay/orbits.js');
  const p = createPlanet('ATLAS-001', { frequency: 100, mesh: geodesicMesh(100) });
  let f = launch([], { cls: 'survey', altKm: 800, incDeg: 98, raanDeg: 0, phaseDeg: 0 }).fleet;
  assert.equal(launch(f, { cls: 'survey', altKm: 90, incDeg: 98 }).error.includes('decays'), true);
  const polar = coverage(p, f), equatorial = coverage(p, launch([], { cls: 'survey', altKm: 800, incDeg: 0 }).fleet);
  assert.ok(polar.polar > .5 && equatorial.polar === 0, `polar orbit sees the caps (${polar.polar.toFixed(2)}), an equatorial one never does`);
  assert.deepEqual(coverage(p, f), polar, 'reproducible');
  assert.equal(typeof MISSIONS.polar.met(polar), 'boolean');
  const big = maneuver(f, f[0].id, { altKm: 35786, incDeg: 0 }); assert.ok(big.error && /only/.test(big.error), 'over budget');
  const small = maneuver(f, f[0].id, { altKm: 900, incDeg: 98 }); assert.ok(!small.error && small.fleet[0].dvUsed > 0 && small.fleet[0].dvUsed < .1);
});

test('PF-04 constellations: only bright stars, no self or duplicate lines, named, ids stable across tiers', async () => {
  const { addEdge, validateConstellation, PICK_MAG } = await import('../src/constellations.js');
  const { buildStarCatalogue, brightestIds, SKY_QUALITY } = await import('../src/starfield.js');
  const cat = buildStarCatalogue(), bright = Array.from(cat.id).filter(i => cat.magnitude[i] < PICK_MAG), faint = Array.from(cat.id).find(i => cat.magnitude[i] > 6);
  let c = { id: 'x', name: '', edges: [] };
  assert.ok(addEdge(c, bright[0], bright[0], cat.magnitude).error);
  assert.ok(addEdge(c, bright[0], faint, cat.magnitude).error);
  c = addEdge(c, bright[0], bright[1], cat.magnitude).c; assert.ok(addEdge(c, bright[1], bright[0], cat.magnitude).error, 'duplicate');
  c = addEdge(c, bright[1], bright[2], cat.magnitude).c;
  assert.equal(validateConstellation(c), 'name it (1–40 characters)'); assert.equal(validateConstellation({ ...c, name: 'Weasel' }), null);
  const low = new Set(brightestIds(cat, SKY_QUALITY.low.stars)); assert.ok(bright.every(i => low.has(i)), 'every pickable star is drawn on the low tier');
});
