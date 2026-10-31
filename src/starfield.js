import * as THREE from 'three';
import { hashSeed, rng } from './world.js';

// PF-01 galactic starfield: a deterministic star catalogue drawn as point sprites, over a procedural Milky-Way-like
// band with dust lanes and faint distant galaxies. Presentation only: it reads no world data and changes none.
//
// Provenance (same owner, reuse authorised by the owner): the power-law magnitudes, galactic-plane concentration,
// blackbody colour ramp, fbm band with subtractive dust and sparse distant galaxies are adapted from
// westkitty/Event-Horizon-Forge src/render/Starfield.ts (289bdfc); the WebGL point-sprite star shader, the sky-dome
// band shader and the quality-tier star counts are adapted from westkitty/World_Machine src/render/shaders.ts and
// src/render/PlanetView.ts (cc1eb5f). EHF bakes an RGBA16F equirectangular texture for WebGPU lensing; here the sky
// is evaluated per pixel from the view direction instead, so there is no texture, no projection seam and no pole.

export const SKY_SEED = 'PLANET-FORGE-SKY-1';
export const CATALOGUE_SIZE = 14000;   // full catalogue; quality tiers draw its brightest subset
const M_LIMIT = 7.0;                   // faintest catalogue magnitude
const ALPHA = 0.46;                    // log10 N(<m) slope; gives ~25 stars brighter than m = 1 in 14,000 (Earth sky ≈ 20)
const M_BRIGHT = -1.6;
export const SKY_QUALITY = {
  low: { stars: 4500, octaves: 2, detail: 0, cube: 256 },
  medium: { stars: 9000, octaves: 3, detail: 0, cube: 512 },
  high: { stars: CATALOGUE_SIZE, octaves: 4, detail: 1, cube: 640 }
};
// Main-sequence-dominated naked-eye mix; temperatures in kelvin.
const SPECTRAL = [['O', .004, 30000, 40000], ['B', .09, 10000, 30000], ['A', .19, 7500, 10000], ['F', .2, 6000, 7500], ['G', .17, 5200, 6000], ['K', .26, 3700, 5200], ['M', .086, 2600, 3700]];

const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const axpy = (k, a, b) => [k * a[0] + b[0], k * a[1] + b[1], k * a[2] + b[2]];

/** Approximate blackbody colour, normalised to [0, 1] (from Event-Horizon-Forge). */
export function blackbodyRgb(kelvin) {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const cl = v => Math.min(1, Math.max(0, v / 255));
  return [cl(r), cl(g), cl(b)];
}

/**
 * Galactic frame in scene (sky) coordinates. The camera looks along −z (screen right = +x, up = +y) and the globe
 * covers the middle of the view, so landscape screens see sky beside the globe and portrait screens above and below
 * it. The plane is therefore placed through a point 13–17° below the view centre at a shallow seeded slope of 18–30°,
 * with the galactic centre 24–32° along the rising side: the band and bulge show beside the globe on desktop and
 * under it on phones, and the orientation never changes afterwards.
 */
function galacticFrame(random) {
  const deg = Math.PI / 180, side = random() < .5 ? -1 : 1;
  const x0 = (random() * 6 - 3) * deg, y0 = -(13 + random() * 4) * deg, slope = (18 + random() * 12) * deg;
  const through = norm([Math.tan(x0), Math.tan(y0), -1]);
  const raw = [side * Math.cos(slope), Math.sin(slope), 0], tangent = norm(axpy(-dot(raw, through), through, raw));
  const pole = norm(cross(through, tangent));
  const offset = (24 + random() * 8) * deg;
  const centre = norm(axpy(Math.sin(offset), tangent, through.map(x => x * Math.cos(offset))));
  return { pole, centre, east: cross(pole, centre) };
}
const fromGalactic = (f, l, b) => {
  const cb = Math.cos(b);
  return norm([0, 1, 2].map(k => cb * (Math.cos(l) * f.centre[k] + Math.sin(l) * f.east[k]) + Math.sin(b) * f.pole[k]));
};
function gaussian(random) { return Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random()); }

/** Deterministic catalogue: star i is the same star (position, magnitude, temperature) for the same sky seed. */
export function buildStarCatalogue(seed = SKY_SEED, count = CATALOGUE_SIZE) {
  const random = rng(hashSeed('sky:' + seed));
  const frame = galacticFrame(random);
  const direction = new Float32Array(count * 3), magnitude = new Float32Array(count), temperature = new Float32Array(count);
  const color = new Float32Array(count * 3), spectral = new Uint8Array(count), id = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    const m = Math.max(M_BRIGHT, M_LIMIT + Math.log10(1 - random()) / ALPHA);
    const faint = Math.min(1, Math.max(0, (m - 1) / 6));
    const pop = random();
    let d;
    if (pop < .03 + .05 * faint) { // bulge
      d = fromGalactic(frame, gaussian(random) * .2, gaussian(random) * .11);
    } else if (pop < .38 + .32 * faint) { // thin disk: exponential in latitude, longitude crowded toward the centre
      const scale = .055 + .07 * (1 - faint), u = random() - .5;
      const b = -Math.sign(u) * scale * Math.log(1 - 2 * Math.abs(u));
      const l = random() < .35 ? gaussian(random) * .7 : (random() * 2 - 1) * Math.PI;
      d = fromGalactic(frame, l, b);
    } else { // isotropic nearby stars
      const z = random() * 2 - 1, a = random() * 2 * Math.PI, r = Math.sqrt(1 - z * z);
      d = [r * Math.cos(a), z, r * Math.sin(a)];
    }
    let s = random(), k = 0;
    while (k < SPECTRAL.length - 1 && s > SPECTRAL[k][1]) { s -= SPECTRAL[k][1]; k++; }
    const t = SPECTRAL[k][2] + random() * (SPECTRAL[k][3] - SPECTRAL[k][2]);
    const bb = blackbodyRgb(t), white = .42; // perceived stellar colour is only mildly saturated
    direction.set(d, 3 * i); magnitude[i] = m; temperature[i] = t; spectral[i] = k; id[i] = i;
    for (let c = 0; c < 3; c++) color[3 * i + c] = bb[c] * (1 - white) + white;
  }
  const galaxies = [];
  for (let n = 0; galaxies.length < 10 && n < 400; n++) {
    let d;
    if (galaxies.length < 4 && n < 80) { // a few in the default view: beside the globe (landscape) and above it (portrait)
      const k = n % 4, deg = Math.PI / 180;
      const x = k < 2 ? (k ? -1 : 1) * (22 + random() * 10) * deg : (random() * 12 - 6) * deg, y = k < 2 ? (random() * 24 - 12) * deg : (12 + random() * 7) * deg;
      d = norm([Math.tan(x), Math.tan(y), -1]);
    } else { const z = random() * 2 - 1, a = random() * 2 * Math.PI, r = Math.sqrt(1 - z * z); d = [r * Math.cos(a), z, r * Math.sin(a)]; }
    if (Math.abs(dot(d, frame.pole)) < Math.sin(9 * Math.PI / 180)) continue; // hidden by the galactic plane
    const ref = Math.abs(d[1]) < .9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(ref, d)), v = cross(d, u), pa = random() * Math.PI;
    galaxies.push({ direction: d, major: norm(axpy(Math.cos(pa), u, v.map(x => x * Math.sin(pa)))), sizeRad: (.35 + random() * .55) * Math.PI / 180, axisRatio: .25 + random() * .65, brightness: .35 + random() * .65 });
  }
  return { seed, count, frame, direction, magnitude, temperature, color, spectral, id, galaxies, signature: catalogueSignature(direction, magnitude, color) };
}
export function catalogueSignature(...arrays) {
  let h = 2166136261;
  for (const a of arrays) { const b = new Uint8Array(a.buffer, a.byteOffset, a.byteLength); for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
/** Ids of the brightest `n` stars, in id order: a tier's limiting magnitude, so ids never change between tiers. */
export function brightestIds(cat, n) {
  const order = Array.from(cat.id).sort((a, b) => cat.magnitude[a] - cat.magnitude[b] || a - b).slice(0, Math.min(n, cat.count));
  return Uint32Array.from(order.sort((a, b) => a - b));
}
/** Apparent size (CSS px) and brightness (0..1) of a star of magnitude m. */
export function starAppearance(m) {
  const lf = Math.max(0, (M_LIMIT - m) * .4); // log10 flux relative to the faintest star
  return { size: Math.min(7, 2 + .95 * lf), brightness: Math.min(1, .2 + .13 * Math.pow(10, lf * .42)) };
}
export function autoSkyQuality(env = globalThis) {
  const forced = env.location ? new URLSearchParams(env.location.search).get('sky') : null;
  if (forced && SKY_QUALITY[forced]) return forced;
  if ((env.navigator?.hardwareConcurrency || 4) <= 2) return 'low';
  if (env.matchMedia?.('(pointer: coarse)').matches || (env.innerWidth || 1200) < 700) return 'medium';
  return 'high';
}

const starVertex = `
attribute vec3 color;
attribute float size;
attribute float brightness;
uniform float uPixelRatio;
varying vec3 vColor;
varying float vBright;
void main() {
  vColor = color;
  vBright = brightness;
  gl_PointSize = size * uPixelRatio;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const starFragment = `
varying vec3 vColor;
varying float vBright;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(p, p);
  if (r2 > 1.0) discard;
  float a = (exp(-r2 * 5.0) + 0.16 * exp(-r2 * 2.0)) * vBright * (1.0 - r2 * r2);
  gl_FragColor = vec4(vColor * a, a);
}`;
const skyVertex = `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const skyFragment = `
#define GALAXIES 10
uniform vec3 uPole;
uniform vec3 uCentre;
uniform float uIntensity;
uniform int uOctaves;
uniform float uDetail;
uniform vec3 uOffset;
uniform vec3 uGalPos[GALAXIES];
uniform vec3 uGalMajor[GALAXIES];
uniform vec3 uGalShape[GALAXIES];
varying vec3 vDir;
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float vnoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1,0,0)), f.x), mix(hash3(i + vec3(0,1,0)), hash3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0,0,1)), hash3(i + vec3(1,0,1)), f.x), mix(hash3(i + vec3(0,1,1)), hash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float n = 0.0, amp = 0.5, norm = 0.0;
  for (int o = 0; o < 4; o++) {
    if (o >= uOctaves) break;
    n += amp * vnoise(p);
    norm += amp;
    amp *= 0.52;
    p *= 2.03;
  }
  return n / norm;
}
void main() {
  vec3 d = normalize(vDir);
  float sb = dot(d, uPole);                         // sine of galactic latitude
  vec3 inPlane = normalize(d - uPole * sb + 1e-5 * uCentre);
  float cosL = dot(inPlane, uCentre);               // cosine of galactic longitude
  float toCentre = acos(clamp(dot(d, uCentre), -1.0, 1.0));
  float width = 0.075 + 0.04 * (1.0 - cosL);
  float band = exp(-sb * sb / (2.0 * width * width));
  float bulge = exp(-(toCentre * toCentre + 2.2 * sb * sb) / (2.0 * 0.17 * 0.17));
  vec3 col = vec3(0.0);
  // Most of the sky is far from the band: skip the noise there (the band term is < 0.4% of its peak).
  if (band + bulge > 0.004) {
    float clouds = fbm(d * 3.1 + uOffset);
    float glow = band * (0.42 + 0.9 * clouds) * (0.55 + 0.45 * cosL) + 1.15 * bulge;
    if (uDetail > 0.5) glow *= 0.82 + 0.36 * vnoise(d * 38.0 + uOffset.zxy);
    // Dust: a meandering central lane plus patchy clouds that absorb the band light.
    float warp = (vnoise(d * 5.0 + uOffset.yzx) - 0.5) * 0.05;
    float lane = exp(-pow(sb - 0.012 + warp, 2.0) / (2.0 * pow(0.22 * width, 2.0)));
    float patches = smoothstep(0.48, 0.78, fbm(d * 7.5 - uOffset));
    float extinction = 1.0 - 0.86 * clamp(lane * 0.85 + patches * 0.75 * band, 0.0, 1.0);
    vec3 tint = mix(vec3(0.60, 0.68, 0.86), vec3(1.0, 0.84, 0.62), clamp(bulge * 1.4 + 0.25 * cosL * band, 0.0, 1.0));
    col = tint * glow * extinction * uIntensity;
  }
  for (int g = 0; g < GALAXIES; g++) {
    vec3 c = uGalPos[g];
    float facing = dot(d, c);
    if (facing < 0.99) continue;
    vec3 t = d - c * facing;
    vec3 minor = cross(c, uGalMajor[g]);
    float x = dot(t, uGalMajor[g]) / uGalShape[g].x;
    float y = dot(t, minor) / (uGalShape[g].x * uGalShape[g].y);
    float r2 = x * x + y * y;
    col += vec3(0.86, 0.82, 0.76) * uGalShape[g].z * uIntensity * (0.55 * exp(-r2 * 3.0) + 1.1 * exp(-r2 * 28.0));
  }
  gl_FragColor = vec4(col, clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0));
}`;
// Per-frame sky: one lookup into the cube map the procedural shader above was rendered into once.
const skyCubeFragment = `
uniform samplerCube uSky;
varying vec3 vDir;
void main() {
  vec3 col = textureCube(uSky, normalize(vDir)).rgb;
  gl_FragColor = vec4(col, max(col.r, max(col.g, col.b)));
}`;

// Sky light is added to whatever lies behind the canvas (the page's deep-space gradient), with alpha accumulated as
// the largest channel so the canvas stays a valid premultiplied image.
const additive = { transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor };

/** Owns the sky for the existing scene; the caller's render loop draws it. One instance per scene. */
export function createStarfield(scene, renderer, { seed = SKY_SEED, quality = autoSkyQuality(), radius = 50 } = {}) {
  const catalogue = buildStarCatalogue(seed);
  const group = new THREE.Group();
  group.name = 'pf-starfield';
  scene.add(group);
  let stars = null, sky = null, cube = null, tier = null, fallback = false, bakeFailed = false, shown = [];
  const canvas = renderer.domElement, rebake = () => build(tier); // GPU render targets lose their contents with the context
  canvas?.addEventListener?.('webglcontextrestored', rebake);

  function build(q) {
    teardown();
    tier = SKY_QUALITY[q] ? q : 'medium';
    const settings = SKY_QUALITY[tier];
    shown = brightestIds(catalogue, settings.stars);
    const n = shown.length, pos = new Float32Array(3 * n), col = new Float32Array(3 * n), size = new Float32Array(n), bright = new Float32Array(n);
    for (let j = 0; j < n; j++) {
      const i = shown[j], look = starAppearance(catalogue.magnitude[i]);
      for (let c = 0; c < 3; c++) { pos[3 * j + c] = catalogue.direction[3 * i + c] * radius * .98; col[3 * j + c] = catalogue.color[3 * i + c]; }
      size[j] = look.size; bright[j] = look.brightness;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(size, 1));
    geometry.setAttribute('brightness', new THREE.BufferAttribute(bright, 1));
    const material = fallback
      ? new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, ...additive })
      : new THREE.ShaderMaterial({ vertexShader: starVertex, fragmentShader: starFragment, uniforms: { uPixelRatio: { value: renderer.getPixelRatio() } }, ...additive });
    stars = new THREE.Points(geometry, material);
    stars.name = 'pf-stars';
    stars.renderOrder = -9;
    stars.frustumCulled = false;
    group.add(stars);
    if (fallback) return;
    const g = catalogue.galaxies, pad = k => Array.from({ length: 10 }, (_, i) => g[i] ? k(g[i]) : new THREE.Vector3(0, 0, 1));
    const proceduralMaterial = new THREE.ShaderMaterial({
      vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, blending: THREE.NoBlending, depthWrite: false, depthTest: false,
      uniforms: {
        uPole: { value: new THREE.Vector3(...catalogue.frame.pole) }, uCentre: { value: new THREE.Vector3(...catalogue.frame.centre) },
        uIntensity: { value: .2 }, uOctaves: { value: settings.octaves }, uDetail: { value: settings.detail },
        uOffset: { value: new THREE.Vector3(hashSeed(seed + ':x') % 997 / 9.1, hashSeed(seed + ':y') % 997 / 9.1, hashSeed(seed + ':z') % 997 / 9.1) },
        uGalPos: { value: pad(x => new THREE.Vector3(...x.direction)) }, uGalMajor: { value: pad(x => new THREE.Vector3(...x.major)) },
        uGalShape: { value: Array.from({ length: 10 }, (_, i) => g[i] ? new THREE.Vector3(g[i].sizeRad, g[i].axisRatio, g[i].brightness) : new THREE.Vector3(1e-3, 1, 0)) }
      }
    });
    const skyGeometry = new THREE.SphereGeometry(radius, 48, 24);
    let skyMaterial;
    if (renderer.isWebGLRenderer) { // bake once: the sky never moves on screen (it follows the camera and the view axis is fixed)
      cube = new THREE.WebGLCubeRenderTarget(settings.cube, { generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      const bakeScene = new THREE.Scene(), bakeMesh = new THREE.Mesh(skyGeometry, proceduralMaterial), cubeCamera = new THREE.CubeCamera(1, radius * 2, cube);
      bakeScene.add(bakeMesh);
      const clear = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      renderer.setClearColor(0x000000, 0);
      cubeCamera.update(renderer, bakeScene);
      renderer.setClearColor(clear, clearAlpha);
      bakeFailed = renderer.properties.get(proceduralMaterial).currentProgram?.diagnostics?.runnable === false;
      proceduralMaterial.dispose();
      skyMaterial = new THREE.ShaderMaterial({ vertexShader: skyVertex, fragmentShader: skyCubeFragment, side: THREE.BackSide, uniforms: { uSky: { value: cube.texture } }, ...additive });
    } else skyMaterial = Object.assign(proceduralMaterial, additive); // no GPU (unit tests): keep the procedural shader
    sky = new THREE.Mesh(skyGeometry, skyMaterial);
    sky.name = 'pf-galaxy';
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    group.add(sky);
  }
  function teardown() {
    for (const o of [stars, sky]) if (o) { group.remove(o); o.geometry.dispose(); o.material.dispose(); }
    cube?.dispose();
    stars = sky = cube = null;
  }
  /** After a frame has been drawn: if either custom shader failed to link, fall back to plain points with no band. */
  function checkShaders() {
    if (fallback) return true;
    const failed = bakeFailed || [stars, sky].some(o => o && renderer.properties.get(o.material).currentProgram?.diagnostics?.runnable === false);
    if (failed) { fallback = true; build(tier); }
    return !failed;
  }
  build(quality);
  return {
    group,
    catalogue,
    /** Keep the sky centred on the viewer: stars are at infinity, so they show no parallax when the camera zooms. */
    follow(camera) { group.position.copy(camera.position); },
    setPixelRatio(r) { if (stars?.material.uniforms) stars.material.uniforms.uPixelRatio.value = r; },
    setQuality(q) { build(q); },
    checkShaders,
    info: () => ({ seed, cubeFace: cube ? cube.width : 0, signature: catalogue.signature, catalogue: catalogue.count, drawn: shown.length, quality: tier, fallback, galaxies: catalogue.galaxies.length, limitingMagnitude: +catalogue.magnitude[shown.reduce((a, i) => catalogue.magnitude[i] > catalogue.magnitude[a] ? i : a, shown[0])].toFixed(2) }),
    dispose() { teardown(); scene.remove(group); canvas?.removeEventListener?.('webglcontextrestored', rebake); }
  };
}
