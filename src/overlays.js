import * as THREE from 'three';

// In-world overlays parented to the globe so they turn with it: PF-10 selection reticle + hover marker, PF-11 pooled
// event effects, PF-27 transect path, PF-31 query highlights. Every object here is presentation; positions come from
// the authoritative mesh and the displayed relief radius.
const UP = new THREE.Vector3(0, 0, 1);

export function createOverlays(baseMesh, radius) {
  const group = new THREE.Group(); group.name = 'pf-overlays';
  const noPick = o => { o.raycast = () => {}; return o; };
  const ringGeometry = new THREE.RingGeometry(.72, 1, 48);
  const reticleMaterial = new THREE.MeshBasicMaterial({ color: 0xffd38a, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide });
  const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xbfe6f2, transparent: true, opacity: .55, depthWrite: false, side: THREE.DoubleSide });
  const reticle = noPick(new THREE.Mesh(ringGeometry, reticleMaterial)), hover = noPick(new THREE.Mesh(ringGeometry, hoverMaterial));
  reticle.renderOrder = hover.renderOrder = 4; reticle.visible = hover.visible = false;
  group.add(reticle, hover);
  let elevation = null, selected = -1, hovered = -1;

  function place(obj, cell, size, lift = .004) {
    const P = baseMesh.positions, n = new THREE.Vector3(P[3 * cell], P[3 * cell + 1], P[3 * cell + 2]);
    obj.position.copy(n).multiplyScalar(radius(elevation[cell]) + lift);
    obj.quaternion.setFromUnitVectors(UP, n);
    obj.scale.setScalar(size);
  }
  function setWorld(planet) { elevation = planet.elevation; select(-1); setHover(-1); clearTransect(); clearHighlights(); for (const e of pool) e.mesh.visible = false; }
  function select(cell) { selected = cell; reticle.visible = cell >= 0; if (cell >= 0) place(reticle, cell, .022); }
  function setHover(cell) { hovered = cell; hover.visible = cell >= 0 && cell !== selected; if (hover.visible) place(hover, cell, .014); }

  // ---- PF-11 effects: fixed pool, finite lifetimes, reduced-motion variant without expansion ----
  const pool = [], POOL = 12, LIFE = 1.8;
  const COLORS = { discovery: 0x9ff0c8, observation: 0x8fd3ff, bookmark: 0xffd38a, settlement: 0xffb46b, hazard: 0xff6b5a, arrival: 0xe6f3ff };
  for (let k = 0; k < POOL; k++) {
    const m = noPick(new THREE.Mesh(ringGeometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })));
    m.visible = false; m.renderOrder = 5; group.add(m); pool.push({ mesh: m, age: LIFE, cell: -1 });
  }
  let spawned = 0;
  function pulse(cell, kind = 'discovery') {
    if (!elevation || cell < 0) return false;
    const e = pool.reduce((a, b) => (b.age > a.age ? b : a)); // reuse the oldest slot: never more than POOL alive
    e.age = 0; e.cell = cell; e.mesh.material.color.setHex(COLORS[kind] ?? COLORS.discovery); e.mesh.visible = true; place(e.mesh, cell, .02, .006);
    spawned++; return true;
  }
  function tick(dt, motion) {
    for (const e of pool) {
      if (!e.mesh.visible) continue;
      e.age += dt; const t = e.age / LIFE;
      if (t >= 1) { e.mesh.visible = false; continue; }
      e.mesh.material.opacity = motion ? (1 - t) * .9 : (t < .8 ? .9 : (1 - t) * 4.5);
      if (motion) e.mesh.scale.setScalar(.02 + .06 * t);
    }
  }
  const activeEffects = () => pool.filter(e => e.mesh.visible).length;

  // ---- PF-27 transect path ----
  let path = null;
  function showTransect(rows) {
    clearTransect();
    const P = baseMesh.positions, pts = [];
    for (const r of rows) { const k = radius(elevation[r.cell]) + .006; pts.push(new THREE.Vector3(P[3 * r.cell] * k, P[3 * r.cell + 1] * k, P[3 * r.cell + 2] * k)); }
    path = noPick(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: .95, depthWrite: false })));
    path.renderOrder = 4; group.add(path);
  }
  function clearTransect() { if (path) { group.remove(path); path.geometry.dispose(); path.material.dispose(); path = null; } }

  // ---- PF-31 query highlights ----
  let marks = null;
  function highlight(cells, color = 0xff9f5a) {
    clearHighlights();
    const P = baseMesh.positions, n = Math.min(cells.length, 6000), pos = new Float32Array(3 * n);
    for (let k = 0; k < n; k++) { const c = cells[k], r = radius(elevation[c]) + .003; for (let j = 0; j < 3; j++) pos[3 * k + j] = P[3 * c + j] * r; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    marks = noPick(new THREE.Points(g, new THREE.PointsMaterial({ color, size: 4, sizeAttenuation: false, transparent: true, opacity: .9, depthWrite: false })));
    marks.renderOrder = 4; group.add(marks);
    return n;
  }
  function clearHighlights() { if (marks) { group.remove(marks); marks.geometry.dispose(); marks.material.dispose(); marks = null; } }

  function dispose() {
    clearTransect(); clearHighlights(); ringGeometry.dispose(); reticleMaterial.dispose(); hoverMaterial.dispose();
    for (const e of pool) e.mesh.material.dispose();
  }
  return { group, setWorld, select, setHover, pulse, tick, showTransect, clearTransect, highlight, clearHighlights, dispose,
    info: () => ({ selected, hovered, reticle: reticle.visible, hover: hover.visible, activeEffects: activeEffects(), poolSize: POOL, spawned, transect: !!path, highlights: marks ? marks.geometry.getAttribute('position').count : 0 }) };
}
