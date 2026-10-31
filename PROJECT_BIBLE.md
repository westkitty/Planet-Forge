# Planet Forge project Bible

## Purpose
An original deterministic seeded planetary simulation and offline-capable interactive browser atlas.

## Source of truth
Repository: westkitty/Planet-Forge; main branch. Do not modify any similarly named repository.

## Current baseline
Conceptual procedural globe prototype. Not a scientifically validated climate, plate, hydrology, or biome simulation.

## Roadmap
1. Verifiable hosted static prototype.
2. Spherical cell mesh and plate adjacency, deterministic orogeny.
3. Climate and hydrology with physical invariants.
4. Civilization timeline and atlas exports.
5. Hourly coding executor with bounded authorization, rollback, audit logs and stop controls.

## Publication
GitHub Pages is only a build/deploy target. Continuous AI development is a separate external service requiring credentials, scheduled compute and authorization.

## Editing rules
Preserve functional baseline. Build/test before merge. Record all algorithm changes to world version. Never silently overwrite history or claim verification without evidence.

## 2026-10-31 — World model tectonic-0.2 (append-only)

- Roadmap item 2 started: the planet is now a geodesic mesh of 100,002 cells (frequency 100) with 9–14 seeded rigid plates moving about Euler poles; relief derives from boundary type (convergent, divergent, transform) and a GDH1 seafloor age-depth model. Details, assumptions and sources: `docs/features/F-0002-tectonic-plates.md`.
- World version string is `tectonic-0.2`. `prototype-0.1` (`src/world.js`) is retained for reference and its tests still run.
- Still conceptual: climate, rainfall and biomes; plates are a kinematic snapshot, not time-integrated.

## 2026-10-31 — World model climate-0.3 (append-only)

- Roadmap item 3 started: seeded axial tilt (10–35°, user-overridable) drives monthly insolation, a zonal energy-balance model, a prescribed seasonal three-cell circulation and steady-state moisture transport over the 100,002-cell mesh; rain shadows emerge downwind of tectonic mountains. Köppen–Geiger (30 classes) and 11 Whittaker-inspired biomes replace the old biome proxy. Details, assumptions and sources: `docs/features/F-0003-climate-circulation.md`.
- World version string is `climate-0.3` (relief identical to tectonic-0.2 for the same seed).
- Still conceptual: winds are prescribed, not solved; no ocean currents, hydrology or erosion; land is drier than Earth (53–81% Köppen B vs ≈30%).

## 2026-10-31 — World model hydro-0.4 (append-only)

- Roadmap item 3 continued: Thornthwaite PET + Fu/Budyko runoff, Priority-Flood drainage over the 100,002-cell mesh, river discharge, lakes with a closed water balance (terminal salt lakes and salt flats where evaporation exceeds inflow), drainage basins and named great rivers. Settlements now require fresh water. Details, assumptions and sources: `docs/features/F-0004-hydrology.md`.
- World version string is `hydro-0.4` (relief and climate identical to climate-0.3 for the same seed; settlements change because sites now need water).
- Still conceptual: steady-state annual water balance; no erosion, groundwater or seasonal flow; runoff ratio (0.52–0.70) and endorheic land share (28–76%) are higher than Earth's, inheriting the climate model's arid bias.

## 2026-10-31 — World model season-0.5 (append-only)

- Roadmap item 3 continued: the seasonal temperature cycle is now the heat-capacity-damped response of the energy-balance model (50 m ocean mixed layer, air-column-plus-soil land heat capacity, maritime coupling decaying inland, monthly snow and sea-ice albedo; North & Coakley 1979). Details, before/after statistics, assumptions and sources: `docs/features/F-0006-seasonal-damping.md`.
- World version string is `season-0.5`. Relief identical to tectonic-0.2; every climate, Köppen, biome, hydrology and settlement output changes for the same seed.
- F-0005 (ice-age glaciation) remains in progress on `wip/glaciation`; F-0006 was shipped first because F-0005 depends on it.
- Still conceptual: arid bias persists (49–83% Köppen B vs ≈30%), runoff ratio 0.55–0.73, high-latitude winters too mild, poles warm at Earth-like tilt.

## 2026-10-31 — World model eddy-0.6 (append-only)

- Roadmap item 3 continued: water vapour is now also carried poleward by a conceptual eddy flux, a down-gradient diffusion of in-transit moisture between 2° latitude bands with D = 1.87 × 10⁶ m² s⁻¹ (Frierson, Held & Zurita-Gotor 2007), on top of the mean-wind advection. Details, before/after statistics, assumptions and sources: `docs/features/F-0007-eddy-moisture.md`.
- World version string is `eddy-0.6`. Relief and temperatures identical to season-0.5 for the same seed; precipitation, Köppen, biomes, hydrology and settlements change.
- Still conceptual: arid bias reduced but not fixed (45–78% Köppen B vs ≈30%), runoff ratio 0.43–0.70, little precipitation at 80–90° on low-tilt planets, poles warm at Earth-like tilt.

## 2026-10-31 — World model glacial-0.8 (append-only)

- Roadmap item 3 continued: each world now has a last glacial maximum, computed on demand. It combines an orbital (obliquity-minimum) and Köhler et al. (2010) glacial forcing through the EBM with frozen albedo, ice sheets from a whole-sheet positive-degree-day budget with accumulation-limited Nye thickness over a 90,000-year build-up, eustatic sea-level fall, exposed shelves, and named land bridges and ice sheets. UI: Era toggle and an Ice age layer; export carries the glacial state. Details, the bar, before/after and sources: `docs/features/F-0005-glaciation.md` (cycle 7 section).
- World version string is `glacial-0.8`. Interglacial outputs are byte-identical to eddy-0.6 for the same seed.
- Still conceptual: at Earth's obliquity the 20 test seeds give median 127 m sea fall, 5.3 % ice and 5.4 K cooling. At seeded obliquity the results are bimodal: worlds at ≥ 29° barely glaciate and low-obliquity worlds reach up to 381 m. Today's poles are still warm and dry. One calibrated parameter (build-up steps).


## 2026-10-31 — Visual observatory contract (user-directed, additive)

- World model and data remain glacial-0.8; this is a rendering and interface upgrade, not a revision of physics, climate, hydrology, glaciation, seeding, or the JSON schema.
- The globe is the subject. The persistent control console must use no more than 15% of the viewport area at desktop and mobile sizes; implementation reserves 14.5dvh for a compact bottom console and 85.5dvh for the actual interactive Three.js viewer. Never regain interface space by removing a scientific layer or data capability.
- Preserve selector IDs and all existing seed, layer, season, tilt, era, random, inspection, river, settlement, chronicle, ice-age, and export paths. Keep the data in a horizontally scrollable atlas readout strip rather than a full-height side panel.
- Style: restrained planetary observatory. The visual vocabulary is deep ink/navy, directional warm daylight, cooler dark-side bounce, thin upper-atmosphere limb, actual derived terrain relief, subdued coast emphasis, deterministic stars, and sparse atmospheric clouds. Decorative cloud cover is not a scientific climate output, so it only appears on the present-day biome view and must not obscure scientific layers.
- No remote runtime textures or new dependencies. Preserve low-memory device support through capped device pixel ratio and procedural lightweight geometry. Reuse the globe geometry across layer changes and dispose replacement world/annotation resources.
- Preserve mouse drag, wheel, globe keyboard navigation, centre inspection, and reduced-motion handling. Touch pinch zoom is added; multi-touch must not trigger an accidental cell inspection.
- The user explicitly resumed the narrowly scoped visual work after the prior pause. This does not enable the previously paused hourly autonomous feature executor.
