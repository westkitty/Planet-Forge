import * as THREE from 'three';
import { createPlanet, geodesicMesh, cellInfo, planetSummary, BIOMES, KOPPEN } from './planet.js';
import { KOPPEN_COLORS } from './climate.js';
import { RIVER_MIN_M3S, LAKE } from './hydrology.js';
import { GLACIAL_CELL } from './glaciation.js';
import './style.css';
import { createPresentation } from './presentation.js';
import { createQualityController, deviceCeiling, TIERS } from './quality.js';
import { createOverlays } from './overlays.js';
import { createSatelliteView } from './celestialView.js';
import { createLocalScene } from './localScene.js';
import { moveVehicle } from './localTerrain.js';
import { STAR_TYPES, habitability } from './celestial.js';
import { createGameStore } from './gameState.js';
import { createObservatoryUI } from './observatoryUI.js';
import { tourStops, facingRotation, ROUTES, INVESTIGATIONS } from './observatory.js';
import { pickSurface, cellDir, nearestCell, latLonToDir } from './geo.js';
import { progress as surveyProgress } from './gameplay/survey.js';
import { initDockUI } from './dockUI.js';
const root = document.querySelector('#viewer'), seedInput = document.querySelector('#seed'), layerSelect = document.querySelector('#layer'), seasonSelect = document.querySelector('#season'), tiltSelect = document.querySelector('#tilt'), eraSelect = document.querySelector('#era');
let planet, mesh, renderedPlanet = null, annotation = null, zonalRain, coastalMask, disposed = false, glacialMs = null;
const FREQUENCY = 100; // 10f^2+2 = 100,002 cells
const baseMesh = geodesicMesh(FREQUENCY);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, .1, 120);
camera.position.set(0, 0, 3);
// Startup guard: a readable message instead of a blank page when WebGL 2 is unavailable.
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
catch (e) {
  const probe = t => { try { return !!document.createElement('canvas').getContext(t); } catch { return false; } };
  const brave = !!navigator.brave;
  window.__pfBootFail?.('This browser refused to create a WebGL 2 context, which the 3D globe needs (' + e.message + '; WebGL 2: ' + (probe('webgl2') ? 'available' : 'unavailable') + ', WebGL 1: ' + (probe('webgl') ? 'available' : 'unavailable') + ').'
    + (brave ? ' In Brave: open Shields (lion icon) for this site and allow fingerprinting / turn Shields down, and check brave://settings/system → "Use graphics acceleration when available" is on (then restart Brave).' : ' Turn on hardware/graphics acceleration in the browser settings and restart it, or try a current Chrome, Edge, Firefox or Safari.'));
  throw e;
}
root.appendChild(renderer.domElement);
const presentation = createPresentation(scene, camera, renderer, baseMesh);
const overlays = createOverlays(baseMesh, presentation.radius);
const satellites = createSatelliteView();
const BIOME_COLORS = { Ocean: '#0e3852', Ice: '#f0f8fb', Tundra: '#879b93', 'Boreal forest': '#1f5748', 'Cold desert': '#b09b7d', 'Temperate grassland': '#8e9f64', 'Woodland / shrubland': '#857d4c', 'Temperate seasonal forest': '#3d7a52', 'Temperate rainforest': '#1f6648', 'Subtropical desert': '#c2945d', 'Tropical seasonal forest / savanna': '#829145', 'Tropical rainforest': '#11523b' };
const koppenColor = KOPPEN.map(k => new THREE.Color(KOPPEN_COLORS[k]));
const biomeColor = BIOMES.map(b => new THREE.Color(BIOME_COLORS[b]));
const SHORE_SEA = new THREE.Color('#3d8299'), SHORE_LAND = new THREE.Color('#d4c49d');
const BOUNDARY_COLORS = [null, new THREE.Color('#ff4d36'), new THREE.Color('#2ad4ff'), new THREE.Color('#ffc82a')];
// Glacial maximum (glacial-0.8): ice sheets shaded by thickness, exposed shelves as land, land bridges highlighted.
const ICE_THIN = new THREE.Color('#cfe3ee'), ICE_THICK = new THREE.Color('#f7fbff'), SHELF = new THREE.Color('#b9a77a'), BRIDGE = new THREE.Color('#ff9f3c'), RETREAT = new THREE.Color('#7fb6c9');

// Pre-allocated scientific layer color ramps
const RAMP_TEMP = [
  { t: -50, c: new THREE.Color('#381864') },
  { t: -30, c: new THREE.Color('#1e3c88') },
  { t: -12, c: new THREE.Color('#1c6fae') },
  { t: 0,   c: new THREE.Color('#38b8d0') },
  { t: 10,  c: new THREE.Color('#3ea888') },
  { t: 20,  c: new THREE.Color('#82b842') },
  { t: 28,  c: new THREE.Color('#d89e24') },
  { t: 36,  c: new THREE.Color('#db5620') },
  { t: 45,  c: new THREE.Color('#b81822') }
];
function tempColor(t, c) {
  if (t <= -50) return c.copy(RAMP_TEMP[0].c);
  if (t >= 45) return c.copy(RAMP_TEMP[8].c);
  for (let k = 0; k < 8; k++) {
    const a = RAMP_TEMP[k], b = RAMP_TEMP[k + 1];
    if (t <= b.t) return c.copy(a.c).lerp(b.c, (t - a.t) / (b.t - a.t));
  }
  return c.copy(RAMP_TEMP[8].c);
}

const RAMP_OCEAN = [
  { h: -11000, c: new THREE.Color('#030814') },
  { h: -6000,  c: new THREE.Color('#0a203a') },
  { h: -3000,  c: new THREE.Color('#143c62') },
  { h: -500,   c: new THREE.Color('#226694') },
  { h: 0,      c: new THREE.Color('#46a8ca') }
];
const RAMP_LAND = [
  { h: 0,     c: new THREE.Color('#2e6c52') },
  { h: 350,   c: new THREE.Color('#58a876') },
  { h: 900,   c: new THREE.Color('#9ec482') },
  { h: 1800,  c: new THREE.Color('#d8b868') },
  { h: 3000,  c: new THREE.Color('#c67848') },
  { h: 4800,  c: new THREE.Color('#8a6252') },
  { h: 6500,  c: new THREE.Color('#f0f2f5') }
];
function elevationColor(el, c) {
  if (el < 0) {
    if (el <= -11000) return c.copy(RAMP_OCEAN[0].c);
    if (el >= 0) return c.copy(RAMP_OCEAN[4].c);
    for (let k = 0; k < 4; k++) {
      const a = RAMP_OCEAN[k], b = RAMP_OCEAN[k + 1];
      if (el <= b.h) return c.copy(a.c).lerp(b.c, (el - a.h) / (b.h - a.h));
    }
    return c.copy(RAMP_OCEAN[4].c);
  }
  if (el >= 6500) return c.copy(RAMP_LAND[6].c);
  for (let k = 0; k < 6; k++) {
    const a = RAMP_LAND[k], b = RAMP_LAND[k + 1];
    if (el <= b.h) return c.copy(a.c).lerp(b.c, (el - a.h) / (b.h - a.h));
  }
  return c.copy(RAMP_LAND[6].c);
}

const RAMP_RAIN = [
  { r: 0,    c: new THREE.Color('#f4e6c0') },
  { r: 150,  c: new THREE.Color('#d4bf7c') },
  { r: 400,  c: new THREE.Color('#88c2ad') },
  { r: 900,  c: new THREE.Color('#389898') },
  { r: 1800, c: new THREE.Color('#18688e') },
  { r: 3000, c: new THREE.Color('#163884') },
  { r: 5000, c: new THREE.Color('#101858') }
];
function rainColor(r, c) {
  if (r <= 0) return c.copy(RAMP_RAIN[0].c);
  if (r >= 5000) return c.copy(RAMP_RAIN[6].c);
  for (let k = 0; k < 6; k++) {
    const a = RAMP_RAIN[k], b = RAMP_RAIN[k + 1];
    if (r <= b.r) return c.copy(a.c).lerp(b.c, (r - a.r) / (b.r - a.r));
  }
  return c.copy(RAMP_RAIN[6].c);
}

const RAMP_AGE = [
  { a: 0,   c: new THREE.Color('#e6241e') },
  { a: 25,  c: new THREE.Color('#f68428') },
  { a: 55,  c: new THREE.Color('#fabc36') },
  { a: 85,  c: new THREE.Color('#68b852') },
  { a: 120, c: new THREE.Color('#2ea2a4') },
  { a: 160, c: new THREE.Color('#2258aa') },
  { a: 200, c: new THREE.Color('#3e1878') }
];
function seafloorAgeColor(age, c) {
  const clamped = Math.max(0, Math.min(200, age));
  if (clamped <= 0) return c.copy(RAMP_AGE[0].c);
  if (clamped >= 200) return c.copy(RAMP_AGE[6].c);
  for (let k = 0; k < 6; k++) {
    const a = RAMP_AGE[k], b = RAMP_AGE[k + 1];
    if (clamped <= b.a) return c.copy(a.c).lerp(b.c, (clamped - a.a) / (b.a - a.a));
  }
  return c.copy(RAMP_AGE[6].c);
}
function glacialColor(i, layer, c, g) {
  const s = g.cell[i];
  if (s === GLACIAL_CELL.ice) return c.copy(ICE_THIN).lerp(ICE_THICK, Math.min(1, g.thickness[i] / 3500));
  if (s === GLACIAL_CELL.bridge) return c.copy(layer === 'glacial' ? BRIDGE : SHELF);
  if (s === GLACIAL_CELL.shelf) return c.copy(SHELF);
  if (layer !== 'glacial') return null;
  if (s === GLACIAL_CELL.presentIce) return c.copy(RETREAT);
  const el = planet.elevation[i];
  return el < 0 ? c.setRGB(.05, .1 + Math.max(0, el + 6000) / 60000, .22 + Math.max(0, el + 6000) / 40000) : c.setHSL(.25, .12, Math.min(.6, .3 + el / 12000));
}
const glacialView = () => eraSelect.value === 'glacial' || layerSelect.value === 'glacial';
let fogMask = null; // PF-17 survey mode: unmapped cells are drawn as fog (presentation only)
let diffMap = null; // PF-16 experiment: per-cell temperature change (experiment − baseline), drawn instead of the layer
const clamp01 = x => x < 0 ? 0 : (x > 1 ? 1 : x);
function color(i, layer, c) {
  if (diffMap) { const d = Math.max(-1, Math.min(1, diffMap[i] / 15)); return d < 0 ? c.setRGB(.85 + .15 * d, .88 + .5 * d, .95) : c.setRGB(.95, .88 - .6 * d, .85 - .75 * d); }
  if (fogMask && !fogMask[i]) return c.setRGB(.03, .045, .06);
  const el = planet.elevation[i];
  if (glacialView() && glacialColor(i, layer, c, planet.glaciation)) return c;
  if (layer === 'plates') { const k = planet.plate[i]; return c.setHSL((k * 0.618034) % 1, .62, planet.continental[i] ? .58 : .34); }
  if (layer === 'boundaries') { const b = planet.boundary[i]; if (b) return c.copy(BOUNDARY_COLORS[b]); return planet.continental[i] ? c.setRGB(.42, .40, .36) : c.setRGB(.10, .16, .24); }
  if (layer === 'age') { if (planet.continental[i]) return c.setRGB(.35, .33, .30); return seafloorAgeColor(planet.seafloorAge[i], c); }
  const m = seasonSelect.value === 'jan' ? 0 : seasonSelect.value === 'jul' ? 6 : -1;
  if (layer === 'temperature') { const t = m < 0 ? planet.temperature[i] : planet.climate.temperatureMonthly[12 * i + m]; return tempColor(t, c); }
  if (layer === 'rainfall') { const r = m < 0 ? planet.rainfall[i] : planet.climate.precipitationMonthly[12 * i + m] * 12; return rainColor(r, c); }
  if (layer === 'koppen') return c.copy(koppenColor[planet.koppen[i]]);
  if (layer === 'winds') { // rain shadow index: precipitation relative to the zonal-mean land precipitation at that latitude
    if (el < 0) return c.setRGB(.08, .13, .2);
    const z = zonalRain[Math.min(179, Math.max(0, Math.floor(planet.lat[i] + 90)))] || 1, q = Math.log2((planet.rainfall[i] + 20) / (z + 20));
    return q < 0 ? c.setRGB(.58 + Math.min(.38, -q * .18), .42, .22) : c.setRGB(.18, .46 + Math.min(.4, q * .15), .56 + Math.min(.4, q * .2));
  }
  if (layer === 'rivers' || layer === 'basins') {
    if (el < 0) return c.setRGB(.06, .12, .2);
    const lk = planet.hydro.lake[i];
    if (lk === LAKE.fresh) return c.setRGB(.2, .5, .85); if (lk === LAKE.salt) return c.setRGB(.45, .82, .76); if (lk === LAKE.saltFlat) return c.setRGB(.9, .88, .8);
    if (layer === 'rivers') { const v = .18 + Math.min(.28, el / 14000); return c.setRGB(v * 0.95, v * 1.05, v * 0.92); }
    const b = planet.hydro.basins[planet.hydro.basin[i]], hsh = Math.imul(b.mouth + 7, 2654435761) >>> 0;
    return b.endorheic ? c.setHSL(.08 + (hsh % 60) / 1000, .52, .32 + (hsh % 7) / 60) : c.setHSL((hsh % 1000) / 1000, .54, .36 + (hsh % 5) / 40);
  }
  if (layer === 'elevation') return elevationColor(el, c);
  if (el < 0) {
    const d = clamp01(-el / 8500);
    c.setRGB(.014 + (1 - d) * .035, .048 + (1 - d) * .072, .120 + (1 - d) * .115);
    if (coastalMask?.[i]) {
      const shallow = clamp01((el + 800) / 800);
      c.lerp(SHORE_SEA, .24 * shallow + .08);
    }
    return c;
  }
  const lk = planet.hydro?.lake?.[i];
  if (lk === LAKE.fresh) return c.setRGB(.08, .26, .38);
  if (lk === LAKE.salt) return c.setRGB(.16, .38, .44);
  if (lk === LAKE.saltFlat) return c.setRGB(.84, .80, .74);
  c.copy(biomeColor[planet.biome[i]]);
  if (coastalMask?.[i] && planet.temperature[i] > -1) {
    const beach = clamp01(1 - el / 350);
    c.lerp(SHORE_LAND, .18 * beach);
  }
  if (el > 2200 && planet.temperature[i] < 3) {
    const frost = clamp01((-planet.temperature[i]) / 7) * clamp01((el - 2200) / 1800);
    if (frost > 0) c.lerp(biomeColor[1], frost * 0.76);
  }
  if (planet.rainfall[i] < 350 && planet.hydro?.discharge?.[i] > 8000) {
    c.lerp(biomeColor[10], .28);
  }
  return c;
}
function disposeAnnotation() {
  if (!annotation) return;
  mesh.remove(annotation);
  annotation.geometry.dispose();
  annotation.material.dispose();
  annotation = null;
}
let globeFallback = false; // set if the patched globe shader fails to compile on this GPU
function makeGlobe() {
  if (glacialView()) {
    const t0 = performance.now(), fresh = !planet.glaciationComputed;
    planet.glaciation;
    if (fresh) { glacialMs = Math.round(performance.now() - t0); printWorld(); }
  }
  if (!mesh || renderedPlanet !== planet) {
    const rotation = mesh?.rotation.clone();
    if (mesh) {
      scene.remove(mesh);
      disposeAnnotation();
      mesh.geometry.dispose(); mesh.material.dispose(); // clouds and markers are owned and reused by the presentation
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(baseMesh.positions.length), 3));
    geometry.setIndex(new THREE.BufferAttribute(baseMesh.triangles, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(baseMesh.positions.length), 3));
    presentation.shapeTerrain(geometry, planet);
    mesh = new THREE.Mesh(geometry, globeFallback ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .015 }) : presentation.createGlobeMaterial());
    if (rotation) mesh.rotation.copy(rotation);
    scene.add(mesh);
    presentation.installWorld(mesh, planet);
    mesh.add(overlays.group, satellites.group);
    if (renderedPlanet !== planet) overlays.setWorld(planet);
    annotation = null;
    renderedPlanet = planet;
  }
  const attribute = mesh.geometry.getAttribute('color');
  const c = new THREE.Color(), layer = layerSelect.value;
  for (let i = 0; i < planet.cellCount; i++) {
    color(i, layer, c);
    attribute.setXYZ(i, c.r, c.g, c.b);
  }
  attribute.needsUpdate = true;
  disposeAnnotation();
  if (layer === 'winds') { annotation = windArrows(); mesh.add(annotation); }
  if (layer === 'rivers' || layer === 'basins') { annotation = riverLines(); mesh.add(annotation); }
  presentation.setView({ natural: layer === 'biome', clouds: layer === 'biome' && eraSelect.value === 'today', season: seasonSelect.value, tilt: planet.tilt });
}
// Prevailing-wind arrows for the selected season (annual = mean of January and July), drawn on ~2,500 cells.
function windArrows() {
  const P = baseMesh.positions, J = planet.climate.wind[0], Y = planet.climate.wind[1], s = seasonSelect.value, pts = [], col = [];
  for (let i = 0; i < planet.cellCount; i += 40) {
    const wx = s === 'jan' ? J[3 * i] : s === 'jul' ? Y[3 * i] : (J[3 * i] + Y[3 * i]) / 2, wy = s === 'jan' ? J[3 * i + 1] : s === 'jul' ? Y[3 * i + 1] : (J[3 * i + 1] + Y[3 * i + 1]) / 2, wz = s === 'jan' ? J[3 * i + 2] : s === 'jul' ? Y[3 * i + 2] : (J[3 * i + 2] + Y[3 * i + 2]) / 2;
    const k = 0.045, lift = presentation.radius(planet.elevation[i]) + .009;
    const ox = P[3 * i] * lift, oy = P[3 * i + 1] * lift, oz = P[3 * i + 2] * lift;
    const tx = ox + wx * k, ty = oy + wy * k, tz = oz + wz * k;
    pts.push(ox, oy, oz, tx, ty, tz);
    // arrow head: two short barbs rotated about the local normal
    const nx = P[3 * i], ny = P[3 * i + 1], nz = P[3 * i + 2], cx = wy * nz - wz * ny, cy = wz * nx - wx * nz, cz = wx * ny - wy * nx;
    pts.push(tx, ty, tz, tx - wx * k * .4 + cx * k * .25, ty - wy * k * .4 + cy * k * .25, tz - wz * k * .4 + cz * k * .25, tx, ty, tz, tx - wx * k * .4 - cx * k * .25, ty - wy * k * .4 - cy * k * .25, tz - wz * k * .4 - cz * k * .25);
    const speed = Math.hypot(wx, wy, wz);
    const v = Math.min(1, speed / 18);
    const cr = 0.65 + 0.35 * v, cg = 0.85 + 0.15 * v, cb = 1.0;
    for (let p = 0; p < 6; p++) col.push(cr, cg, cb);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .85 }));
}
// River network: a segment from every river cell to its receiver; brightness and colour by log discharge.
function riverLines() {
  const P = baseMesh.positions, h = planet.hydro, pts = [], col = [], c = new THREE.Color();
  for (let i = 0; i < planet.cellCount; i++) {
    const q = h.discharge[i], r = h.receiver[i]; if (q < RIVER_MIN_M3S || r < 0 || h.lake[i]) continue;
    const t = Math.min(1, Math.log10(q / RIVER_MIN_M3S) / 3.3); c.setHSL(.55 + .08 * t, .9, .55 + .25 * t);
    const lift = presentation.radius(planet.elevation[i]) + .0045;
    const receiverLift = presentation.radius(planet.elevation[r]) + .0045;
    pts.push(P[3 * i] * lift, P[3 * i + 1] * lift, P[3 * i + 2] * lift, P[3 * r] * receiverLift, P[3 * r + 1] * receiverLift, P[3 * r + 2] * receiverLift);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
}
const esc = s => String(s).replace(/[&<>"]/g, '');
function printWorld() {
  const s = planetSummary(planet);
  document.querySelector('#stats').innerHTML = '<span>Land: ' + Math.round(s.landFraction * 100) + '%</span><span>Plates: ' + s.plates + '</span><span>Seed: ' + esc(planet.seed) + '</span><span>Cells sampled: ' + s.cells + '</span><span>Highest: ' + s.maxElevation + ' m</span><span>Deepest: ' + s.minElevation + ' m</span><span>Axial tilt: ' + s.tilt + '°</span><span>Mean rain: ' + s.meanPrecipitation + ' mm/yr</span><span>Rivers to sea: ' + Math.round(s.hydrology.toSeaM3s / 1000) + 'k m³/s</span><span>Endorheic land: ' + Math.round(s.hydrology.endorheicLandFraction * 100) + '%</span>';
  document.querySelector('#rivers').textContent = planet.hydro.rivers.slice(0, 5).map(r => r.name + ' · ' + r.dischargeM3s.toLocaleString('en-US') + ' m³/s · ' + r.lengthKm.toLocaleString('en-US') + ' km' + (r.endorheic ? ' · closed basin' : '')).join(' | ') || 'No rivers on this world.';
  const g = planet.glaciationComputed ? planet.glaciation : null;
  if (g) {
    const gs = g.stats;
    document.querySelector('#stats').innerHTML += '<span>Glacial sea fall: ' + gs.seaLevelFallM + ' m</span><span>Glacial ice: ' + (gs.glacialIceFraction * 100).toFixed(1) + '%</span><span>Glacial cooling: ' + gs.globalCoolingK + ' K</span>';
    document.querySelector('#iceage').textContent = planet.prehistory + ' Ice sheets: ' + (g.iceSheets.map(x => x.name + ' · ' + Math.round(x.areaKm2 / 1e6 * 10) / 10 + ' M km² · up to ' + x.maxThicknessM.toLocaleString('en-US') + ' m').join(' | ') || 'none') + '. Land bridges: ' + (g.bridges.map(b => b.name + ' · ' + Math.round(b.areaKm2 / 1000).toLocaleString('en-US') + 'k km² · ' + b.lat + '°, ' + b.lon + '°').join(' | ') || 'none') + '.';
    if (window.__planetForge) window.__planetForge.glacialMs = glacialMs;
  } else document.querySelector('#iceage').textContent = 'Choose the Last glacial maximum era or the Ice age layer to compute this world\'s glacial state.';
  document.querySelector('#settlements').textContent = planet.settlements.map(t => t.name + ' · ' + t.biome).join(' | ') || 'No viable settlements in this seed.';
  document.querySelector('#chronicle').textContent = planet.timeline.map(e => e.year + ' — ' + e.event).join(' · ') || 'No recorded settlements.';
}
// Coastal emphasis is derived from existing elevation, never added to the world simulation.
function computeCoasts() {
  coastalMask = new Uint8Array(planet.cellCount);
  const tris = baseMesh.triangles, el = planet.elevation;
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i], b = tris[i + 1], c = tris[i + 2];
    const sea = (el[a] < 0) + (el[b] < 0) + (el[c] < 0);
    if (sea && sea < 3) coastalMask[a] = coastalMask[b] = coastalMask[c] = 1;
  }
}
function computeZonalRain() { const sum = new Float64Array(180), cnt = new Float64Array(180); for (let i = 0; i < planet.cellCount; i++) if (planet.elevation[i] >= 0) { const b = Math.min(179, Math.max(0, Math.floor(planet.lat[i] + 90))); sum[b] += planet.rainfall[i]; cnt[b]++; } zonalRain = Array.from(sum, (v, b) => { let s = 0, c = 0; for (let d = -3; d <= 3; d++) { const k = b + d; if (k >= 0 && k < 180) { s += sum[k]; c += cnt[k]; } } return c ? s / c : 0; }); }
// Declared before anything that can call resize() or generate() during start-up (avoids a temporal-dead-zone crash).
let local = null; // PF-19 / PF-32: when set, the app renders this local scene instead of the globe
function generate() { stopTour('stopped: new world'); fogMask = null; diffMap = null; if (local) { local.view.dispose(); local = null; } const t0 = performance.now(); const tilt = tiltSelect.value === 'seed' ? undefined : Number(tiltSelect.value); planet = createPlanet(seedInput.value.trim() || 'ATLAS-001', { frequency: FREQUENCY, mesh: baseMesh, tilt }); glacialMs = null; computeZonalRain(); computeCoasts(); makeGlobe(); selectCell(-1); observatory.resetWorld(); applyCelestial(); printWorld(); window.__planetForge = { seed: planet.seed, version: planet.version, cells: planet.cellCount, tilt: planet.tilt, generateMs: Math.round(performance.now() - t0), glacialMs, sky: presentation.sky.info() }; }
// ---- PF-03 graphics quality and PF-05/07 sky controls ----
const graphicsSelect = document.querySelector('#graphics'), dayButton = document.querySelector('#daycycle'), daySpeed = document.querySelector('#dayspeed'), cloudButton = document.querySelector('#clouds'), clockLabel = document.querySelector('#clock');
const params = new URLSearchParams(location.search), requested = params.get('gfx');
const ceiling = deviceCeiling({ hardwareConcurrency: navigator.hardwareConcurrency, deviceMemory: navigator.deviceMemory, maxTextureSize: renderer.capabilities.maxTextureSize, coarsePointer: matchMedia('(pointer: coarse)').matches });
const qualityController = createQualityController({ mode: TIERS.includes(requested) ? requested : 'auto', ceiling, start: matchMedia('(pointer: coarse)').matches || innerWidth < 700 ? 'medium' : ceiling, now: performance.now() });
graphicsSelect.value = qualityController.state().mode;
function applyQuality(tier) {
  if (presentation.applyQuality(tier)) resize();
  graphicsSelect.options[0].textContent = 'Auto (' + qualityController.tier + ')';
}
graphicsSelect.addEventListener('change', () => { const t = qualityController.setMode(graphicsSelect.value, performance.now()); applyQuality(t || qualityController.tier); });
function syncClock() {
  const lon = presentation.clock.subsolarLon;
  clockLabel.textContent = 'Noon ' + Math.abs(Math.round(lon)) + '°' + (lon < 0 ? 'W' : 'E');
  dayButton.textContent = presentation.clock.playing ? 'Pause' : 'Play';
  dayButton.setAttribute('aria-pressed', String(presentation.clock.playing));
}
dayButton.addEventListener('click', () => { presentation.clock.playing = !presentation.clock.playing; syncClock(); });
daySpeed.addEventListener('change', () => { presentation.clock.speed = daySpeed.value; });
cloudButton.addEventListener('click', () => { const on = cloudButton.getAttribute('aria-pressed') !== 'true'; cloudButton.setAttribute('aria-pressed', String(on)); presentation.setCloudsWanted(on); });
setInterval(() => { if (presentation.clock.playing) syncClock(); }, 500);
applyQuality(qualityController.tier);
window.__planetForgeView = { info: () => ({ ...presentation.info(), controller: qualityController.state(), overlays: overlays.info(), satellites: satellites.info(), local: local ? { kind: local.kind, ...local.state, log: undefined } : null, diff: !!diffMap, selected, fog: !!fogMask, seed: planet.seed, tour: tour ? { route: tour.route, stop: tour.i, of: tour.stops.length } : null, lastTourEnd, rotation: [mesh.rotation.x, mesh.rotation.y], zoom: presentation.getZoom(), store: { events: store.state.events.length, discoveries: store.state.discoveries.length, bookmarks: store.state.bookmarks.length, journal: store.state.journal.length } }),
  cellScreen: c => { const P = baseMesh.positions, v = new THREE.Vector3(P[3 * c], P[3 * c + 1], P[3 * c + 2]).multiplyScalar(presentation.radius(planet.elevation[c])); mesh.localToWorld(v); const facing = v.clone().normalize().dot(camera.position.clone().sub(v).normalize()); v.project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, facing }; },
  select: c => { selectCell(c); return selected; },
  skyRay: (x, y) => { const r = canvas.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1), camera); return presentation.sky.pickStar(ray.ray.direction); },
  starScreen: i => { const c = presentation.sky.catalogue, v = new THREE.Vector3(c.direction[3 * i], c.direction[3 * i + 1], c.direction[3 * i + 2]).multiplyScalar(40).add(camera.position); v.project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, onScreen: Math.abs(v.x) < .95 && Math.abs(v.y) < .95 && v.z < 1, mag: c.magnitude[i] }; },
  setRotation: (rx, ry, zoom) => { tween = null; mesh.rotation.x = rx; mesh.rotation.y = ry; if (Number.isFinite(zoom)) presentation.setZoom(zoom, root.clientWidth, root.clientHeight); },
  neighbours: c => Array.from(baseMesh.neighbors.subarray(baseMesh.offsets[c], baseMesh.offsets[c + 1])),
  eligibleSites: (id, g, n) => { const out = []; for (let i = 0; i < planet.cellCount && out.length < n; i += 89) if (INVESTIGATIONS[id].groups[g].ok(planet, i)) out.push(i); return out; },
  settlementScreen: () => planet.settlements.map((t, k) => { const P = baseMesh.positions, v = new THREE.Vector3(P[3 * t.cell], P[3 * t.cell + 1], P[3 * t.cell + 2]).multiplyScalar(presentation.radius(planet.elevation[t.cell])); mesh.localToWorld(v); const facing = v.clone().normalize().dot(camera.position.clone().sub(v).normalize()); v.project(camera); const r = canvas.getBoundingClientRect(); return { k, cell: t.cell, name: t.name, x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, facing }; }), viewLongitude: () => { const d = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion.clone().invert()); return Math.atan2(d.z, d.x) * 180 / Math.PI; },
  setSubsolarLongitude: lon => { presentation.clock.subsolarLon = lon; syncClock(); return presentation.info(); } };
// Test/diagnostic handle for the sky's quality tiers (PF-01); the world model is not reachable from here.
window.__planetForgeSky = { info: presentation.sky.info, setQuality: q => { presentation.sky.setQuality(q); return presentation.sky.info(); } };
const dockUI = initDockUI();
window.__planetForgeDock = dockUI;
document.querySelector('#generate').addEventListener('click', generate); seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); }); layerSelect.addEventListener('change', makeGlobe); seasonSelect.addEventListener('change', makeGlobe); tiltSelect.addEventListener('change', generate); eraSelect.addEventListener('change', makeGlobe);
document.querySelector('#random').addEventListener('click', () => { seedInput.value = 'WORLD-' + Math.random().toString(36).slice(2, 9).toUpperCase(); generate(); });
document.querySelector('#export').addEventListener('click', () => {
  const g = planet.glaciation; printWorld(); // the atlas always carries the glacial state (computed on demand)
  const n = planet.cellCount, sampled = []; for (let i = 0; i < n; i += 10) sampled.push(cellInfo(planet, i));
  const data = JSON.stringify({ seed: planet.seed, version: planet.version, cellCount: n, geodesicFrequency: planet.frequency, axialTiltDeg: planet.tilt, summary: planetSummary(planet), plates: planet.plates.map(({ density, ...p }) => p), rivers: planet.hydro.rivers.map(({ path, ...r }) => r), lakes: planet.hydro.lakes.filter(l => l.area >= 3).map(({ cells, first, ...l }) => l), settlements: planet.settlements, timeline: planet.timeline, sampledCells: sampled, columns: { plate: Array.from(planet.plate), elevation: Array.from(planet.elevation), boundary: Array.from(planet.boundary), biome: Array.from(planet.biome), koppen: Array.from(planet.koppen), temperature: Array.from(planet.temperature), rainfallMm: Array.from(planet.rainfall), runoffMm: Array.from(planet.hydro.runoff), dischargeM3s: Array.from(planet.hydro.discharge, Math.round), basin: Array.from(planet.hydro.basin), lake: Array.from(planet.hydro.lake), receiver: Array.from(planet.hydro.receiver), glacialState: Array.from(g.cell), glacialIceM: Array.from(g.thickness) }, glacial: { prehistory: planet.prehistory, seaLevelM: Math.round(g.seaLevel * 10) / 10, stats: { ...g.stats, iterations: undefined }, iceSheets: g.iceSheets, landBridges: g.bridges, stateCodes: ['unglaciated', 'glacial ice sheet', 'exposed glacial shelf', 'glacial land bridge', 'present ice, retreated at glacial'] }, koppenCodes: KOPPEN, biomeNames: BIOMES });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'planet-' + planet.seed.replace(/[^a-z0-9-]/gi, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let drag = false, lastX = 0, lastY = 0, px = 0, py = 0, lastInteraction = performance.now();
let velX = 0, velY = 0, inertia = null;
const canvas = renderer.domElement;
canvas.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  console.warn('Planet Forge: WebGL context lost; standing by for restore.');
});
canvas.addEventListener('webglcontextrestored', () => {
  console.info('Planet Forge: WebGL context restored; regenerating GPU resources.');
  if (disposed) return;
  renderedPlanet = null;
  makeGlobe();
});
const pointers = new Map();
let pinchDistance = 0, suppressTap = false;
function pointerSpan() {
  const pair = [...pointers.values()];
  return pair.length < 2 ? 0 : Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
}
canvas.addEventListener('pointerdown', e => {
  interrupt();
  inertia = null;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  lastInteraction = performance.now();
  if (pointers.size === 1) {
    drag = true; lastX = e.clientX; lastY = e.clientY; px = e.clientX; py = e.clientY;
    velX = 0; velY = 0;
  } else {
    drag = false;
    suppressTap = true;
    pinchDistance = pointerSpan();
  }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse' && !e.buttons) { hoverAt = [e.clientX, e.clientY]; return; }
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInteraction = performance.now();
  if (pointers.size >= 2) {
    const span = pointerSpan();
    if (pinchDistance > 0) presentation.zoom((pinchDistance - span) / 65, root.clientWidth, root.clientHeight, true);
    pinchDistance = span;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  const stepY = dx * .006, stepX = dy * .006;
  mesh.rotation.y += stepY;
  mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + stepX, -1.35, 1.35);
  velX = velX * 0.35 + stepY * 0.65;
  velY = velY * 0.35 + stepX * 0.65;
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', e => {
  const tap = pointers.size === 1 && pointers.has(e.pointerId) && !suppressTap;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) suppressTap = false;
  const wasDrag = drag;
  drag = false;
  lastInteraction = performance.now();
  if (tap && Math.hypot(e.clientX - px, e.clientY - py) <= 7) {
    inertia = null;
    inspectAt(e.clientX, e.clientY);
  } else if (wasDrag && motionOK() && Math.hypot(velX, velY) > 0.0008) {
    inertia = { vx: THREE.MathUtils.clamp(velX, -0.06, 0.06), vy: THREE.MathUtils.clamp(velY, -0.04, 0.04) };
  }
});
canvas.addEventListener('pointerleave', () => { hoverAt = null; overlays.setHover(-1); });
let hoverAt = null;
canvas.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) suppressTap = false;
  drag = false;
  inertia = null;
  lastInteraction = performance.now();
});
// PF-10: analytic surface pick in the planet frame (ray vs the displayed relief radius, then a walk over the cell mesh);
// it ignores clouds, markers and overlays, and needs no triangle raycast, so hover picking is cheap.
let lastPick = 0;
function pickAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect(); const mouse = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera); mesh.updateMatrixWorld();
  const inv = mesh.matrixWorld.clone().invert(), o = ray.ray.origin.clone().applyMatrix4(inv), d = ray.ray.direction.clone().transformDirection(inv);
  const cell = pickSurface(baseMesh, o.toArray(), d.toArray(), c => presentation.radius(planet.elevation[c]), lastPick);
  if (cell >= 0) lastPick = cell;
  return cell;
}
function localMove(input) { if (!local || local.state.over) return; local.state = moveVehicle(local.patch, local.list, local.state, input, local.kind === 'ocean' ? 'sub' : 'rover'); local.view.sync(local.state); local.onChange(local.state); }
let skyPick = null; // PF-04: when set, taps that miss the planet pick a star instead (never a planet cell)
function inspectAt(clientX, clientY) {
  if (local) return;
  const cell = pickAt(clientX, clientY);
  if (cell >= 0) { selectCell(cell); return; }
  if (skyPick) { const r = canvas.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1), camera); skyPick(presentation.sky.pickStar(ray.ray.direction)); }
}
// Restore per-world celestial state (star, fleet, constellations) from the gameplay store.
function applyCelestial() {
  const f = store.state.flags, star = f['star:' + planet.seed];
  if (star && STAR_TYPES[star.type]) presentation.setStarLight(STAR_TYPES[star.type].teff, habitability(star).relativeToModel); else presentation.setStarLight(5772, 1);
  satellites.setFleet(f['fleet:' + planet.seed] || []);
  presentation.sky.setConstellations(f['constellations:' + planet.seed] || []);
}
let selected = -1;
function selectCell(best) {
  selected = best; overlays.select(best);
  if (best >= 0) cellLabel.textContent = (planet.settlements.find(t => t.cell === best)?.name ?? (planet.elevation[best] < 0 ? 'Ocean' : BIOMES[planet.biome[best]])) + ' · ' + Math.round(planet.elevation[best]).toLocaleString('en-US') + ' m';
  if (best < 0) { presentation.selectSettlement(-1); return; }
  const P = baseMesh.positions;
  const c = cellInfo(planet, best), p = planet.plates[c.plate];
  // PF-08: a click within 2.5° of a generated settlement selects it and reports its recorded site data.
  let site = -1, sd = Math.cos(2.5 * Math.PI / 180);
  planet.settlements.forEach((t, k) => { const d = P[3 * best] * P[3 * t.cell] + P[3 * best + 1] * P[3 * t.cell + 1] + P[3 * best + 2] * P[3 * t.cell + 2]; if (d > sd) { sd = d; site = k; } });
  presentation.selectSettlement(site);
  const t = planet.settlements[site];
  document.querySelector('#inspect').textContent = (t ? 'Settlement ' + t.name + ' (founded year ' + t.founded + ', ' + t.water + ', ' + t.setting + ', ' + t.climate + ' climate, ' + t.lat + '°, ' + t.lon + '°) · ' : '') + c.lat + '° lat, ' + c.lon + '° lon · ' + c.biome + ' · Köppen ' + c.koppen + ' · ' + c.elevation + ' m · ' + c.temperature + ' °C (Jan ' + c.temperatureJan + ', Jul ' + c.temperatureJul + ') · ' + c.rainfall + ' mm/yr · plate ' + c.plate + ' (' + c.crust + ', ' + p.speedCmYr + ' cm/yr)' + (c.boundary !== 'none' ? ' · ' + c.boundary + ' boundary' : '') + (c.seafloorAgeMyr !== undefined ? ' · seafloor ~' + c.seafloorAgeMyr + ' Myr' : '') + (c.dischargeM3s !== undefined ? ' · ' + (c.lake ? c.lake + ' · ' : '') + 'flow ' + c.dischargeM3s.toLocaleString('en-US') + ' m³/s · runoff ' + c.runoffMm + ' mm/yr · basin ' + c.basin : '') + (c.glacial && glacialView() ? ' · ice age: ' + c.glacial + (c.glacialIceM ? ' ' + c.glacialIceM.toLocaleString('en-US') + ' m thick' : '') : '');
  if (observatory.active === 'cell') observatory.refresh();
}
// ---- PF-10 contextual label, PF-09 fly-to and tours, PF-13 store ----
const cellLabel = document.querySelector('#cell-label'), tourCaption = document.querySelector('#tour-caption');
let tween = null, tour = null;
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
function flyTo(cell, duration = 1.6) {
  const to = facingRotation(cellDir(baseMesh, cell)), from = { x: mesh.rotation.x, y: mesh.rotation.y };
  to.y = from.y + (((to.y - from.y) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI; // shortest way round
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  tween = { from, to, dist, t: 0, dur: motionOK() ? duration : 0 };
}
function stepTween(dt) {
  if (!tween) return false;
  tween.t = tween.dur ? Math.min(1, tween.t + dt / tween.dur) : 1;
  const e = tween.t < .5 ? 4 * tween.t * tween.t * tween.t : 1 - (-2 * tween.t + 2) ** 3 / 2;
  mesh.rotation.x = tween.from.x + (tween.to.x - tween.from.x) * e;
  mesh.rotation.y = tween.from.y + (tween.to.y - tween.from.y) * e;
  if (motionOK() && tween.dur > 0 && tween.dist > 0.35) {
    const arc = Math.sin(Math.PI * tween.t) * 0.10 * Math.min(1, tween.dist / 2.0);
    presentation.setFlyArc(arc, root.clientWidth, root.clientHeight);
  }
  if (tween.t >= 1) {
    if (tween.dur > 0) presentation.setFlyArc(0, root.clientWidth, root.clientHeight);
    tween = null;
  }
  return true;
}
function startTour(route) {
  const stops = tourStops(planet, route).filter(s => s && s.cell >= 0);
  if (!stops.length) return;
  tour = { route, stops, i: -1, hold: 0 }; nextStop();
}
function nextStop() {
  tour.i++;
  if (tour.i >= tour.stops.length) return stopTour('finished');
  const s = tour.stops[tour.i]; flyTo(s.cell, 2.2); selectCell(s.cell); tour.hold = 4.5;
  tourCaption.hidden = false; tourCaption.textContent = `${ROUTES[tour.route]} · ${tour.i + 1}/${tour.stops.length} — ${s.title}: ${s.text}`;
  observatory.refresh();
}
function stopTour(why) {
  if (!tour) return;
  tour = null;
  if (tween) {
    presentation.setFlyArc(0, root.clientWidth, root.clientHeight);
    tween = null;
  }
  tourCaption.hidden = true;
  lastTourEnd = why;
  observatory.refresh();
}
let lastTourEnd = '';
function stepTour(dt) { if (!tour || tween) return; tour.hold -= dt; if (tour.hold <= 0) nextStop(); }
function interrupt() {
  if (tour) stopTour('interrupted');
  if (tween) {
    presentation.setFlyArc(0, root.clientWidth, root.clientHeight);
    tween = null;
  }
  inertia = null;
}
function captureView() { return { rx: mesh.rotation.x, ry: mesh.rotation.y, zoom: presentation.getZoom(), cell: selected >= 0 ? selected : null }; }
function restoreView(v) {
  tween = { from: { x: mesh.rotation.x, y: mesh.rotation.y }, to: { x: v.rx ?? 0, y: v.ry ?? 0 }, t: 0, dur: motionOK() ? 1.2 : 0 };
  if (Number.isFinite(v.zoom)) presentation.setZoom(v.zoom, root.clientWidth, root.clientHeight);
  selectCell(Number.isInteger(v.cell) && v.cell < planet.cellCount ? v.cell : -1);
}
function updateLabel() {
  if (selected < 0 || !mesh) { cellLabel.hidden = true; return; }
  const P = baseMesh.positions, v = new THREE.Vector3(P[3 * selected], P[3 * selected + 1], P[3 * selected + 2]).multiplyScalar(presentation.radius(planet.elevation[selected]));
  mesh.localToWorld(v);
  if (v.clone().normalize().dot(camera.position.clone().sub(v).normalize()) < .1) { cellLabel.hidden = true; return; }
  v.project(camera);
  cellLabel.hidden = false;
  cellLabel.style.transform = `translate(${((v.x + 1) / 2 * root.clientWidth).toFixed(1)}px, ${((1 - v.y) / 2 * root.clientHeight).toFixed(1)}px) translate(-50%, -170%)`;
}
const store = createGameStore();
const gameApi = { // store wrapper: actions with a cell trigger a pooled PF-11 effect at that cell
  get state() { return store.state; }, subscribe: store.subscribe, undo: store.undo, redo: store.redo, canUndo: store.canUndo, canRedo: store.canRedo, replace: store.replace,
  apply(type, payload) { const ok = store.apply(type, payload); if (ok && Number.isInteger(payload?.cell)) overlays.pulse(payload.cell, type === 'bookmark' ? 'bookmark' : type === 'journal' ? 'observation' : 'discovery'); return ok; }
};
const observatory = createObservatoryUI({
  get planet() { return planet; }, get selected() { return selected; }, store: gameApi, overlays,
  select: selectCell, flyTo, startTour, stopTour, captureView, restoreView,
  pulse: (c, kind) => overlays.pulse(c, kind), showRoute: path => overlays.showTransect(path.map(cell => ({ cell }))),
  setFog: mask => { fogMask = mask; makeGlobe(); }, sky: presentation.sky, setDiffMap: d => { diffMap = d; makeGlobe(); },
  enterLocal(patch, list, kind, state, onChange) { if (local) local.view.dispose(); local = { view: createLocalScene(patch, list, kind), patch, list, kind, state, onChange }; local.view.resize(root.clientWidth, root.clientHeight); local.view.sync(state); tourCaption.hidden = true; cellLabel.hidden = true; },
  exitLocal() { if (!local) return; local.view.dispose(); local = null; },
  localMove: input => localMove(input),
  setStarLight: (teff, rel) => presentation.setStarLight(teff, rel), setSun: (lat, lon) => presentation.setSun(lat, lon), setFleet: f => satellites.setFleet(f),
  setSkyPick: fn => { skyPick = fn; }, setSettlementState: (w, st) => presentation.setSettlementState(w, st), highlight: cells => overlays.highlight(cells, 0x9ff0c8), reducedMotion: () => !motionOK(), forge: seed => { seedInput.value = seed; generate(); }, showGlacial: () => { eraSelect.value = 'glacial'; makeGlobe(); },
  flyToLat: lat => { const d = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion.clone().invert()); flyTo(nearestCell(baseMesh, latLonToDir(lat, Math.atan2(d.z, d.x) * 180 / Math.PI), 0)); },
  tourText: () => tour ? `Stop ${tour.i + 1} of ${tour.stops.length}` : lastTourEnd ? 'Tour ' + lastTourEnd + '.' : '',
  worldIdentity: () => ({ seed: planet.seed, tilt: tiltSelect.value === 'seed' ? null : Number(tiltSelect.value), version: planet.version }),
  loadSave(save) {
    const w = save.world, tiltValue = w.tilt === null ? 'seed' : String(w.tilt);
    if ([...tiltSelect.options].some(o => o.value === tiltValue)) tiltSelect.value = tiltValue;
    if (seedInput.value !== w.seed || planet.seed !== w.seed || (w.tilt !== null && planet.tilt !== w.tilt)) { seedInput.value = w.seed; generate(); }
    store.replace(save.state); restoreView(save.view || {}); applyCelestial();
    const sc = save.state.scenario; fogMask = sc?.mode === 'survey' && sc.world === planet.seed ? surveyProgress(planet, sc.survey).mask : null; makeGlobe();
  }
});
canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Planet globe. Drag to rotate; pinch, wheel, or plus and minus to zoom; Enter inspects the centre cell.');
canvas.addEventListener('keydown', e => {
  if (local) { const m = { ArrowUp: [0, -1], w: [0, -1], ArrowDown: [0, 1], s: [0, 1], ArrowLeft: [-1, 0], a: [-1, 0], ArrowRight: [1, 0], d: [1, 0] }[e.key]; if (m) { localMove({ dx: m[0], dy: m[1], dz: 0 }); e.preventDefault(); } else if (e.key === 'q' || e.key === 'e') { localMove({ dx: 0, dy: 0, dz: e.key === 'q' ? 200 : -200 }); e.preventDefault(); } return; }
  if (!mesh) return; const k = e.key; if (k !== 'Tab' && k !== 'Shift') interrupt(); if (k === 'ArrowLeft') mesh.rotation.y -= .12; else if (k === 'ArrowRight') mesh.rotation.y += .12; else if (k === 'ArrowUp') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x - .12, -1.35, 1.35); else if (k === 'ArrowDown') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + .12, -1.35, 1.35); else if (k === '+' || k === '=') presentation.zoom(-1, root.clientWidth, root.clientHeight, !motionOK()); else if (k === '-' || k === '_') presentation.zoom(1, root.clientWidth, root.clientHeight, !motionOK()); else if (k === 'Enter' || k === ' ') { const r = canvas.getBoundingClientRect(); inspectAt(r.left + r.width / 2, r.top + r.height / 2); } else return; e.preventDefault(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); interrupt(); lastInteraction = performance.now(); presentation.zoom(Math.sign(e.deltaY), root.clientWidth, root.clientHeight, !motionOK()); }, { passive: false });
function resize() {
  const w = root.clientWidth, h = root.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  presentation.fitCamera(w, h);
  local?.view.resize(w, h);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(root);
resize();
let lastFrame = performance.now(), prevFrame = 0;
function animate(now = performance.now()) {
  if (disposed) return;
  requestAnimationFrame(animate);
  if (document.hidden) {
    lastFrame = now;
    prevFrame = now;
    return;
  }
  const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  const motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flying = mesh && stepTween(dt);
  if (mesh) stepTour(dt);
  if (inertia && mesh && !flying && !tour && motion) {
    mesh.rotation.y += inertia.vx;
    mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + inertia.vy, -1.35, 1.35);
    const decay = Math.pow(0.91, dt * 60);
    inertia.vx *= decay;
    inertia.vy *= decay;
    if (Math.hypot(inertia.vx, inertia.vy) < 0.0001) inertia = null;
  }
  if (!drag && mesh && !flying && !tour && !inertia && now - lastInteraction > 1500 && motion) mesh.rotation.y += dt * .017;
  if (hoverAt && mesh && !drag) { overlays.setHover(pickAt(hoverAt[0], hoverAt[1])); hoverAt = null; }
  overlays.tick(dt, motion);
  satellites.update(motion ? dt * 120 : 0); // 2 simulated minutes per second; frozen under reduced motion
  updateLabel();
  presentation.tick(dt, motion, mesh, Math.min(.5, prevFrame ? (now - prevFrame) / 1000 : 0));
  if (local) renderer.render(local.view.scene, local.view.camera); else renderer.render(scene, camera);
  const nextTier = qualityController.sample(now - prevFrame, now); prevFrame = now;
  if (nextTier) applyQuality(nextTier);
  presentation.afterFirstFrame();
}
// Let the browser paint the loading screen before the multi-second world generation, then start the loop.
const boot = document.querySelector('#boot');
requestAnimationFrame(() => setTimeout(() => {
  try { generate(); syncClock(); }
  catch (e) { window.__pfBootFail?.('World generation failed: ' + e.message + '.'); throw e; }
  animate();
  requestAnimationFrame(() => {
    // If the patched globe shader failed to link on this GPU, fall back to the plain material so the planet still shows.
    const prog = renderer.properties.get(mesh.material).currentProgram;
    if (prog?.diagnostics?.runnable === false) { globeFallback = true; console.warn('Planet Forge: globe shader failed; using the plain material.'); const old = mesh.material; mesh.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .015 }); old.dispose(); }
    window.__pfStarted = true; boot.hidden = true;
  });
}, 30));
window.addEventListener('pagehide', () => {
  disposed = true;
  resizeObserver.disconnect();
  disposeAnnotation(); mesh?.geometry.dispose(); mesh?.material.dispose();
  presentation.dispose();
  renderer.dispose();
}, { once: true });
