import * as THREE from 'three';
import { createPlanet, geodesicMesh, cellInfo, planetSummary, BIOMES, KOPPEN } from './planet.js';
import { KOPPEN_COLORS } from './climate.js';
import { RIVER_MIN_M3S, LAKE } from './hydrology.js';
import { GLACIAL_CELL } from './glaciation.js';
import './style.css';
import { createPresentation } from './presentation.js';
const root = document.querySelector('#viewer'), seedInput = document.querySelector('#seed'), layerSelect = document.querySelector('#layer'), seasonSelect = document.querySelector('#season'), tiltSelect = document.querySelector('#tilt'), eraSelect = document.querySelector('#era');
let planet, mesh, renderedPlanet = null, annotation = null, zonalRain, coastalMask, disposed = false, glacialMs = null;
const FREQUENCY = 100; // 10f^2+2 = 100,002 cells
const baseMesh = geodesicMesh(FREQUENCY);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, .1, 120);
camera.position.set(0, 0, 3);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
root.appendChild(renderer.domElement);
const presentation = createPresentation(scene, camera, renderer, baseMesh);
const BIOME_COLORS = { Ocean: '#164e70', Ice: '#eef8fa', Tundra: '#92aaa5', 'Boreal forest': '#286b63', 'Cold desert': '#baa17b', 'Temperate grassland': '#a8b276', 'Woodland / shrubland': '#9c925d', 'Temperate seasonal forest': '#4b8860', 'Temperate rainforest': '#2a7756', 'Subtropical desert': '#c79d67', 'Tropical seasonal forest / savanna': '#919f4e', 'Tropical rainforest': '#17664c' };
const koppenColor = KOPPEN.map(k => new THREE.Color(KOPPEN_COLORS[k]));
const biomeColor = BIOMES.map(b => new THREE.Color(BIOME_COLORS[b]));
const SHORE_SEA = new THREE.Color('#488aa5'), SHORE_LAND = new THREE.Color('#cfba91');
const BOUNDARY_COLORS = [null, new THREE.Color('#ff5a3c'), new THREE.Color('#3cc8ff'), new THREE.Color('#ffd23c')];
// Glacial maximum (glacial-0.8): ice sheets shaded by thickness, exposed shelves as land, land bridges highlighted.
const ICE_THIN = new THREE.Color('#cfe3ee'), ICE_THICK = new THREE.Color('#f7fbff'), SHELF = new THREE.Color('#b9a77a'), BRIDGE = new THREE.Color('#ff9f3c'), RETREAT = new THREE.Color('#7fb6c9');
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
function color(i, layer, c) {
  const el = planet.elevation[i];
  if (glacialView() && glacialColor(i, layer, c, planet.glaciation)) return c;
  if (layer === 'plates') { const k = planet.plate[i]; return c.setHSL((k * 0.618034) % 1, .55, planet.continental[i] ? .55 : .36); }
  if (layer === 'boundaries') { const b = planet.boundary[i]; if (b) return c.copy(BOUNDARY_COLORS[b]); return planet.continental[i] ? c.setRGB(.42, .40, .36) : c.setRGB(.10, .16, .24); }
  if (layer === 'age') { if (planet.continental[i]) return c.setRGB(.35, .33, .30); return c.setHSL(THREE.MathUtils.clamp(planet.seafloorAge[i] / 200, 0, 1) * .75, .8, .5); }
  const m = seasonSelect.value === 'jan' ? 0 : seasonSelect.value === 'jul' ? 6 : -1;
  if (layer === 'temperature') { const t = m < 0 ? planet.temperature[i] : planet.climate.temperatureMonthly[12 * i + m]; return c.setHSL(THREE.MathUtils.clamp((40 - t) / 95, 0, 1) * .68, .83, .49); }
  if (layer === 'rainfall') { const r = m < 0 ? planet.rainfall[i] : planet.climate.precipitationMonthly[12 * i + m] * 12; return c.setHSL(.60, .8, Math.min(.78, .1 + Math.log10(1 + r) / 5.2)); }
  if (layer === 'koppen') return c.copy(koppenColor[planet.koppen[i]]);
  if (layer === 'winds') { // rain shadow index: precipitation relative to the zonal-mean land precipitation at that latitude
    if (el < 0) return c.setRGB(.08, .13, .2);
    const z = zonalRain[Math.min(179, Math.max(0, Math.floor(planet.lat[i] + 90)))] || 1, q = Math.log2((planet.rainfall[i] + 20) / (z + 20));
    return q < 0 ? c.setRGB(.55 + Math.min(.4, -q * .18), .42, .22) : c.setRGB(.2, .45 + Math.min(.4, q * .15), .55 + Math.min(.4, q * .2));
  }
  if (layer === 'rivers' || layer === 'basins') {
    if (el < 0) return c.setRGB(.06, .12, .2);
    const lk = planet.hydro.lake[i];
    if (lk === LAKE.fresh) return c.setRGB(.2, .5, .85); if (lk === LAKE.salt) return c.setRGB(.45, .82, .76); if (lk === LAKE.saltFlat) return c.setRGB(.9, .88, .8);
    if (layer === 'rivers') { const v = .2 + Math.min(.35, el / 12000); return c.setRGB(v, v * 1.05, v * .9); }
    const b = planet.hydro.basins[planet.hydro.basin[i]], hsh = Math.imul(b.mouth + 7, 2654435761) >>> 0;
    return b.endorheic ? c.setHSL(.08 + (hsh % 60) / 1000, .45, .3 + (hsh % 7) / 60) : c.setHSL((hsh % 1000) / 1000, .5, .38 + (hsh % 5) / 40);
  }
  if (layer === 'elevation') return el < 0 ? c.setRGB(.03, .05 + Math.max(0, el + 11000) / 44000, .18 + Math.max(0, el + 11000) / 30000) : c.setHSL(.28 - Math.min(.2, el / 40000), .35, Math.min(.88, .22 + el / 9000));
  if (el < 0) {
    const d = THREE.MathUtils.clamp(-el / 9500, 0, 1);
    c.setRGB(.016 + (1 - d) * .028, .058 + (1 - d) * .055, .135 + (1 - d) * .092);
    if (coastalMask?.[i]) c.lerp(SHORE_SEA, .19);
    return c;
  }
  c.copy(biomeColor[planet.biome[i]]);
  if (coastalMask?.[i] && planet.temperature[i] > -1) c.lerp(SHORE_LAND, .14);
  return c;
}
function disposeAnnotation() {
  if (!annotation) return;
  mesh.remove(annotation);
  annotation.geometry.dispose();
  annotation.material.dispose();
  annotation = null;
}
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
      mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(baseMesh.positions.length), 3));
    geometry.setIndex(new THREE.BufferAttribute(baseMesh.triangles, 1));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(baseMesh.positions.length), 3));
    presentation.shapeTerrain(geometry, planet);
    mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .015 }));
    if (rotation) mesh.rotation.copy(rotation);
    scene.add(mesh);
    presentation.installClouds(mesh, planet);
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
  presentation.showClouds(layer === 'biome' && eraSelect.value === 'today');
}
// Prevailing-wind arrows for the selected season (annual = mean of January and July), drawn on ~2,500 cells.
function windArrows() {
  const P = baseMesh.positions, J = planet.climate.wind[0], Y = planet.climate.wind[1], s = seasonSelect.value, pts = [];
  for (let i = 0; i < planet.cellCount; i += 40) {
    const wx = s === 'jan' ? J[3 * i] : s === 'jul' ? Y[3 * i] : (J[3 * i] + Y[3 * i]) / 2, wy = s === 'jan' ? J[3 * i + 1] : s === 'jul' ? Y[3 * i + 1] : (J[3 * i + 1] + Y[3 * i + 1]) / 2, wz = s === 'jan' ? J[3 * i + 2] : s === 'jul' ? Y[3 * i + 2] : (J[3 * i + 2] + Y[3 * i + 2]) / 2;
    const k = 0.045, lift = presentation.radius(planet.elevation[i]) + .009;
    const ox = P[3 * i] * lift, oy = P[3 * i + 1] * lift, oz = P[3 * i + 2] * lift;
    const tx = ox + wx * k, ty = oy + wy * k, tz = oz + wz * k;
    pts.push(ox, oy, oz, tx, ty, tz);
    // arrow head: two short barbs rotated about the local normal
    const nx = P[3 * i], ny = P[3 * i + 1], nz = P[3 * i + 2], cx = wy * nz - wz * ny, cy = wz * nx - wx * nz, cz = wx * ny - wy * nx;
    pts.push(tx, ty, tz, tx - wx * k * .4 + cx * k * .25, ty - wy * k * .4 + cy * k * .25, tz - wz * k * .4 + cz * k * .25, tx, ty, tz, tx - wx * k * .4 - cx * k * .25, ty - wy * k * .4 - cy * k * .25, tz - wz * k * .4 - cz * k * .25);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xf4f7fb, transparent: true, opacity: .8 }));
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
function generate() { const t0 = performance.now(); const tilt = tiltSelect.value === 'seed' ? undefined : Number(tiltSelect.value); planet = createPlanet(seedInput.value.trim() || 'ATLAS-001', { frequency: FREQUENCY, mesh: baseMesh, tilt }); glacialMs = null; computeZonalRain(); computeCoasts(); makeGlobe(); printWorld(); window.__planetForge = { seed: planet.seed, version: planet.version, cells: planet.cellCount, tilt: planet.tilt, generateMs: Math.round(performance.now() - t0), glacialMs, sky: presentation.sky.info() }; }
generate();
// Test/diagnostic handle for the sky's quality tiers (PF-01); the world model is not reachable from here.
window.__planetForgeSky = { info: presentation.sky.info, setQuality: q => { presentation.sky.setQuality(q); return presentation.sky.info(); } };
document.querySelector('#generate').addEventListener('click', generate); seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); }); layerSelect.addEventListener('change', makeGlobe); seasonSelect.addEventListener('change', makeGlobe); tiltSelect.addEventListener('change', generate); eraSelect.addEventListener('change', makeGlobe);
document.querySelector('#random').addEventListener('click', () => { seedInput.value = 'WORLD-' + Math.random().toString(36).slice(2, 9).toUpperCase(); generate(); });
document.querySelector('#export').addEventListener('click', () => {
  const g = planet.glaciation; printWorld(); // the atlas always carries the glacial state (computed on demand)
  const n = planet.cellCount, sampled = []; for (let i = 0; i < n; i += 10) sampled.push(cellInfo(planet, i));
  const data = JSON.stringify({ seed: planet.seed, version: planet.version, cellCount: n, geodesicFrequency: planet.frequency, axialTiltDeg: planet.tilt, summary: planetSummary(planet), plates: planet.plates.map(({ density, ...p }) => p), rivers: planet.hydro.rivers.map(({ path, ...r }) => r), lakes: planet.hydro.lakes.filter(l => l.area >= 3).map(({ cells, first, ...l }) => l), settlements: planet.settlements, timeline: planet.timeline, sampledCells: sampled, columns: { plate: Array.from(planet.plate), elevation: Array.from(planet.elevation), boundary: Array.from(planet.boundary), biome: Array.from(planet.biome), koppen: Array.from(planet.koppen), temperature: Array.from(planet.temperature), rainfallMm: Array.from(planet.rainfall), runoffMm: Array.from(planet.hydro.runoff), dischargeM3s: Array.from(planet.hydro.discharge, Math.round), basin: Array.from(planet.hydro.basin), lake: Array.from(planet.hydro.lake), receiver: Array.from(planet.hydro.receiver), glacialState: Array.from(g.cell), glacialIceM: Array.from(g.thickness) }, glacial: { prehistory: planet.prehistory, seaLevelM: Math.round(g.seaLevel * 10) / 10, stats: { ...g.stats, iterations: undefined }, iceSheets: g.iceSheets, landBridges: g.bridges, stateCodes: ['unglaciated', 'glacial ice sheet', 'exposed glacial shelf', 'glacial land bridge', 'present ice, retreated at glacial'] }, koppenCodes: KOPPEN, biomeNames: BIOMES });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'planet-' + planet.seed.replace(/[^a-z0-9-]/gi, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let drag = false, lastX = 0, lastY = 0, px = 0, py = 0, lastInteraction = performance.now();
const canvas = renderer.domElement;
const pointers = new Map();
let pinchDistance = 0, suppressTap = false;
function pointerSpan() {
  const pair = [...pointers.values()];
  return pair.length < 2 ? 0 : Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
}
canvas.addEventListener('pointerdown', e => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  canvas.setPointerCapture(e.pointerId);
  lastInteraction = performance.now();
  if (pointers.size === 1) {
    drag = true; lastX = e.clientX; lastY = e.clientY; px = e.clientX; py = e.clientY;
  } else {
    drag = false;
    suppressTap = true;
    pinchDistance = pointerSpan();
  }
});
canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  lastInteraction = performance.now();
  if (pointers.size >= 2) {
    const span = pointerSpan();
    if (pinchDistance > 0) presentation.zoom((pinchDistance - span) / 65, root.clientWidth, root.clientHeight);
    pinchDistance = span;
    return;
  }
  if (!drag) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  mesh.rotation.y += dx * .006;
  mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + dy * .006, -1.35, 1.35);
  lastX = e.clientX; lastY = e.clientY;
});
canvas.addEventListener('pointerup', e => {
  const tap = pointers.size === 1 && pointers.has(e.pointerId) && !suppressTap;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) suppressTap = false;
  drag = false;
  lastInteraction = performance.now();
  if (tap && Math.hypot(e.clientX - px, e.clientY - py) <= 7) inspectAt(e.clientX, e.clientY);
});
canvas.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) suppressTap = false;
  drag = false;
  lastInteraction = performance.now();
});
function inspectAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect(); const mouse = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera); const hit = ray.intersectObject(mesh)[0]; if (!hit) return;
  const local = mesh.worldToLocal(hit.point.clone()); const P = baseMesh.positions; let best = hit.face.a, bd = Infinity;
  for (const k of [hit.face.a, hit.face.b, hit.face.c]) { const d = (P[3 * k] - local.x) ** 2 + (P[3 * k + 1] - local.y) ** 2 + (P[3 * k + 2] - local.z) ** 2; if (d < bd) { bd = d; best = k; } }
  const c = cellInfo(planet, best), p = planet.plates[c.plate];
  document.querySelector('#inspect').textContent = c.lat + '° lat, ' + c.lon + '° lon · ' + c.biome + ' · Köppen ' + c.koppen + ' · ' + c.elevation + ' m · ' + c.temperature + ' °C (Jan ' + c.temperatureJan + ', Jul ' + c.temperatureJul + ') · ' + c.rainfall + ' mm/yr · plate ' + c.plate + ' (' + c.crust + ', ' + p.speedCmYr + ' cm/yr)' + (c.boundary !== 'none' ? ' · ' + c.boundary + ' boundary' : '') + (c.seafloorAgeMyr !== undefined ? ' · seafloor ~' + c.seafloorAgeMyr + ' Myr' : '') + (c.dischargeM3s !== undefined ? ' · ' + (c.lake ? c.lake + ' · ' : '') + 'flow ' + c.dischargeM3s.toLocaleString('en-US') + ' m³/s · runoff ' + c.runoffMm + ' mm/yr · basin ' + c.basin : '') + (c.glacial && glacialView() ? ' · ice age: ' + c.glacial + (c.glacialIceM ? ' ' + c.glacialIceM.toLocaleString('en-US') + ' m thick' : '') : '');
}
canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Planet globe. Drag to rotate; pinch, wheel, or plus and minus to zoom; Enter inspects the centre cell.');
canvas.addEventListener('keydown', e => { if (!mesh) return; const k = e.key; if (k === 'ArrowLeft') mesh.rotation.y -= .12; else if (k === 'ArrowRight') mesh.rotation.y += .12; else if (k === 'ArrowUp') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x - .12, -1.35, 1.35); else if (k === 'ArrowDown') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + .12, -1.35, 1.35); else if (k === '+' || k === '=') presentation.zoom(-1, root.clientWidth, root.clientHeight); else if (k === '-' || k === '_') presentation.zoom(1, root.clientWidth, root.clientHeight); else if (k === 'Enter' || k === ' ') { const r = canvas.getBoundingClientRect(); inspectAt(r.left + r.width / 2, r.top + r.height / 2); } else return; e.preventDefault(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); lastInteraction = performance.now(); presentation.zoom(Math.sign(e.deltaY), root.clientWidth, root.clientHeight); }, { passive: false });
function resize() {
  const w = root.clientWidth, h = root.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  presentation.fitCamera(w, h);
}
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(root);
resize();
let lastFrame = performance.now();
function animate(now = performance.now()) {
  if (disposed) return;
  requestAnimationFrame(animate);
  const dt = Math.min(.05, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;
  if (!drag && mesh && now - lastInteraction > 1500 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    mesh.rotation.y += dt * .017;
    presentation.advance(dt);
  }
  renderer.render(scene, camera);
  presentation.afterFirstFrame();
}
animate();
window.addEventListener('pagehide', () => {
  disposed = true;
  resizeObserver.disconnect();
  mesh?.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
  presentation.dispose();
  renderer.dispose();
}, { once: true });
