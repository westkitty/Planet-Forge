import * as THREE from 'three';

// Procedural, local-only presentation. No textures, external assets or simulation mutations.
export function createPresentation(scene, camera, renderer, baseMesh) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x020710, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, matchMedia('(max-width: 700px)').matches ? 1.45 : 1.75));

  scene.add(new THREE.HemisphereLight(0x9bcaf1, 0x071323, 0.82));
  const sunlight = new THREE.DirectionalLight(0xffe8c7, 2.9);
  sunlight.position.set(5, 2.4, 5);
  scene.add(sunlight);
  const bounce = new THREE.DirectionalLight(0x447bb2, 0.32);
  bounce.position.set(-4, -2, -3);
  scene.add(bounce);
  const sunDir = sunlight.position.clone().normalize();

  // A sparse fixed stellar field gives scale without competing with the planet.
  let rng = 0x8badf00d;
  const random = () => { rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0; return rng / 4294967296; };
  const starPositions = new Float32Array(1100 * 3);
  const starColors = new Float32Array(1100 * 3);
  const starColor = new THREE.Color();
  for (let i = 0; i < 1100; i++) {
    const y = random() * 2 - 1, angle = random() * Math.PI * 2;
    const rad = Math.sqrt(1 - y * y), distance = 45 + random() * 22;
    starPositions[3 * i] = Math.cos(angle) * rad * distance;
    starPositions[3 * i + 1] = y * distance;
    starPositions[3 * i + 2] = Math.sin(angle) * rad * distance;
    starColor.setHSL(0.53 + random() * 0.13, 0.12 + random() * 0.27, 0.4 + random() * 0.36);
    starColors[3 * i] = starColor.r;
    starColors[3 * i + 1] = starColor.g;
    starColors[3 * i + 2] = starColor.b;
  }
  const starsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  starsGeometry.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
  const starsMaterial = new THREE.PointsMaterial({ size: 0.18, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
  const stars = new THREE.Points(starsGeometry, starsMaterial);
  scene.add(stars);

  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: { uSun: { value: sunDir } },
    vertexShader: [
      'varying vec3 vWorldNormal;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec4 world = modelMatrix * vec4(position, 1.0);',
      '  vWorldPosition = world.xyz;',
      '  vWorldNormal = normalize(mat3(modelMatrix) * normal);',
      '  gl_Position = projectionMatrix * viewMatrix * world;',
      '}'
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 uSun;',
      'varying vec3 vWorldNormal;',
      'varying vec3 vWorldPosition;',
      'void main() {',
      '  vec3 N = normalize(vWorldNormal);',
      '  vec3 V = normalize(cameraPosition - vWorldPosition);',
      '  float rim = pow(1.0 - abs(dot(N, V)), 3.2);',
      '  float day = smoothstep(-0.35, 0.62, dot(N, uSun));',
      '  vec3 night = vec3(0.045, 0.13, 0.31);',
      '  vec3 dayColor = vec3(0.20, 0.49, 0.81);',
      '  gl_FragColor = vec4(mix(night, dayColor, day), rim * (0.18 + 0.48 * day));',
      '}'
    ].join('\n'),
    side: THREE.BackSide, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending
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
  }

  let clouds = null;
  function installClouds(globe, planet) {
    const geometry = new THREE.SphereGeometry(1.054, 96, 48);
    const p = geometry.getAttribute('position');
    const alpha = new Float32Array(p.count);
    let hash = 2166136261;
    for (const ch of planet.seed) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
    const phase = (hash % 1000) * 0.009;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n1 = Math.sin(x * 19 + phase + Math.sin(z * 8)) * Math.cos(z * 16 - y * 7);
      const n2 = Math.sin(y * 31 + x * 13 + phase * 0.63) * Math.sin(z * 12 + x * 5);
      const belts = 0.15 + 0.17 * Math.cos(y * 8.5);
      alpha[i] = THREE.MathUtils.clamp((n1 * 0.4 + n2 * 0.19 + belts - 0.03) * 1.25, 0, 0.58);
    }
    geometry.setAttribute('cloudAlpha', new THREE.BufferAttribute(alpha, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: sunDir } },
      vertexShader: [
        'attribute float cloudAlpha;',
        'varying float vOpacity;',
        'varying vec3 vNormal;',
        'void main() {',
        '  vOpacity = cloudAlpha;',
        '  vNormal = normalize(mat3(modelMatrix) * normal);',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uSun;',
        'varying float vOpacity;',
        'varying vec3 vNormal;',
        'void main() {',
        '  float light = smoothstep(-0.40, 0.90, dot(normalize(vNormal), uSun));',
        '  vec3 tint = mix(vec3(0.17, 0.28, 0.42), vec3(0.86, 0.93, 0.97), light);',
        '  gl_FragColor = vec4(tint, vOpacity * (0.17 + 0.60 * light));',
        '}'
      ].join('\n'),
      transparent: true, depthWrite: false, side: THREE.FrontSide
    });
    clouds = new THREE.Mesh(geometry, material);
    clouds.renderOrder = 1;
    globe.add(clouds);
    return clouds;
  }
  function showClouds(visible) { if (clouds) clouds.visible = visible; }
  let zoomScale = 1;
  function fitCamera(width, height) {
    if (!width || !height) return;
    const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * width / height);
    const base = Math.max(2.98, 1.13 / Math.sin(Math.min(halfVertical, halfHorizontal)));
    camera.position.z = base * zoomScale;
  }
  function zoom(direction, width, height) {
    zoomScale = THREE.MathUtils.clamp(zoomScale + direction * 0.085, 0.81, 2.4);
    fitCamera(width, height);
  }
  function advance(dt) {
    if (clouds?.visible) clouds.rotation.y += dt * 0.005;
  }
  function dispose() {
    starsGeometry.dispose(); starsMaterial.dispose(); atmosphereGeometry.dispose(); atmosphereMaterial.dispose();
  }
  return { radius, shapeTerrain, installClouds, showClouds, fitCamera, zoom, advance, dispose };
}
