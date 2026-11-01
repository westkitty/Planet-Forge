import * as THREE from 'three';
import { satInertial, orbitPeriodMin, DAY_S, PLANET_RADIUS_KM } from './celestial.js';

// PF-26 satellite markers and orbit paths, parented to the globe (body frame). Positions come from satInertial
// rotated by the planet's spin at the simulation time, scaled so 1 unit = 1 planet radius.
export function createSatelliteView() {
  const group = new THREE.Group(); group.name = 'pf-satellites';
  const pointsGeo = new THREE.BufferGeometry(), pos = new Float32Array(6 * 3);
  pointsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pointsGeo.setDrawRange(0, 0);

  // Soft luminous circular satellite sprite texture with telemetry halo
  let spriteTex = null;
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const ctx = c.getContext('2d');
    if (ctx) {
      const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.25, '#c5f4ff');
      g.addColorStop(0.6, 'rgba(100, 210, 255, 0.65)');
      g.addColorStop(1, 'rgba(100, 210, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(16, 16, 16, 0, Math.PI * 2); ctx.fill();
      spriteTex = new THREE.CanvasTexture(c);
    }
  }

  const points = new THREE.Points(pointsGeo, new THREE.PointsMaterial({
    color: 0xd6f7ff,
    size: 10,
    map: spriteTex,
    sizeAttenuation: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.AdditiveBlending
  }));
  points.raycast = () => {}; points.renderOrder = 6; group.add(points);
  let fleet = [], paths = null, simT = 0;
  const toBody = (v, t) => { const a = -2 * Math.PI * t / DAY_S, c = Math.cos(a), s = Math.sin(a), x = v[0] * c - v[1] * s, y = v[0] * s + v[1] * c; return [x / PLANET_RADIUS_KM, v[2] / PLANET_RADIUS_KM, y / PLANET_RADIUS_KM]; };
  function rebuildPaths() {
    if (paths) { group.remove(paths); paths.geometry.dispose(); paths.material.dispose(); paths = null; }
    if (!fleet.length) return;
    const pts = [];
    for (const o of fleet) { const P = orbitPeriodMin(o.altKm) * 60; let prev = null; for (let k = 0; k <= 96; k++) { const v = toBody(satInertial(o, simT + P * k / 96), simT); if (prev) pts.push(...prev, ...v); prev = v; } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    paths = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x62c9e8, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending })); paths.raycast = () => {}; group.add(paths);
  }
  function setFleet(f) { fleet = f.slice(0, 6); pointsGeo.setDrawRange(0, fleet.length); rebuildPaths(); update(0); }
  function update(dtSim) {
    simT = (simT + dtSim) % (100 * DAY_S);
    fleet.forEach((o, k) => pos.set(toBody(satInertial(o, simT), simT), 3 * k));
    pointsGeo.getAttribute('position').needsUpdate = true;
  }
  function dispose() { if (paths) { paths.geometry.dispose(); paths.material.dispose(); } pointsGeo.dispose(); points.material.dispose(); spriteTex?.dispose(); }
  return { group, setFleet, update, dispose, info: () => ({ satellites: fleet.length, simHours: Math.round(simT / 360) / 10, paths: !!paths }) };
}
