# PF-01 — Definitive galactic starfield

Status: IMPLEMENTED and VERIFIED locally on branch `claude/determined-mayer-wvolun` (baseline main d26a030). Not merged, not deployed, not live-verified.

## What changed for the player

- The old background (1,100 random points at radius 45–67, uniform blue-white tint, no structure) is gone.
- In its place is a fixed, seeded sky: a catalogue of 14,000 stars with a power-law brightness distribution, blackbody-derived colours, and a Milky-Way-like band with a warm central bulge, a meandering dark dust lane and patchy dust, plus ten faint, elongated distant galaxies.
- The band is oriented so that it is visible in the default view on both screen shapes: beside the globe on landscape/desktop screens and below it on portrait phones. Two galaxies sit beside the globe (desktop) and two above it (portrait).
- The sky does not move when the globe is dragged, zoomed, re-forged or re-layered. The planet is unchanged.

Screenshots (headless Chrome + SwiftShader, reduced motion, ATLAS-001): `PF-01/before-desktop.jpg`, `PF-01/after-desktop.jpg`, `PF-01/before-mobile.jpg`, `PF-01/after-mobile.jpg`.

## Architecture

- One module, `src/starfield.js`, owned by the existing presentation lifecycle (`src/presentation.js` creates and disposes it). There is no second renderer, no second animation loop, and no new dependency.
- Scientific core untouched: the starfield reads no world data and writes none. World model stays `glacial-0.8`; the JSON export schema is unchanged.
- **Catalogue** (`buildStarCatalogue(seed)`): pure, deterministic, CPU-side (~37 ms in Node for 14,000 stars). Star *i* is always the same star for a given sky seed. Per star: magnitude `m = 7.0 + log10(u)/0.46` clamped at −1.6 (≈ 22 stars brighter than m 1, 78 brighter than m 2, 200 brighter than m 3; the real sky has ≈ 20 / ≈ 90 / ≈ 170); a population draw (bulge, thin disk with exponential latitude profile and longitudes crowded toward the centre, or isotropic) whose disk fraction grows toward faint magnitudes; a spectral class from a naked-eye O–M mix and a blackbody colour desaturated 42 % toward white. 73 % of stars lie within 15° of the galactic plane (isotropic would be 26 %).
- **Sky seed** is the constant `PLANET-FORGE-SKY-1`, independent of the world seed, so the sky is the same for every world and star ids can later anchor constellations (PF-04). Catalogue signature `b0d0aa15` (FNV-1a over directions, magnitudes and colours) is asserted in unit and browser tests.
- **Galactic frame**: fixed in scene coordinates. The camera always looks along −z at the globe, and the globe covers the middle of the view, so the plane is placed through a point 13–17° below the view axis at a seeded 18–30° slope, with the galactic centre 24–32° along the rising side.
- **Stars**: one `THREE.Points` draw with a soft-core point-sprite shader (Gaussian core + faint halo, size 2.0–7.0 CSS px × device pixel ratio). Sprites are additive and depth-tested, so the globe hides stars behind it.
- **Band, dust and galaxies**: a procedural fragment shader evaluated from the 3-D view direction (value-noise fbm, subtractive dust lane and patches, galaxy ellipses in each galaxy's tangent plane). Because the view axis never changes and the sky group follows the camera position (stars at infinity, no parallax on zoom), the sky is constant on screen. It is therefore **rendered once into a cube render target** (`WebGLCubeRenderTarget` via `CubeCamera`) and drawn every frame with one cube-map lookup. Evaluating it per pixel per frame cost ≈ +100 ms per frame in SwiftShader (see Performance).
- **No seams or pole artifacts**: noise is evaluated on 3-D directions, not on a lat/long image; the cube map uses WebGL2 seamless filtering, and the cube face edges lie 45° off the view axis, outside the default field of view (desktop corners are ≈ 39° off-axis).
- **Compositing**: the canvas stays transparent so the page's existing CSS deep-space gradient remains the base. Sky light is added with custom blending (colour One/One, alpha accumulated as the brightest channel) so the canvas is always a valid premultiplied image.
- **Quality tiers** (`SKY_QUALITY`): low = brightest 4,500 stars (limiting m 5.92), 2 fbm octaves, 256² cube faces; medium = 9,000 (m 6.58), 3 octaves, 512²; high = all 14,000 (m 7.0), 4 octaves + fine detail, 640². Lower tiers are a brighter limiting magnitude of the same catalogue, so star ids never change between tiers. Auto selection: `?sky=low|medium|high` overrides; ≤ 2 hardware threads → low; coarse pointer or width < 700 px → medium; otherwise high. PF-03 will replace this static choice with measured adaptation.
- **Fallback**: after the first frame (and at bake time) the starfield checks three's program diagnostics; if a sky shader failed to link it rebuilds as a plain `PointsMaterial` star layer with no band. On `webglcontextrestored` the cube is re-baked (render-target contents do not survive context loss). The context-loss path was not exercised in a browser.
- **Resource lifecycle**: `setQuality` and `dispose` free the star geometry/material, the dome geometry/material and the cube render target. Test/diagnostic handle: `window.__planetForgeSky.{info, setQuality}`; `window.__planetForge.sky` carries the catalogue info.

## Source provenance

Owner confirmed in this session that the referenced repositories are theirs and that their code may be used directly.

| Idea / code | Source | Use here |
|---|---|---|
| Power-law magnitudes, galactic-plane concentration, blackbody colour ramp (`blackbodyRgb`, copied), fbm band with subtractive dust, sparse off-plane distant galaxies | westkitty/Event-Horizon-Forge `src/render/Starfield.ts` @ 289bdfc | Adapted: EHF bakes an RGBA16F equirectangular texture on the CPU for WebGPU lensing; here the band is a WebGL fragment shader baked to a cube map, and stars are point sprites |
| Point-sprite star shader, sky-dome band shader, value-noise `hash3`/`vnoise` GLSL, tiered star counts | westkitty/World_Machine `src/render/shaders.ts`, `src/render/PlanetView.ts` @ cc1eb5f | Adapted; twinkle removed (PF-02 scope) |

No textures, fonts or other assets were imported. No WebGPU-only code was used.

## Tests and evidence

- `tests/starfield.test.js` (8 tests): seed determinism and signature, value bounds, brightness distribution, plane concentration and colour range, frame orthonormality and in-view band/bulge, tier subsets with stable ids and the auto-tier rules, one-sky-per-scene with full disposal across 5 tier changes, shader-failure fallback.
- `npm test`: 48/48 pass (40 existing + 8 new).
- `npm run build`: OK. JS 538.63 kB (143.57 kB gzip) → 548.93 kB (147.93 kB gzip), CSS unchanged; the existing >500 kB chunk advisory is unchanged.
- `scripts/smoke.mjs` (headless Chrome, SwiftShader, 1280×800 and 390×844): 101/101 pass — the 91 existing checks plus 10 new: sky renders in open sky; sky unchanged (0.0000 changed fraction) after re-forging and dragging; sky unchanged by layer switching; fixed catalogue/no fallback; low/medium/high tiers render with one catalogue. Viewer 85.5 % / console 14.5 % unchanged; zero console, page or network errors (so no shader compile errors).
- `scripts/perf.mjs` (new): matched WebGL-instrumented probe; raw JSON in `PF-01/perf-*.json`.

## Performance (headless SwiftShader software rendering — relative only, not real-GPU numbers)

| | Baseline d26a030 | PF-01 (per-frame procedural sky, rejected) | PF-01 (baked cube, shipped) |
|---|---|---|---|
| Desktop median / p95 frame interval | 166.7 / 316.7 ms (re-run 166.7 / 333.3) | 316.6 / 633.2 ms | 183.4 / 366.8 ms |
| Mobile median / p95 | 133.4 / 283.3 ms (re-run 149.9 / 266.7) | 183.3 / 366.6 ms | 150.0 / 300.1 ms |
| Draw calls per frame | 4 | 5 | 5 |
| Points + triangles submitted per frame | 224,057 | 239,289 | 239,289 (desktop high) / 234,248 (mobile medium) |
| Live GL buffers / textures / programs | 15 / 4 / 4 | 21 / 4 / 5 | 21 / 5 / 5 |
| Buffer bytes uploaded at load | 6.53 MB | 7.00 MB | 7.00 MB desktop / 6.84 MB mobile |
| GPU object leak over 8 forge + layer cycles | 0 | 0 | 0 |
| GPU object leak over 12 tier switches | n/a | 0 | 0 |

- Frame intervals are quantised to 16.7 ms vsync steps; the shipped sky costs about one step on desktop in SwiftShader and is within baseline run-to-run noise on mobile.
- Cube render-target memory (RGBA8, 6 faces): 1.5 MB low, 6.3 MB medium, 9.8 MB high (computed, not measured).
- Re-bake on tier change: 30 ms (medium), 36 ms (high) in SwiftShader; the first switch in that run (to low) took 414 ms, not investigated.
- JS heap varied 38–60 MB at load across runs; no trend attributable to the starfield was found.
- Not measured: real GPU frame times, mobile hardware, thermals, long sessions beyond the probe.

## Known limitations

- Visual approximation, not an astronomical catalogue: no real stars, constellations, proper motions or extinction physics. Magnitudes, colours and densities are plausible, not measured.
- The band's placement assumes the current fixed camera axis; if a future package lets the camera orbit freely (PF-09), the baked cube is still correct (it is a full sphere) but the band will no longer be guaranteed in view.
- The cube bake ties sky resolution to tier: galaxies are ~2–5 texels across at medium/high and are soft by design.
- Tier selection is static at startup (PF-03 adds measured adaptation). Context-loss re-bake is implemented but untested.
- No twinkle or diffraction (PF-02).

## Rollback

Revert the PF-01 commit. Concretely: delete `src/starfield.js` and `tests/starfield.test.js`, restore the previous star block in `src/presentation.js` (git history of d26a030), remove the `afterFirstFrame` call and `__planetForgeSky`/`sky` fields in `src/main.js`, and remove the PF-01 block from `scripts/smoke.mjs`. No data, schema or world-model migration is involved.
