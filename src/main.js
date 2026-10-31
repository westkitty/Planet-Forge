import * as THREE from 'three';
import { createPlanet, geodesicMesh, cellInfo, planetSummary, BIOMES, KOPPEN } from './planet.js';
import { KOPPEN_COLORS } from './climate.js';
import { RIVER_MIN_M3S, LAKE } from './hydrology.js';
import './style.css';
const root = document.querySelector('#viewer'), seedInput = document.querySelector('#seed'), layerSelect = document.querySelector('#layer'), seasonSelect = document.querySelector('#season'), tiltSelect = document.querySelector('#tilt');
let planet, mesh, winds, zonalRain, disposed = false;
const FREQUENCY = 100; // 10f^2+2 = 100,002 cells
const baseMesh = geodesicMesh(FREQUENCY);
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 0, 3.4);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace; root.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xa9c2e1, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(4, 2, 5); scene.add(sun);
const BIOME_COLORS = { Ocean: '#175d83', Ice: '#e4f0f6', Tundra: '#a7b0a6', 'Boreal forest': '#2a6c62', 'Cold desert': '#c9b993', 'Temperate grassland': '#b8b26a', 'Woodland / shrubland': '#9a8f4e', 'Temperate seasonal forest': '#4c895d', 'Temperate rainforest': '#2f7a5c', 'Subtropical desert': '#e2c47e', 'Tropical seasonal forest / savanna': '#a4a643', 'Tropical rainforest': '#146845' };
const koppenColor = KOPPEN.map(k => new THREE.Color(KOPPEN_COLORS[k]));
const biomeColor = BIOMES.map(b => new THREE.Color(BIOME_COLORS[b]));
const BOUNDARY_COLORS = [null, new THREE.Color('#ff5a3c'), new THREE.Color('#3cc8ff'), new THREE.Color('#ffd23c')];
function color(i, layer, c) {
  const el = planet.elevation[i];
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
  return c.copy(biomeColor[planet.biome[i]]);
}
function makeGlobe() {
  let keep = null; if (mesh) { keep = mesh.rotation.clone(); scene.remove(mesh); mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(baseMesh.positions), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(baseMesh.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(baseMesh.triangles, 1));
  const colors = new Float32Array(planet.cellCount * 3), c = new THREE.Color(), layer = layerSelect.value;
  for (let i = 0; i < planet.cellCount; i++) { color(i, layer, c); colors[3 * i] = c.r; colors[3 * i + 1] = c.g; colors[3 * i + 2] = c.b; }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); if (keep) mesh.rotation.copy(keep); scene.add(mesh);
  if (layer === 'winds') mesh.add(windArrows());
  if (layer === 'rivers' || layer === 'basins') mesh.add(riverLines());
}
// Prevailing-wind arrows for the selected season (annual = mean of January and July), drawn on ~2,500 cells.
function windArrows() {
  const P = baseMesh.positions, J = planet.climate.wind[0], Y = planet.climate.wind[1], s = seasonSelect.value, pts = [];
  for (let i = 0; i < planet.cellCount; i += 40) {
    const wx = s === 'jan' ? J[3 * i] : s === 'jul' ? Y[3 * i] : (J[3 * i] + Y[3 * i]) / 2, wy = s === 'jan' ? J[3 * i + 1] : s === 'jul' ? Y[3 * i + 1] : (J[3 * i + 1] + Y[3 * i + 1]) / 2, wz = s === 'jan' ? J[3 * i + 2] : s === 'jul' ? Y[3 * i + 2] : (J[3 * i + 2] + Y[3 * i + 2]) / 2;
    const k = 0.045, ox = P[3 * i] * 1.004, oy = P[3 * i + 1] * 1.004, oz = P[3 * i + 2] * 1.004, tx = ox + wx * k, ty = oy + wy * k, tz = oz + wz * k;
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
  const P = baseMesh.positions, h = planet.hydro, pts = [], col = [], c = new THREE.Color(), lift = 1.003;
  for (let i = 0; i < planet.cellCount; i++) {
    const q = h.discharge[i], r = h.receiver[i]; if (q < RIVER_MIN_M3S || r < 0 || h.lake[i]) continue;
    const t = Math.min(1, Math.log10(q / RIVER_MIN_M3S) / 3.3); c.setHSL(.55 + .08 * t, .9, .55 + .25 * t);
    pts.push(P[3 * i] * lift, P[3 * i + 1] * lift, P[3 * i + 2] * lift, P[3 * r] * lift, P[3 * r + 1] * lift, P[3 * r + 2] * lift);
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
  document.querySelector('#settlements').textContent = planet.settlements.map(t => t.name + ' · ' + t.biome).join(' | ') || 'No viable settlements in this seed.';
  document.querySelector('#chronicle').textContent = planet.timeline.map(e => e.year + ' — ' + e.event).join(' · ') || 'No recorded settlements.';
}
function computeZonalRain() { const sum = new Float64Array(180), cnt = new Float64Array(180); for (let i = 0; i < planet.cellCount; i++) if (planet.elevation[i] >= 0) { const b = Math.min(179, Math.max(0, Math.floor(planet.lat[i] + 90))); sum[b] += planet.rainfall[i]; cnt[b]++; } zonalRain = Array.from(sum, (v, b) => { let s = 0, c = 0; for (let d = -3; d <= 3; d++) { const k = b + d; if (k >= 0 && k < 180) { s += sum[k]; c += cnt[k]; } } return c ? s / c : 0; }); }
function generate() { const t0 = performance.now(); const tilt = tiltSelect.value === 'seed' ? undefined : Number(tiltSelect.value); planet = createPlanet(seedInput.value.trim() || 'ATLAS-001', { frequency: FREQUENCY, mesh: baseMesh, tilt }); computeZonalRain(); makeGlobe(); printWorld(); window.__planetForge = { seed: planet.seed, version: planet.version, cells: planet.cellCount, tilt: planet.tilt, generateMs: Math.round(performance.now() - t0) }; }
generate();
document.querySelector('#generate').addEventListener('click', generate); seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); }); layerSelect.addEventListener('change', makeGlobe); seasonSelect.addEventListener('change', makeGlobe); tiltSelect.addEventListener('change', generate);
document.querySelector('#random').addEventListener('click', () => { seedInput.value = 'WORLD-' + Math.random().toString(36).slice(2, 9).toUpperCase(); generate(); });
document.querySelector('#export').addEventListener('click', () => {
  const n = planet.cellCount, sampled = []; for (let i = 0; i < n; i += 10) sampled.push(cellInfo(planet, i));
  const data = JSON.stringify({ seed: planet.seed, version: planet.version, cellCount: n, geodesicFrequency: planet.frequency, axialTiltDeg: planet.tilt, summary: planetSummary(planet), plates: planet.plates.map(({ density, ...p }) => p), rivers: planet.hydro.rivers.map(({ path, ...r }) => r), lakes: planet.hydro.lakes.filter(l => l.area >= 3).map(({ cells, first, ...l }) => l), settlements: planet.settlements, timeline: planet.timeline, sampledCells: sampled, columns: { plate: Array.from(planet.plate), elevation: Array.from(planet.elevation), boundary: Array.from(planet.boundary), biome: Array.from(planet.biome), koppen: Array.from(planet.koppen), temperature: Array.from(planet.temperature), rainfallMm: Array.from(planet.rainfall), runoffMm: Array.from(planet.hydro.runoff), dischargeM3s: Array.from(planet.hydro.discharge, Math.round), basin: Array.from(planet.hydro.basin), lake: Array.from(planet.hydro.lake), receiver: Array.from(planet.hydro.receiver) }, koppenCodes: KOPPEN, biomeNames: BIOMES });
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'planet-' + planet.seed.replace(/[^a-z0-9-]/gi, '_') + '.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
let drag = false, lastX = 0, lastY = 0, px = 0, py = 0; const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', e => { drag = true; lastX = e.clientX; lastY = e.clientY; px = e.clientX; py = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - lastX, dy = e.clientY - lastY; mesh.rotation.y += dx * .006; mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + dy * .006, -1.35, 1.35); lastX = e.clientX; lastY = e.clientY; });
canvas.addEventListener('pointerup', e => { drag = false; if (Math.hypot(e.clientX - px, e.clientY - py) > 7) return; inspectAt(e.clientX, e.clientY); });
function inspectAt(clientX, clientY) {
  const r = canvas.getBoundingClientRect(); const mouse = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -(clientY - r.top) / r.height * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(mouse, camera); const hit = ray.intersectObject(mesh)[0]; if (!hit) return;
  const local = mesh.worldToLocal(hit.point.clone()); const P = baseMesh.positions; let best = hit.face.a, bd = Infinity;
  for (const k of [hit.face.a, hit.face.b, hit.face.c]) { const d = (P[3 * k] - local.x) ** 2 + (P[3 * k + 1] - local.y) ** 2 + (P[3 * k + 2] - local.z) ** 2; if (d < bd) { bd = d; best = k; } }
  const c = cellInfo(planet, best), p = planet.plates[c.plate];
  document.querySelector('#inspect').textContent = c.lat + '° lat, ' + c.lon + '° lon · ' + c.biome + ' · Köppen ' + c.koppen + ' · ' + c.elevation + ' m · ' + c.temperature + ' °C (Jan ' + c.temperatureJan + ', Jul ' + c.temperatureJul + ') · ' + c.rainfall + ' mm/yr · plate ' + c.plate + ' (' + c.crust + ', ' + p.speedCmYr + ' cm/yr)' + (c.boundary !== 'none' ? ' · ' + c.boundary + ' boundary' : '') + (c.seafloorAgeMyr !== undefined ? ' · seafloor ~' + c.seafloorAgeMyr + ' Myr' : '') + (c.dischargeM3s !== undefined ? ' · ' + (c.lake ? c.lake + ' · ' : '') + 'flow ' + c.dischargeM3s.toLocaleString('en-US') + ' m³/s · runoff ' + c.runoffMm + ' mm/yr · basin ' + c.basin : '');
}
canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Planet globe. Arrow keys rotate, plus and minus zoom, Enter inspects the centre cell.');
canvas.addEventListener('keydown', e => { if (!mesh) return; const k = e.key; if (k === 'ArrowLeft') mesh.rotation.y -= .12; else if (k === 'ArrowRight') mesh.rotation.y += .12; else if (k === 'ArrowUp') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x - .12, -1.35, 1.35); else if (k === 'ArrowDown') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + .12, -1.35, 1.35); else if (k === '+' || k === '=') camera.position.z = THREE.MathUtils.clamp(camera.position.z - .15, 1.7, 6); else if (k === '-' || k === '_') camera.position.z = THREE.MathUtils.clamp(camera.position.z + .15, 1.7, 6); else if (k === 'Enter' || k === ' ') { const r = canvas.getBoundingClientRect(); inspectAt(r.left + r.width / 2, r.top + r.height / 2); } else return; e.preventDefault(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z + Math.sign(e.deltaY) * .15, 1.7, 6); }, { passive: false });
function resize() { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } new ResizeObserver(resize).observe(root); resize();
function animate() { if (disposed) return; requestAnimationFrame(animate); if (!drag && mesh && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) mesh.rotation.y += .00055; renderer.render(scene, camera); } animate();
window.addEventListener('pagehide', () => { disposed = true; mesh?.geometry.dispose(); mesh?.material.dispose(); renderer.dispose(); }, { once: true });
