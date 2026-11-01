import * as THREE from 'three';
import { heightAt } from './localTerrain.js';

// Local scene for PF-19 (surface) and PF-32 (seafloor). Rendered by the app's single renderer from its single
// animation loop (the app swaps which scene it draws). Horizontal unit = one grid step; heights are scaled so
// 1 grid step ≈ 3 km and relief is exaggerated ×4 for readability (stated in the UI). Everything is disposed on exit.
const VERT = 1 / 750; // metres → scene units (×4 exaggeration relative to a 3 km grid step)

export function createLocalScene(patch, siteList, kind) {
  const scene = new THREE.Scene(), g = patch.grid, ocean = kind === 'ocean';
  scene.background = new THREE.Color(ocean ? 0x021826 : 0x0b1a2a);
  scene.fog = new THREE.Fog(ocean ? 0x03263a : 0x24394d, 20, ocean ? 70 : 140);
  const camera = new THREE.PerspectiveCamera(55, 1, .1, 400);
  scene.add(new THREE.HemisphereLight(ocean ? 0x4d8fb0 : 0xbcd8f0, 0x2a2016, ocean ? .9 : 1.1));
  const sun = new THREE.DirectionalLight(0xffe6c0, ocean ? .6 : 2.2); sun.position.set(30, 60, 20); scene.add(sun);
  const base = patch.height.reduce((a, b) => a + b, 0) / patch.height.length;
  const geo = new THREE.PlaneGeometry(g - 1, g - 1, g - 1, g - 1); geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute('position'), colors = new Float32Array(pos.count * 3), c = new THREE.Color();
  let lo = Infinity, hi = -Infinity; for (const v of patch.height) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  for (let k = 0; k < pos.count; k++) {
    const gx = Math.round(pos.getX(k) + (g - 1) / 2), gy = Math.round(pos.getZ(k) + (g - 1) / 2), hgt = patch.height[gy * g + gx];
    pos.setY(k, (hgt - base) * VERT);
    const t = (hgt - lo) / Math.max(1, hi - lo);
    if (ocean) c.setRGB(.08 + .20 * t, .12 + .22 * t, .16 + .24 * t); else c.setHSL(.16 - .10 * t, .32, .24 + .42 * t);
    colors.set([c.r, c.g, c.b], 3 * k);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, flatShading: true })); scene.add(ground);
  const surfaceY = ocean ? (0 - base) * VERT : null, objects = [ground];
  if (ocean) { const w = new THREE.Mesh(new THREE.PlaneGeometry(g - 1, g - 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1f5c7e, transparent: true, opacity: .35, side: THREE.DoubleSide, depthWrite: false })); w.position.y = surfaceY; scene.add(w); objects.push(w); }
  const toScene = (x, y, hM) => new THREE.Vector3(x - (g - 1) / 2, (hM - base) * VERT, y - (g - 1) / 2);
  const siteGeo = new THREE.CylinderGeometry(.25, .25, 2.4, 10), siteMat = new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0x6b3d00 }), doneMat = new THREE.MeshStandardMaterial({ color: 0x5c6670 });
  const markers = siteList.map(t => { const m = new THREE.Mesh(siteGeo, siteMat); m.position.copy(toScene(t.x, t.y, heightAt(patch, t.x, t.y))).add(new THREE.Vector3(0, 1.2, 0)); scene.add(m); return m; });
  const vehicleGeo = ocean ? new THREE.CapsuleGeometry(.45, 1.2, 4, 10).rotateZ(Math.PI / 2) : new THREE.BoxGeometry(1.4, .7, 1);
  const vehicleMat = new THREE.MeshStandardMaterial({ color: ocean ? 0xffca3a : 0xebf3f7, metalness: ocean ? .2 : .3, roughness: .42, emissive: ocean ? 0x332200 : 0x101418 });
  const vehicle = new THREE.Mesh(vehicleGeo, vehicleMat); scene.add(vehicle);
  const headLight = new THREE.SpotLight(ocean ? 0x90e8ff : 0xfff2d4, ocean ? 2.5 : 2.0, 32, Math.PI / 4, 0.5, 1.2);
  headLight.position.set(0, 0.4, 0);
  const headTarget = new THREE.Object3D(); headTarget.position.set(0, -0.2, 6);
  vehicle.add(headLight); vehicle.add(headTarget); headLight.target = headTarget;
  const landerMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: .65, roughness: .35 });
  const lander = new THREE.Mesh(new THREE.ConeGeometry(.8, 1.6, 6), landerMat); lander.position.copy(toScene(g >> 1, g >> 1, heightAt(patch, g >> 1, g >> 1))).add(new THREE.Vector3(0, .8, 0)); if (!ocean) scene.add(lander);
  let heading = 0;
  function sync(s) {
    const floor = heightAt(patch, s.x, s.y), y = ocean ? Math.max((floor - base) * VERT + .6, surfaceY - s.depth * VERT) : (floor - base) * VERT + .45;
    const target = new THREE.Vector3(s.x - (g - 1) / 2, y, s.y - (g - 1) / 2);
    if (vehicle.position.distanceToSquared(target) > 1e-6) heading = Math.atan2(target.x - vehicle.position.x, target.z - vehicle.position.z);
    vehicle.position.copy(target); vehicle.rotation.y = heading;
    s.collected.forEach(k => { if (markers[k]) markers[k].material = doneMat; });
    camera.position.set(target.x - Math.sin(heading) * 9, target.y + 5, target.z - Math.cos(heading) * 9); camera.lookAt(target);
  }
  function resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); }
  function dispose() {
    headLight.dispose?.();
    scene.traverse(o => { if (o.isMesh) { o.geometry.dispose(); const m = o.material; if (m !== siteMat && m !== doneMat) m.dispose(); } });
    siteMat.dispose(); doneMat.dispose(); siteGeo.dispose();
  }
  return { scene, camera, sync, resize, dispose };
}
