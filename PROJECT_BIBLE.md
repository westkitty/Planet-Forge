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
