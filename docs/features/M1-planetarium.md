# Milestone 1 — Planetarium (PF-02, PF-03, PF-05, PF-06, PF-07, PF-08)

Status: IMPLEMENTED and TESTED locally on main 5ca234b + this branch. Merge, deployment and live verification are recorded in the ledger (`docs/implementation/PF_MASTER_PROGRESS.md`).

All six packages are presentation-layer only. World model stays `glacial-0.8`; the scientific arrays and the JSON export schema are unchanged. A unit test asserts that building every presentation field leaves a fingerprint of elevation, temperature, rainfall, biome, Köppen and discharge untouched.

## Lighting modes (applies to PF-05/06/07/08)

- **Natural view** (Biomes layer): lit by a sun fixed in the planet's frame. Ocean effects, climate clouds and night lights appear here.
- **Studio view** (all scientific layers): the previous fixed light from the viewer's upper right, so every side of a scientific map stays readable. Scientific layers never show clouds, ocean gloss or night lights.

## PF-02 — Spectral stellar identity

- Spectral colours and magnitudes from PF-01 are kept; nothing is duplicated.
- The rarest stars (m < 1.2, about 25 of 14,000) get a four-point diffraction cross. It is drawn on an enlarged sprite whose core keeps its original apparent size.
- Optional scintillation: a deterministic per-star phase drives up to −16 % brightness.
  - Off on the low tier.
  - Off under `prefers-reduced-motion` (the clock does not advance).
- Tests: spike rarity and magnitude limit, phase determinism and spread.

## PF-03 — Adaptive graphics quality (`src/quality.js`)

**Profiles.** Low, medium and high set:
- pixel-ratio cap (1 / 1.35 / 2)
- sky tier (PF-01)
- cloud texture size and sphere resolution
- cloud shadows and cloud detail noise
- ocean gloss and swell
- twinkle

**Graphics selector.** Auto / Low / Medium / High, in the console's scrolling command row. Auto shows its current tier, e.g. "Auto (low)". `?gfx=low|medium|high` pins a tier.

**Measured adaptation.**
- Frame intervals are grouped into 2 s windows and the median is compared with a 22.2 ms budget (45 fps).
- Two windows above 1.4× budget step the tier down. Five windows below 0.55× budget step it up.
- Each change starts a 3 s quiet period.
- Intervals over 250 ms are ignored as stalls.
- Oscillation guard: a step down within 30 s of a step up locks the ceiling at the lower tier.

**Device ceiling.** Low if ≤ 2 hardware threads, `deviceMemory` ≤ 2 or max texture size < 4096. Medium if the pointer is coarse or `deviceMemory` ≤ 4. Otherwise high.

**Resources.** Tier changes rebuild only what differs: sky tier, cloud texture and cloud sphere. The superseded resources are disposed. The perf probe found 0 leaked buffers, textures or programs over 12 tier switches.

**Tests.**
- Seven unit tests: ordering, ceilings, step-down timing, step-up timing and ceiling, hysteresis band, oscillation lock, stall/manual handling.
- Smoke: the Auto tier stepped down from measured frame times in headless SwiftShader, with the reason recorded.

## PF-05 — Dynamic solar illumination

**Sun position.**
- Built from a subsolar longitude and a declination (`sunDirection`, lon = atan2(z, x), matching the mesh).
- The declination follows the Season control: equinox for Annual, −tilt for January, +tilt for July. It uses the world's own axial tilt, so the Season and Tilt controls keep working.

**Day-cycle control.** Play/Pause plus a speed of 4 min, 1 min or 15 s per planetary day. Readout: "Noon 45°E".
- Visual time only. It is never passed to the climate model.
- Starts paused. Explicit Play works even under reduced motion.

**Look.**
- The terminator moves across the globe.
- The atmosphere rim gets a warm twilight band.
- In the natural view the sky fill drops from 0.82 to 0.6 and the bounce light from 0.32 to 0.1, so the night side is dark but legible.

**Smoke check.** Mean luminance at the disc centre with the sun facing the viewer vs behind the planet: 196.4 vs 18.6 desktop, 175.3 vs 18.9 mobile (final code).

## PF-06 — Living oceans

- `oceanDepthField`: per-cell factor 1 − e^(elevation/1800 m) for ocean cells, 0 on land. It is passed to the globe shader.
- Ocean cells get low GGX roughness (0.2–0.3, smoother when deeper), which gives a sunlight glint.
- Gentle animated swell on the high tier only: a perturbed normal, stopped under reduced motion.
- Depth tints and coastal shallows come from the existing biome palette.
- No reflection pass and no physical ocean simulation. Low tier disables all ocean effects.

## PF-07 — Climate-informed clouds

`buildCloudField` builds an RGBA8 equirectangular texture from the model:
- **R = cover.** Binned precipitation (2° × 4° bins) for the Season control (annual, January or July). Cover = ((P − 120 mm) / 2100)^0.75. Seeded value noise breaks it up.
- **G = drift.** The zonal-mean eastward wind of the model's prescribed circulation.

**Motion.**
- Clouds drift along those winds with a two-phase flow map, so displacement stays bounded and the texture never shears into stripes.
- Cloud shadows sample the same field offset toward the sun.
- Clouds button: on/off. Clouds appear only in the natural, present-day view.

**Tests (ATLAS-001).**
- Rain–cover correlation r > 0.5.
- The wettest quarter's mean cover exceeds the driest quarter's by more than 40/255.
- The equatorial drift is westward, matching the model's trade easterlies.
- January ≠ July.

**Labelled as a visual approximation** (button tooltip and this document). It is not a cloud or weather simulation.

**Defect fixed:** the globe raycast was recursive, so clicks on the Biomes view could hit the old cloud sphere and report a wrong cell. Picking is now restricted to the globe mesh. Clouds and markers are also non-raycastable.

## PF-08 — Settlement illumination

- A ring marker at each of the generated settlements, as a child of the globe, so it stays fixed through rotation. Markers show on every layer.
- Night lights: settlement cell plus 2 mesh rings, land only. Ring falloff with a fixed per-cell jitter. Emissive on the night side of the natural view only.
- No population model exists, so every settlement has equal brightness. No population figures are invented.
- Clicking within 2.5° of a settlement selects it (enlarged marker). The inspection line then starts with its recorded founding year, water source, setting, climate and coordinates.
- Route overlays are not implemented. They depend on a route model (PF-15/PF-28).

## Evidence

**Tests and build.**
- `npm test`: 61/61 (13 new across `tests/quality.test.js`, `tests/surfaceFields.test.js` and `tests/starfield.test.js`).
- Build OK: JS 548.93 kB → 563.74 kB (153.38 kB gzip).

**Browser smoke** (`scripts/smoke.mjs`, SwiftShader, 1280×800 and 390×844): 119/119 checks. New checks cover:
- natural-view state
- terminator
- sun restore
- day-cycle play/pause
- cloud toggle with clean restore
- studio scientific layers
- settlement click selection
- graphics tier switch
- Auto adaptation

**Performance** (`scripts/perf.mjs`, SwiftShader software rendering; compare runs only):

| | PF-01 (5ca234b) | M1 high | M1 low |
|---|---|---|---|
| Desktop median / p95 frame | 183.4 / 366.8 ms | 233.3 / 433.2 ms | 200.0 / 400.0 ms |
| Mobile median / p95 | 150.0 / 300.1 ms | 183.3 / 366.6 ms | 150.0 / 300.0 ms |
| Draws per frame | 5 | 6 | 6 |
| Live buffers / textures / programs | 21 / 5 / 5 | 26 / 6 / 6 | 26 / 6 / 6 |
| Leak over 8 forge cycles / 12 tier switches | 0 / 0 | 0 / 0 | 0 / 0 |

- The high tier costs about +27 % in software rendering. Most of it is the per-fragment cloud-shadow lookup and the cloud sphere.
- Auto moves slow devices to low, which measured within one vsync step of PF-01.
- Real-GPU cost is unmeasured.

Screenshots: `M1/day-desktop.jpg`, `M1/night-desktop.jpg`, `M1/day-mobile.jpg`.

## Known limitations

- Clouds are static fields with bounded drift. There is no weather evolution.
- Ocean colour does not change with lighting angle beyond PBR specular. Swell is decorative.
- Lighting is studio-fixed on scientific layers by design. The day cycle is visible only in the Biomes view.
- Twinkle is a uniform per-star modulation, not atmospheric seeing.
- Settlement lights have no population basis yet (PF-15 adds population).
