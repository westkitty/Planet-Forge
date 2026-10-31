# F-0002 — Geodesic cell mesh and rigid-plate tectonics (tectonic-0.2)

Status: COMPLETE — deployed 2026-10-31 in 415370a (Actions run 41188679630, live smoke 58/58).

## Candidate evaluation (cycle 2026-10-31 05:09 ET)

| # | Candidate | Depends on | WOW (0–10) | Achievable this cycle |
|---|-----------|-----------|-----------|-----------------------|
| 1 | Geodesic 100k-cell mesh + seeded rigid plates with Euler-pole kinematics, boundary classification and boundary-driven relief + seafloor age-depth | nothing | 9 | yes |
| 2 | Priority-flood depression filling + steepest-descent drainage and river discharge | a cell mesh with adjacency (#1) | 8 | no (needs #1) |
| 3 | Moisture advection along zonal wind belts with orographic rain shadow | cell mesh (#1), real mountains (#1) | 8 | no (needs #1) |
| 4 | Köppen–Geiger classifier from monthly temperature/precipitation | seasonal climate (not present) | 6 | partially; mostly a relabelling |
| 5 | Settlement growth and trade-route history over 2,000 years | hydrology and terrain cost (#2) | 7 | no; would be built on placeholder terrain |

Chosen: #1. It is the foundation every other layer in the roadmap needs (roadmap item 2), it is emergent (mountain belts, trenches, island arcs, rift seas and ocean ridges all arise from plate motion rather than being painted), and it reaches the long-term target resolution of about 100,000 cells.

## What it does

1. **Mesh.** A geodesic icosphere of frequency f has 10f²+2 cells and 20f² triangles; f = 100 gives 100,002 cells (12 pentagons, the rest hexagons). Cells are mesh vertices; adjacency is stored in CSR form. Mean neighbour spacing ≈ 68 km on an Earth-sized sphere.
2. **Plates.** 9–14 nuclei are placed by the seeded PRNG. Plates grow by a priority flood whose step cost is jittered by value noise and divided by a per-plate growth rate, giving irregular, contiguous plates of unequal size.
3. **Kinematics.** Each plate rotates rigidly about a random Euler pole with a surface speed of 1.5–9 cm/yr at 90° from the pole, so the velocity of a cell is v = ω × p (the standard description of plate motion on a sphere; Cox & Hart 1986). The range spans present-day plate speeds (DeMets, Gordon & Argus 2010, MORVEL).
4. **Crust.** Plates are marked continental, in seeded order, until the continental area is closest to a seeded target of 30–42% of the surface (Earth's continental crust including shelves covers roughly 40%).
5. **Boundaries.** For each cell touching another plate, the relative velocity across the shared edge is split into a normal (closing/opening) and a tangential component, then smoothed along the plate-pair segment. Normal-dominant closing is convergent, normal-dominant opening is divergent, tangential-dominant is transform.
6. **Seafloor age and depth.** Oceanic crust age is the travel time from the nearest divergent boundary at that ridge's half spreading rate (1 cm/yr = 10 km/Myr), capped at 200 Myr. Depth follows the GDH1 plate cooling model (Stein & Stein 1992): d = 2600 + 365√t m for t < 20 Myr, d = 5651 − 2473 e^(−0.0278 t) m otherwise.
7. **Relief.** Distance to the nearest boundary of the cell's own plate drives Gaussian profiles: continent–continent convergence → collision orogen (up to ~8 km); ocean–continent → trench on the oceanic side and a volcanic arc ~180 km inland; ocean–ocean → the denser plate gets a trench and the other an island arc; continental divergence → rift valley (which can flood into a narrow sea); transform → low relief. Passive continental margins slope into the ocean with a noise-modulated width. Value noise adds basins, shields and coastline irregularity.
8. **Climate and biomes.** Still the prototype's latitudinal approximation, now with a 6.5 K/km lapse rate (ICAO standard atmosphere) and an elevation-based dryness term. This is not a circulation model; it now responds to tectonic mountains only through elevation.
9. **Settlements.** Placed on habitable land cells; each records its tectonic setting (plate interior or which boundary type is within 500 km).

## Assumptions, simplifications, limitations (read before relying on it)

- This is a **kinematic snapshot**, not a time-integrated geodynamic simulation. Plates do not move, collide, split or merge over time; relief is computed from present-day relative motion only. Cortial et al. (2019) describe a time-stepped procedural approach this could grow into.
- Plates are entirely continental or entirely oceanic. Real plates carry both. Coasts therefore often follow plate boundaries.
- Boundary profiles (heights, widths, arc offsets) are hand-tuned Gaussians chosen to give Earth-like magnitudes, not derived from flexure, isostasy or crustal thickening.
- Subduction polarity in ocean–ocean convergence uses a random per-plate "density" value, not plate age.
- Seafloor age ignores plate boundary jumps, hotspots and plate reorganisation; unreached oceanic cells default to 180 Myr.
- Trenches are capped by construction (deepest ~8.7 km across 20 seeds); Earth's deepest point is ~10.9 km.
- Climate, rainfall and biomes remain conceptual proxies (see roadmap item 3).
- Determinism relies on IEEE-754 double arithmetic and V8's `Math` functions; the mesh and noise use only arithmetic and `sqrt`, but pole sampling and climate use `sin/cos/asin/atan2/pow/exp`, whose last-bit results are not guaranteed identical across JavaScript engines. Outputs are rounded to limit this.

## Verification (local, 2026-10-31)

- `npm test`: 13/13 pass (6 new: mesh topology incl. Euler characteristic and 12 pentagons for f = 1, 2, 7, 32; 20-seed repeat determinism and distinctness; 20-seed plate contiguity, boundary-flag consistency, bounds, bimodal hypsometry, zero-age ridges; extremes near boundaries; GDH1 monotonicity; 100,002-cell determinism and < 3 s budget).
- `npm run seed-report`: 20/20 reproducible and distinct at 100,002 cells; mesh 118 ms; generation 165–286 ms per seed in Node 24; land 24–39%; highest 8,544 m, deepest −8,747 m.
- Browser smoke (headless Chrome, SwiftShader, vite preview): 58/58 at 1280×800 and 390×844, including new checks for the boundaries and seafloor-age layers, plate data in cell inspection, and the 100,002-cell model loading (in-page generation 231–248 ms).

## Sources

- Cox, A. & Hart, R. B. (1986). *Plate Tectonics: How It Works.* Blackwell. (Euler-pole kinematics.)
- DeMets, C., Gordon, R. G. & Argus, D. F. (2010). Geologically current plate motions. *Geophys. J. Int.* 181, 1–80. (Plate speeds.)
- Stein, C. A. & Stein, S. (1992). A model for the global variation in oceanic depth and heat flow with lithospheric age. *Nature* 359, 123–129. (GDH1.)
- Cortial, Y., Peytavie, A., Galin, É. & Guérin, É. (2019). Procedural Tectonic Planets. *Computer Graphics Forum* 38(2). (Procedural plate-based relief.)
- ICAO (1993). *Manual of the ICAO Standard Atmosphere*, Doc 7488. (6.5 K/km lapse rate.)
