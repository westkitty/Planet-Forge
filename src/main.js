import * as THREE from 'three';
import { createPlanet, geodesicMesh, cellInfo, planetSummary, BIOMES } from './planet.js';
import './style.css';
const root = document.querySelector('#viewer'), seedInput = document.querySelector('#seed'), layerSelect = document.querySelector('#layer');
let planet, mesh, disposed = false;
const FREQUENCY = 100; // 10f^2+2 = 100,002 cells
const baseMesh = geodesicMesh(FREQUENCY);
const scene = new THREE.Scene(); const camera = new THREE.PerspectiveCamera(45, 1, .1, 100); camera.position.set(0, 0, 3.4);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8)); renderer.outputColorSpace = THREE.SRGBColorSpace; root.appendChild(renderer.domElement);
scene.add(new THREE.AmbientLight(0xa9c2e1, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 2.1); sun.position.set(4, 2, 5); scene.add(sun);
const BIOME_COLORS = { Ocean: '#175d83', Ice: '#d8e9f2', Tundra: '#aab3ad', Desert: '#ddc07c', Grassland: '#b3a764', Rainforest: '#146845', 'Boreal forest': '#2a6c62', 'Temperate forest': '#4c895d' };
const biomeColor = BIOMES.map(b => new THREE.Color(BIOME_COLORS[b]));
const BOUNDARY_COLORS = [null, new THREE.Color('#ff5a3c'), new THREE.Color('#3cc8ff'), new THREE.Color('#ffd23c')];
function color(i, layer, c) {
  const el = planet.elevation[i];
  if (layer === 'plates') { const k = planet.plate[i]; return c.setHSL((k * 0.618034) % 1, .55, planet.continental[i] ? .55 : .36); }
  if (layer === 'boundaries') { const b = planet.boundary[i]; if (b) return c.copy(BOUNDARY_COLORS[b]); return planet.continental[i] ? c.setRGB(.42, .40, .36) : c.setRGB(.10, .16, .24); }
  if (layer === 'age') { if (planet.continental[i]) return c.setRGB(.35, .33, .30); return c.setHSL(THREE.MathUtils.clamp(planet.seafloorAge[i] / 200, 0, 1) * .75, .8, .5); }
  if (layer === 'temperature') return c.setHSL(THREE.MathUtils.clamp((40 - planet.temperature[i]) / 95, 0, 1) * .68, .83, .49);
  if (layer === 'rainfall') return c.setHSL(.60, .8, Math.min(.75, .19 + planet.rainfall[i] / 170));
  if (layer === 'elevation') return el < 0 ? c.setRGB(.03, .05 + Math.max(0, el + 11000) / 44000, .18 + Math.max(0, el + 11000) / 30000) : c.setHSL(.28 - Math.min(.2, el / 40000), .35, Math.min(.88, .22 + el / 9000));
  return c.copy(biomeColor[planet.biome[i]]);
}
function makeGlobe() {
  let keep = null; if (mesh) { keep = mesh.rotation.clone(); scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(Float32Array.from(baseMesh.positions), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(Float32Array.from(baseMesh.positions), 3));
  geometry.setIndex(new THREE.BufferAttribute(baseMesh.triangles, 1));
  const colors = new Float32Array(planet.cellCount * 3), c = new THREE.Color(), layer = layerSelect.value;
  for (let i = 0; i < planet.cellCount; i++) { color(i, layer, c); colors[3 * i] = c.r; colors[3 * i + 1] = c.g; colors[3 * i + 2] = c.b; }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })); if (keep) mesh.rotation.copy(keep); scene.add(mesh);
}
const esc = s => String(s).replace(/[&<>"]/g, '');
function printWorld() {
  const s = planetSummary(planet);
  document.querySelector('#stats').innerHTML = '<span>Land: ' + Math.round(s.landFraction * 100) + '%</span><span>Plates: ' + s.plates + '</span><span>Seed: ' + esc(planet.seed) + '</span><span>Cells sampled: ' + s.cells + '</span><span>Highest: ' + s.maxElevation + ' m</span><span>Deepest: ' + s.minElevation + ' m</span>';
  document.querySelector('#settlements').textContent = planet.settlements.map(t => t.name + ' · ' + t.biome).join(' | ') || 'No viable settlements in this seed.';
  document.querySelector('#chronicle').textContent = planet.timeline.map(e => e.year + ' — ' + e.event).join(' · ') || 'No recorded settlements.';
}
function generate() { const t0 = performance.now(); planet = createPlanet(seedInput.value.trim() || 'ATLAS-001', { frequency: FREQUENCY, mesh: baseMesh }); makeGlobe(); printWorld(); window.__planetForge = { seed: planet.seed, version: planet.version, cells: planet.cellCount, generateMs: Math.round(performance.now() - t0) }; }
generate();
document.querySelector('#generate').addEventListener('click', generate); seedInput.addEventListener('keydown', e => { if (e.key === 'Enter') generate(); }); layerSelect.addEventListener('change', makeGlobe);
document.querySelector('#random').addEventListener('click', () => { seedInput.value = 'WORLD-' + Math.random().toString(36).slice(2, 9).toUpperCase(); generate(); });
document.querySelector('#export').addEventListener('click', () => {
  const n = planet.cellCount, sampled = []; for (let i = 0; i < n; i += 10) sampled.push(cellInfo(planet, i));
  const data = JSON.stringify({ seed: planet.seed, version: planet.version, cellCount: n, geodesicFrequency: planet.frequency, summary: planetSummary(planet), plates: planet.plates.map(({ density, ...p }) => p), settlements: planet.settlements, timeline: planet.timeline, sampledCells: sampled, columns: { plate: Array.from(planet.plate), elevation: Array.from(planet.elevation), boundary: Array.from(planet.boundary), biome: Array.from(planet.biome) } });
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
  document.querySelector('#inspect').textContent = c.lat + '° lat, ' + c.lon + '° lon · ' + c.biome + ' · ' + c.elevation + ' m · ' + c.temperature + ' °C · moisture proxy ' + c.rainfall + ' · plate ' + c.plate + ' (' + c.crust + ', ' + p.speedCmYr + ' cm/yr)' + (c.boundary !== 'none' ? ' · ' + c.boundary + ' boundary' : '') + (c.seafloorAgeMyr !== undefined ? ' · seafloor ~' + c.seafloorAgeMyr + ' Myr' : '');
}
canvas.tabIndex = 0; canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Planet globe. Arrow keys rotate, plus and minus zoom, Enter inspects the centre cell.');
canvas.addEventListener('keydown', e => { if (!mesh) return; const k = e.key; if (k === 'ArrowLeft') mesh.rotation.y -= .12; else if (k === 'ArrowRight') mesh.rotation.y += .12; else if (k === 'ArrowUp') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x - .12, -1.35, 1.35); else if (k === 'ArrowDown') mesh.rotation.x = THREE.MathUtils.clamp(mesh.rotation.x + .12, -1.35, 1.35); else if (k === '+' || k === '=') camera.position.z = THREE.MathUtils.clamp(camera.position.z - .15, 1.7, 6); else if (k === '-' || k === '_') camera.position.z = THREE.MathUtils.clamp(camera.position.z + .15, 1.7, 6); else if (k === 'Enter' || k === ' ') { const r = canvas.getBoundingClientRect(); inspectAt(r.left + r.width / 2, r.top + r.height / 2); } else return; e.preventDefault(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); camera.position.z = THREE.MathUtils.clamp(camera.position.z + Math.sign(e.deltaY) * .15, 1.7, 6); }, { passive: false });
function resize() { const w = root.clientWidth, h = root.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } new ResizeObserver(resize).observe(root); resize();
function animate() { if (disposed) return; requestAnimationFrame(animate); if (!drag && mesh && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) mesh.rotation.y += .00055; renderer.render(scene, camera); } animate();
window.addEventListener('pagehide', () => { disposed = true; mesh?.geometry.dispose(); mesh?.material.dispose(); renderer.dispose(); }, { once: true });
