import * as THREE from 'three';
import { createStarfield } from './starfield.js';
import { PROFILES } from './quality.js';
import { buildCloudField, oceanDepthField, settlementLightField, sunDirection, seasonDeclination } from './surfaceFields.js';

// Procedural, local-only presentation. No textures from outside, no external assets and no simulation mutations:
// every field drawn here is derived from the authoritative world arrays (see surfaceFields.js) or is purely visual.
//
// Lighting has two modes. The natural view (Biomes layer) is lit by a sun fixed in the planet's frame: a moving
// subsolar point gives a day/night terminator, twilight and night-side settlement lights (PF-05, PF-08). Scientific
// layers keep fixed "studio" lighting from the viewer's upper right so they stay readable on every side (as before).
// Visual time of day is never fed back into the climate model.

const STUDIO_SUN = new THREE.Vector3(5, 2.4, 5).normalize();
export const DAY_SPEEDS = { slow: 240, medium: 60, fast: 15 }; // seconds of viewing time per planetary day

// Shared GLSL: climate-informed cloud cover with a two-phase flow-map drift along the model's zonal winds (PF-07).
const cloudGlsl = `
uniform sampler2D uCloudTex;
uniform float uCloudTime;
float cloudSample(vec3 d, float shift) {
  float lat = asin(clamp(d.y, -1.0, 1.0));
  float u = atan(d.z, d.x) / 6.2831853 + 0.5;
  float v = lat / 3.1415927 + 0.5;
  float wind = texture2D(uCloudTex, vec2(0.5, v)).g * 2.0 - 1.0;
  return texture2D(uCloudTex, vec2(u - wind * shift, v)).r;
}
float cloudCover(vec3 d) {
  float p = fract(uCloudTime / 90.0);
  float a = cloudSample(d, p * 0.03), b = cloudSample(d, fract(p + 0.5) * 0.03);
  return mix(a, b, abs(2.0 * p - 1.0));
}`;

export function createPresentation(scene, camera, renderer, baseMesh) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x020710, 0);
  const devicePixelRatio = window.devicePixelRatio || 1;
  let profileName = 'high', profile = PROFILES.high;

  const hemisphere = new THREE.HemisphereLight(0x9bcaf1, 0x071323, 0.82);
  scene.add(hemisphere);
  const sunlight = new THREE.DirectionalLight(0xffe8c7, 2.9);
  sunlight.position.copy(STUDIO_SUN).multiplyScalar(5);
  scene.add(sunlight);
  const bounce = new THREE.DirectionalLight(0x447bb2, 0.32);
  bounce.position.set(-4, -2, -3);
  scene.add(bounce);
  const sunWorld = STUDIO_SUN.clone(), sunLocal = STUDIO_SUN.clone();

  const starfield = createStarfield(scene, renderer, { quality: 'high' });
  let shadersChecked = false;

  // ---- Day clock (PF-05) ----
  const clock = { subsolarLon: 45, playing: false, speed: 'medium', natural: true, declination: 0 };

  // ---- Shared uniforms for the globe, clouds and atmosphere ----
  const shared = {
    uSunLocal: { value: sunLocal }, uNatural: { value: 1 }, uOceanFx: { value: 1 }, uSwell: { value: 1 }, uTime: { value: 0 },
    uCloudTex: { value: null }, uCloudTime: { value: 0 }, uCloudShadow: { value: 0 }, uLightsOn: { value: 1 }
  };

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunWorld }, uNatural: shared.uNatural },
    vertexShader: `varying vec3 vWorldNormal; varying vec3 vWorldPosition;
void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorldPosition = world.xyz; vWorldNormal = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * world; }`,
    fragmentShader: `uniform vec3 uSun; uniform float uNatural; varying vec3 vWorldNormal; varying vec3 vWorldPosition;
void main() {
  vec3 N = normalize(vWorldNormal); vec3 V = normalize(cameraPosition - vWorldPosition);
  float rim = pow(1.0 - abs(dot(N, V)), 3.2);
  float s = dot(N, uSun);
  float day = smoothstep(-0.35, 0.62, s);
  vec3 col = mix(vec3(0.045, 0.13, 0.31), vec3(0.20, 0.49, 0.81), day);
  float twilight = exp(-pow(s / 0.2, 2.0)) * uNatural;            // dawn/dusk band along the terminator
  col = mix(col, vec3(1.0, 0.52, 0.24), twilight * 0.55);
  gl_FragColor = vec4(col, rim * (0.18 + 0.48 * day + 0.25 * twilight));
}`,
    side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
  });
  const atmosphereGeometry = new THREE.SphereGeometry(1.092, 96, 64);
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.renderOrder = 2;
  scene.add(atmosphere);

  // Physically modest relief exaggeration: it changes geometry, never climate data.
  function radius(elevation) {
    return elevation <= 0 ? 1 : 1 + Math.min(0.041, Math.pow(elevation / 10000, 0.8) * 0.042);
  }
  function shapeTerrain(geometry, planet) {
    const p = geometry.getAttribute('position'), source = baseMesh.positions;
    for (let i = 0; i < planet.cellCount; i++) {
      const r = radius(planet.elevation[i]);
      p.setXYZ(i, source[3 * i] * r, source[3 * i + 1] * r, source[3 * i + 2] * r);
    }
    p.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.setAttribute('aOcean', new THREE.BufferAttribute(oceanDepthField(planet), 1));
    geometry.setAttribute('aLights', new THREE.BufferAttribute(settlementLightField(planet), 1));
  }

  /** Globe material: standard PBR with depth-aware ocean gloss and swell, cloud shadows and night lights patched in. */
  function createGlobeMaterial() {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .015 });
    material.onBeforeCompile = shader => {
      Object.assign(shader.uniforms, shared);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aOcean;\nattribute float aLights;\nvarying float vOcean;\nvarying float vLights;\nvarying vec3 vLocalDir;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOcean = aOcean; vLights = aLights; vLocalDir = normalize(position);');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSunLocal; uniform float uNatural, uOceanFx, uSwell, uTime, uCloudShadow, uLightsOn;
varying float vOcean; varying float vLights; varying vec3 vLocalDir;
${cloudGlsl}
float swellNoise(vec3 p) { return sin(p.x * 1.7 + p.y * 0.4) * sin(p.z * 1.9 - p.y * 0.6) + 0.5 * sin(p.x * 3.1 - p.z * 2.3 + p.y); }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float ocean = step(0.001, vOcean) * uOceanFx;
roughnessFactor = mix(roughnessFactor, 0.2 + 0.1 * (1.0 - vOcean), ocean);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (ocean * uSwell > 0.0) {
  vec3 q = vLocalDir * 160.0 + vec3(uTime * 0.35, 0.0, uTime * 0.27);
  normal = normalize(normal + 0.045 * vec3(swellNoise(q), swellNoise(q.zxy + 7.0), 0.0));
}`)
        .replace('#include <aomap_fragment>', `if (uCloudShadow > 0.0) {
  float cloudShade = 1.0 - 0.5 * cloudCover(normalize(vLocalDir + uSunLocal * 0.015));
  reflectedLight.directDiffuse *= cloudShade; reflectedLight.directSpecular *= cloudShade;
}
#include <aomap_fragment>`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float nightSide = smoothstep(0.06, -0.16, dot(vLocalDir, uSunLocal));
totalEmissiveRadiance += vec3(1.0, 0.68, 0.32) * vLights * vLights * nightSide * uNatural * uLightsOn * 1.1;`);
    };
    return material;
  }

  // ---- Clouds (PF-07) ----
  let clouds = null, cloudTexture = null, cloudKey = '', cloudsWanted = true, cloudsAllowed = true, currentPlanet = null, currentGlobe = null, cloudMonth = -1;
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: { uSunLocal: shared.uSunLocal, uCloudTex: shared.uCloudTex, uCloudTime: shared.uCloudTime, uDetail: { value: 1 }, uNatural: shared.uNatural },
    vertexShader: `varying vec3 vLocalDir; void main() { vLocalDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uSunLocal; uniform float uDetail; varying vec3 vLocalDir;
${cloudGlsl}
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) { vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
void main() {
  vec3 d = normalize(vLocalDir);
  float c = cloudCover(d);
  if (uDetail > 0.5) c *= 0.72 + 0.56 * (0.6 * vn(d * 22.0 + uCloudTime * 0.004) + 0.4 * vn(d * 57.0));
  c = smoothstep(0.08, 0.85, c);
  float light = smoothstep(-0.25, 0.7, dot(d, uSunLocal));
  vec3 tint = mix(vec3(0.15, 0.24, 0.36), vec3(0.93, 0.96, 0.99), light);
  gl_FragColor = vec4(tint, c * (0.12 + 0.68 * light));
}`,
    transparent: true, depthWrite: false
  });
  function rebuildClouds() {
    if (!currentPlanet || !currentGlobe) return;
    const [w, h] = profile.cloudTexture, key = currentPlanet.seed + '|' + currentPlanet.tilt + '|' + cloudMonth + '|' + w;
    if (key !== cloudKey) {
      const field = buildCloudField(currentPlanet, { width: w, height: h, month: cloudMonth });
      cloudTexture?.dispose();
      cloudTexture = new THREE.DataTexture(field.data, w, h, THREE.RGBAFormat);
      cloudTexture.wrapS = THREE.RepeatWrapping; cloudTexture.wrapT = THREE.ClampToEdgeWrapping;
      cloudTexture.magFilter = cloudTexture.minFilter = THREE.LinearFilter; cloudTexture.generateMipmaps = false;
      cloudTexture.needsUpdate = true;
      shared.uCloudTex.value = cloudTexture;
      cloudKey = key;
    }
    const [sw, sh] = profile.cloudSegments;
    if (!clouds || clouds.parent !== currentGlobe || clouds.geometry.parameters.widthSegments !== sw) {
      if (clouds) { clouds.parent?.remove(clouds); clouds.geometry.dispose(); }
      clouds = new THREE.Mesh(new THREE.SphereGeometry(1.054, sw, sh), cloudMaterial);
      clouds.name = 'pf-clouds';
      clouds.renderOrder = 1;
      clouds.raycast = () => {}; // never intercept surface picking
      currentGlobe.add(clouds);
    }
    cloudMaterial.uniforms.uDetail.value = profile.cloudDetail ? 1 : 0;
    syncCloudVisibility();
  }
  function syncCloudVisibility() {
    const on = cloudsWanted && cloudsAllowed;
    if (clouds) clouds.visible = on;
    shared.uCloudShadow.value = on && profile.cloudShadows && cloudTexture ? 1 : 0;
  }

  // ---- Settlement markers (PF-08) ----
  let markers = null, selectedSettlement = -1;
  const markerMaterial = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: 1 }, uSelected: { value: -1 } },
    vertexShader: `attribute float aIndex; attribute float aState; uniform float uPixelRatio; uniform float uSelected; varying float vSel; varying float vRuin;
void main() { vSel = abs(aIndex - uSelected) < 0.5 ? 1.0 : 0.0; vRuin = aState > 0.5 && aState < 1.5 ? 1.0 : 0.0; gl_PointSize = aState > 1.5 ? 0.0 : (vSel > 0.5 ? 19.0 : 12.0) * uPixelRatio; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `varying float vSel; varying float vRuin;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  float ring = smoothstep(0.62, 0.72, r) * (1.0 - smoothstep(0.86, 1.0, r));
  float dot_ = 1.0 - smoothstep(0.22, 0.32, r);
  float a = max(ring, dot_);
  if (a < 0.02) discard;
  vec3 col = mix(mix(vec3(1.0, 0.82, 0.5), vec3(1.0, 0.96, 0.82), vSel), vec3(0.55, 0.55, 0.58), vRuin);
  gl_FragColor = vec4(col, a * (0.85 + 0.15 * vSel));
}`,
    transparent: true, depthWrite: false
  });
  function installSettlements(globe, planet) {
    if (markers) { markers.parent?.remove(markers); markers.geometry.dispose(); }
    const n = planet.settlements.length, pos = new Float32Array(3 * n), index = new Float32Array(n), P = baseMesh.positions;
    planet.settlements.forEach((s, k) => { const r = radius(planet.elevation[s.cell]) + .006; for (let c = 0; c < 3; c++) pos[3 * k + c] = P[3 * s.cell + c] * r; index[k] = k; });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aIndex', new THREE.BufferAttribute(index, 1));
    g.setAttribute('aState', new THREE.BufferAttribute(new Float32Array(n), 1)); // 0 inhabited, 1 ruin, 2 not yet founded
    markers = new THREE.Points(g, markerMaterial);
    markers.name = 'pf-settlements';
    markers.renderOrder = 3;
    markers.raycast = () => {};
    globe.add(markers);
    selectSettlement(-1);
  }
  /** PF-08 + PF-15/23: light each settlement by its recorded population (0–1) and mark ruins / unfounded sites; null resets. */
  function setSettlementState(weights, states) {
    if (!currentGlobe || !currentPlanet) return;
    const lights = currentGlobe.geometry.getAttribute('aLights'); lights.array.set(settlementLightField(currentPlanet, 2, weights)); lights.needsUpdate = true; // in place: no new GPU buffer
    const a = markers?.geometry.getAttribute('aState'); if (a) { for (let k = 0; k < a.count; k++) a.setX(k, states ? states[k] : 0); a.needsUpdate = true; }
  }
  function selectSettlement(k) { selectedSettlement = k; markerMaterial.uniforms.uSelected.value = k; }

  /** Called once per new world mesh. */
  function installWorld(globe, planet) {
    currentPlanet = planet; currentGlobe = globe; cloudKey = '';
    rebuildClouds();
    installSettlements(globe, planet);
  }
  /** Which view is shown: the natural (biome) view gets sunlight, clouds, ocean effects and lights. */
  function setView({ natural, clouds: allowClouds, season, tilt }) {
    clock.natural = natural;
    clock.declination = seasonDeclination(season, tilt);
    shared.uNatural.value = natural ? 1 : 0;
    hemisphere.intensity = natural ? 0.6 : 0.82; // a dimmer sky fill gives a real night side that stays legible
    bounce.intensity = natural ? 0.1 : 0.32;
    shared.uOceanFx.value = natural && profile.ocean ? 1 : 0;
    shared.uSwell.value = natural && profile.swell ? 1 : 0;
    cloudsAllowed = allowClouds;
    const month = season === 'jan' ? 0 : season === 'jul' ? 6 : -1;
    if (month !== cloudMonth) { cloudMonth = month; rebuildClouds(); } else syncCloudVisibility();
  }
  function setCloudsWanted(v) { cloudsWanted = v; syncCloudVisibility(); }

  /** Per-frame update from the single animation loop. `motion` is false under reduced motion. */
  function tick(dt, motion, globe, clockDt = dt) {
    if (motion) { shared.uTime.value += dt; shared.uCloudTime.value += dt; starfield.tick(dt); }
    // the day clock follows real elapsed time (capped), so a slow frame rate does not slow the day
    if (clock.playing) clock.subsolarLon = ((clock.subsolarLon - 360 * clockDt / DAY_SPEEDS[clock.speed]) % 360 + 540) % 360 - 180;
    if (globe) {
      if (clock.natural) {
        sunLocal.fromArray(sunDirection(clock.subsolarLon, clock.declination));
        sunWorld.copy(sunLocal).applyQuaternion(globe.quaternion);
      } else {
        sunWorld.copy(STUDIO_SUN);
        sunLocal.copy(STUDIO_SUN).applyQuaternion(globe.quaternion.clone().invert());
      }
      sunlight.position.copy(sunWorld).multiplyScalar(5);
      bounce.position.copy(sunWorld).multiplyScalar(-4);
    }
  }

  let zoomScale = 1;
  function fitCamera(width, height) {
    if (!width || !height) return;
    const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * width / height);
    const base = Math.max(2.98, 1.13 / Math.sin(Math.min(halfVertical, halfHorizontal)));
    camera.position.z = base * zoomScale;
    starfield.follow(camera);
  }
  const getZoom = () => zoomScale;
  function setZoom(z, width, height) { zoomScale = THREE.MathUtils.clamp(z, 0.81, 2.4); fitCamera(width, height); }
  function zoom(direction, width, height) {
    zoomScale = THREE.MathUtils.clamp(zoomScale + direction * 0.085, 0.81, 2.4);
    fitCamera(width, height);
  }

  /** Apply a PF-03 quality profile. Returns true when the pixel ratio changed (caller must resize). */
  function applyQuality(name) {
    profileName = name; profile = PROFILES[name];
    const pr = Math.min(devicePixelRatio, profile.pixelRatioCap), changed = Math.abs(renderer.getPixelRatio() - pr) > 1e-3;
    if (changed) renderer.setPixelRatio(pr);
    starfield.setQuality(profile.sky);
    starfield.setPixelRatio(pr);
    starfield.setTwinkle(profile.twinkle);
    markerMaterial.uniforms.uPixelRatio.value = pr;
    shared.uOceanFx.value = clock.natural && profile.ocean ? 1 : 0;
    shared.uSwell.value = clock.natural && profile.swell ? 1 : 0;
    rebuildClouds();
    return changed;
  }

  // Called once after the first frame has been drawn: a sky shader that failed to link falls back to plain points.
  function afterFirstFrame() {
    if (shadersChecked) return;
    shadersChecked = true;
    starfield.checkShaders();
  }
  function dispose() {
    starfield.dispose(); atmosphereGeometry.dispose(); atmosphereMaterial.dispose();
    cloudTexture?.dispose(); cloudMaterial.dispose(); clouds?.geometry.dispose();
    markers?.geometry.dispose(); markerMaterial.dispose();
  }
  return {
    radius, shapeTerrain, createGlobeMaterial, getZoom, setZoom, installWorld, setView, setCloudsWanted, tick, fitCamera, zoom, applyQuality, afterFirstFrame, dispose,
    selectSettlement, setSettlementState, clock, sky: starfield,
    get quality() { return profileName; },
    info: () => ({ quality: profileName, pixelRatio: renderer.getPixelRatio(), clouds: !!clouds?.visible, cloudShadows: shared.uCloudShadow.value === 1, ocean: shared.uOceanFx.value === 1, natural: clock.natural, subsolarLon: +clock.subsolarLon.toFixed(2), declination: clock.declination, dayPlaying: clock.playing, selectedSettlement })
  };
}
