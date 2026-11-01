import * as THREE from 'three';
import { createStarfield, blackbodyRgb } from './starfield.js';
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
  float rim = pow(1.0 - abs(dot(N, V)), 3.0);
  float s = dot(N, uSun);
  float day = smoothstep(-0.25, 0.55, s);
  vec3 dayColor = mix(vec3(0.10, 0.36, 0.84), vec3(0.38, 0.72, 0.99), pow(rim, 1.35));
  vec3 nightColor = vec3(0.022, 0.07, 0.19);
  vec3 col = mix(nightColor, dayColor, day);
  float forward = pow(clamp(dot(V, uSun), 0.0, 1.0), 3.5) * day;
  col += vec3(0.32, 0.62, 0.96) * (forward * 0.30 * rim);
  float twilight = exp(-pow(s / 0.16, 2.0)) * uNatural;
  col = mix(col, vec3(1.0, 0.44, 0.14), twilight * 0.70 * pow(rim, 0.8));
  gl_FragColor = vec4(col, rim * (0.16 + 0.54 * day + 0.32 * twilight));
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
        .replace('#include <common>', '#include <common>\nattribute float aOcean;\nattribute float aLights;\nvarying float vOcean;\nvarying float vLights;\nvarying vec3 vLocalDir;\nvarying vec3 vNormalDir;\nvarying float vElev;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvOcean = aOcean; vLights = aLights; vLocalDir = normalize(position); vNormalDir = normalize(normal); vElev = length(position) - 1.0;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uSunLocal; uniform float uNatural, uOceanFx, uSwell, uTime, uCloudShadow, uLightsOn;
varying float vOcean; varying float vLights; varying vec3 vLocalDir;
varying vec3 vNormalDir; varying float vElev;
${cloudGlsl}
float swellNoise(vec3 p) { return sin(p.x * 1.7 + p.y * 0.4) * sin(p.z * 1.9 - p.y * 0.6) + 0.5 * sin(p.x * 3.1 - p.z * 2.3 + p.y); }`)
        .replace('#include <color_fragment>', `#include <color_fragment>
float ocean = step(0.001, vOcean) * uOceanFx;
float slope = clamp(1.0 - dot(normalize(vNormalDir), normalize(vLocalDir)), 0.0, 1.0);
if (ocean == 0.0 && uNatural > 0.5) {
  float steepness = clamp(slope * 5.5, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.72, 0.69, 0.66), steepness * 0.35);
} else if (ocean > 0.0 && uNatural > 0.5) {
  float shallowRim = clamp(1.0 - vOcean * 3.8, 0.0, 1.0);
  float tropical = clamp(1.0 - abs(vLocalDir.y) * 2.2, 0.0, 1.0);
  vec3 lagoonColor = mix(vec3(0.12, 0.44, 0.54), vec3(0.06, 0.62, 0.66), tropical);
  diffuseColor.rgb = mix(diffuseColor.rgb, lagoonColor, shallowRim * 0.42);
  float abyssalTrench = clamp(-vElev * 15.0 - 0.2, 0.0, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.72, abyssalTrench * 0.35);
  float surf = smoothstep(0.07, 0.005, vOcean);
  if (surf > 0.0) {
    float wavePulse = 0.65 + 0.35 * sin(uTime * 1.6 + vLocalDir.x * 90.0 + vLocalDir.z * 70.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.88, 0.94, 0.97), surf * 0.32 * wavePulse);
  }
}`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
if (ocean > 0.0) {
  roughnessFactor = 0.07 + 0.11 * (1.0 - vOcean);
} else if (uNatural > 0.5) {
  roughnessFactor = mix(0.88, 0.98, clamp(slope * 6.0 + vElev * 12.0, 0.0, 1.0));
}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
if (ocean * uSwell > 0.0) {
  vec3 q = vLocalDir * 160.0 + vec3(uTime * 0.35, 0.0, uTime * 0.27);
  vec3 q2 = vLocalDir * 380.0 - vec3(uTime * 0.20, 0.0, uTime * 0.16);
  normal = normalize(normal + 0.038 * vec3(swellNoise(q), swellNoise(q.zxy + 7.0), 0.0) + 0.015 * vec3(swellNoise(q2), swellNoise(q2.yzx + 3.0), 0.0));
} else if (uNatural > 0.5) {
  float slopeFactor = clamp(slope * 7.0, 0.0, 1.0);
  if (slopeFactor > 0.02) {
    vec3 mq = vLocalDir * 320.0;
    float microRelief = sin(mq.x * 2.1 + mq.y * 1.5) * sin(mq.z * 1.9 - mq.x * 0.7);
    normal = normalize(normal + 0.022 * slopeFactor * vec3(microRelief, -microRelief * 0.5, microRelief * 0.3));
  }
}`)
        .replace('#include <aomap_fragment>', `if (uCloudShadow > 0.0) {
  float sunHeight = clamp(dot(normalize(vLocalDir), normalize(uSunLocal)), 0.08, 1.0);
  float shadowDist = min(0.012 / sunHeight, 0.030);
  float cloudShade = 1.0 - 0.48 * cloudCover(normalize(vLocalDir + uSunLocal * shadowDist));
  reflectedLight.directDiffuse *= cloudShade; reflectedLight.directSpecular *= cloudShade;
}
if (ocean > 0.0 && uNatural > 0.5) {
  float fresnel = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 4.0);
  reflectedLight.directSpecular *= 1.35;
  reflectedLight.indirectDiffuse += vec3(0.18, 0.42, 0.72) * fresnel * 0.40;
}
if (uNatural > 0.5) {
  float sunDot = dot(normalize(vLocalDir), normalize(uSunLocal));
  float twilightGlow = smoothstep(-0.14, 0.02, sunDot) * smoothstep(0.12, -0.02, sunDot);
  reflectedLight.indirectDiffuse += vec3(0.82, 0.38, 0.14) * (twilightGlow * 0.12);
}
#include <aomap_fragment>`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
float nightSide = smoothstep(0.06, -0.16, dot(vLocalDir, uSunLocal));
vec3 nightGlow = mix(vec3(0.003, 0.006, 0.012), vec3(0.005, 0.010, 0.018), ocean) * nightSide * uNatural;
totalEmissiveRadiance += nightGlow + vec3(1.0, 0.68, 0.32) * vLights * vLights * nightSide * uNatural * uLightsOn * 1.1;`);
    };
    return material;
  }

  // ---- Clouds (PF-07) ----
  let clouds = null, cloudTexture = null, cloudKey = '', cloudsWanted = true, cloudsAllowed = true, currentPlanet = null, currentGlobe = null, cloudMonth = -1;
  const cloudMaterial = new THREE.ShaderMaterial({
    uniforms: { uSunLocal: shared.uSunLocal, uCloudTex: shared.uCloudTex, uCloudTime: shared.uCloudTime, uDetail: { value: 1 }, uNatural: shared.uNatural },
    vertexShader: `varying vec3 vLocalDir; void main() { vLocalDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 uSunLocal; uniform float uDetail; uniform float uNatural; varying vec3 vLocalDir;
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
  float sunDot = dot(d, uSunLocal);
  float light = smoothstep(-0.25, 0.7, sunDot);
  vec3 tint = mix(vec3(0.15, 0.24, 0.36), vec3(0.93, 0.96, 0.99), light);
  float cloudTwilight = smoothstep(-0.16, 0.06, sunDot) * smoothstep(0.20, -0.04, sunDot) * uNatural;
  tint = mix(tint, vec3(0.98, 0.56, 0.32), cloudTwilight * 0.62);
  float density = smoothstep(0.25, 0.85, c);
  tint *= mix(vec3(0.85, 0.88, 0.92), vec3(1.0), 1.0 - density * 0.28 * (1.0 - light * 0.4));
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
  /** PF-24: tint and scale the visible sunlight for the configured parent star (presentation only). */
  function setStarLight(teff, relativeFlux) {
    const [r, g, b] = blackbodyRgb(teff), k = .55; sunlight.color.setRGB(r * k + (1 - k), g * k + (1 - k) * .93, b * k + (1 - k) * .82);
    sunlight.intensity = 2.9 * Math.max(.45, Math.min(1.6, Math.pow(relativeFlux, .25)));
  }
  /** Point the natural-view sun at a given subsolar latitude/longitude (e.g. an eclipse's moment). */
  function setSun(lat, lon) { clock.declination = lat; clock.subsolarLon = lon; clock.playing = false; }
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
    // Portrait screens: fit the planet limb to the width (the thin atmosphere rim may crop) so the globe uses more of
    // the tall viewer; landscape keeps the 13 % margin around the atmosphere.
    const margin = width / height < .75 ? 1.0 : 1.13;
    const base = Math.max(2.98, margin / Math.sin(Math.min(halfVertical, halfHorizontal)));
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
    selectSettlement, setSettlementState, setStarLight, setSun, clock, sky: starfield,
    get quality() { return profileName; },
    info: () => ({ quality: profileName, pixelRatio: renderer.getPixelRatio(), clouds: !!clouds?.visible, cloudShadows: shared.uCloudShadow.value === 1, ocean: shared.uOceanFx.value === 1, natural: clock.natural, subsolarLon: +clock.subsolarLon.toFixed(2), declination: clock.declination, dayPlaying: clock.playing, selectedSettlement })
  };
}
