# F-0007 — Eddy moisture transport: poleward down-gradient diffusion of water vapour (eddy-0.6)

Status: COMPLETE once deployment is verified (see OPERATIONAL_STATE.md, cycle 6 entries). F-0005 (ice-age glaciation) is still in progress on `wip/glaciation-season`.

## Why

Cycle 5 found almost no precipitation poleward of 70° (land ≈ 4 mm/yr at 70–80° on the glaciation branch; Earth ≈ 200–300 mm/yr). The climate-0.3 moisture scheme is purely advective: each transport iteration moves every parcel one mesh hop downwind, whatever the wind speed, so the prescribed polar easterlies (which have an equatorward component) carry vapour out of the polar cap and nothing carries it in. On Earth most poleward latent-heat transport outside the tropics is done by transient midlatitude eddies, not the mean flow. The same scheme also left land too dry (Köppen B 59% vs ≈30%) with too much of the rain falling on few wet cells (runoff ratio 0.65 vs ≈0.35–0.40).

## What changed (src/climate.js)

Conceptual approximation, not a resolved eddy flux.

1. **Zonal-band eddy diffusion.** The mesh is split into 90 latitude bands of 2° (dy = πR/90 ≈ 222 km). The in-transit moisture of each band is diffused to its neighbouring bands, F = −D ∂q̄/∂y on the band means, the way moist energy-balance models diffuse moist static energy (Frierson, Held & Zurita-Gotor 2007; Hwang & Frierson 2010).
2. **Diffusivity.** D = 1.87 × 10⁶ m² s⁻¹, the extratropical effective MSE diffusivity of the control aquaplanet GCM in Frierson, Held & Zurita-Gotor (2007, *J. Atmos. Sci.* 64, 1680–1693; their tuned EBM2 used 1.84 × 10⁶). Hwang & Frierson (2010, *GRL* 37, L24807) used 1.06 × 10⁶ for the CMIP3 20C3M models. Applying an MSE diffusivity to water vapour alone is an assumption (Frierson et al. note the moist/dry partition is not exact).
3. **Time step.** One transport iteration moves air one mesh hop, so it is taken to represent dt = spacing / 7 m s⁻¹ (7 m/s is an **assumed** representative lower-tropospheric wind speed, not a cited value), ≈ 1.1 × 10⁴ s at 100,002 cells. D dt/dy² ≈ 0.41 per iteration.
4. **Operator splitting.** For speed the diffusion is applied every 3 iterations with 3 iterations' worth of diffusion (α ≈ 1.24), split into stable sub-steps of ≤ 0.45. Precipitation and the moisture budget are averaged over the last full 3-iteration cycle so the eddy pulse does not bias them (the first version took only the final iteration and the P/E budget test caught P/E = 1.11).
5. **Conservation.** Band gains are added uniformly to the band's cells; band losses are removed in proportion to each cell's moisture. Total moisture is conserved to rounding and never goes negative (unit-tested).
6. `createPlanet(seed, { eddyMoisture: false })` turns the flux off and reproduces the season-0.5 moisture path, for diagnostics and the before/after test. Temperatures are unchanged by the flux.

Rejected first attempt: spreading a fixed share of each cell's outflow equally to all neighbours (a cell-scale random walk). Its diffusivity is far too small at 70 km spacing and it slowed inland penetration: Köppen B rose 59 → 62% (share 0.2) and 59 → 70% (share 0.5). Reverted.

## Verification

- Tests (35/35): new `tests/eddy.test.js` (4 tests) checks the cited diffusivity range and sub-step stability; conservation, non-negativity and down-gradient transport of the band step; determinism of precipitation and runoff for a seed and that disabling the flux leaves temperature identical and changes precipitation; and on 20 seeds at 100,002 cells (eddy on vs off) that mean Köppen B falls by > 2 points, mean runoff ratio by > 0.02, precipitation poleward of 70° rises > 20% and land snowfall poleward of 60° rises > 50%. All earlier tests pass unchanged, including the P/E budget closure (≤ 1.0001).
- Seed report: 20/20 reproducible and distinct, 638–847 ms per seed (Node, this box), P/E 0.92–0.96, 160/160 settlements with water.
- Performance: the transport loop moved into its own function; on DET-04 `computeClimate` takes 369 ms vs 389 ms before (best of 4).
- Smoke (local vite preview): 78/78, live version check updated to eddy-0.6.

## Before / after (20 seeds DET-00..DET-19, 100,002 cells; `scripts/climate-diagnostics.mjs`, season-0.5 at 126b00c vs this build)

| quantity (20 seeds, min / mean / max) | season-0.5 | eddy-0.6 | Earth reference |
|---|---|---|---|
| Köppen B (desert + steppe) % of land | 49.1 / 59.17 / 83.2 | 44.9 / 54.73 / 77.8 | ≈30 (Peel et al. 2007) |
| Runoff ratio (land) | 0.553 / 0.65 / 0.731 | 0.429 / 0.61 / 0.704 | ≈0.35–0.40 |
| Endorheic (inward-draining) % of land | 25.5 / 39.33 / 76.6 | 18.3 / 31.4 / 74 | ≈18–20 (commonly cited estimate) |
| Mean annual precipitation of land poleward of 70°, mm | 0 / 88.11 / 595 | 11 / 131.74 / 610 | ≈200–300 (Arctic land) |
| Mean annual precipitation, all cells poleward of 70°, mm | 1 / 74.3 / 221 | 13 / 103.95 / 257 |  |
| Mean snowfall (precipitation in months < 0 °C), land ≥ 60°, mm | 25 / 154.95 / 523 | 97 / 356.4 / 1141 |  |
| Köppen E (polar) % of land | 1 / 8.8 / 31.3 | 1 / 8.8 / 31.3 | ≈7 excl. Antarctica |
| Ice biome (EF) % of land | 0.2 / 4.74 / 19.9 | 0.2 / 4.74 / 19.9 |  |
| Annual mean temperature poleward of 66°, °C | -17.3 / -5.09 / 5.5 | -17.3 / -5.09 / 5.5 | ≈ −15 to −20 |
| Global mean precipitation, mm/yr | 914 / 1139.3 / 1302 | 899 / 1122.35 / 1299 | ≈1,000 (Adler et al. 2003) |
| Windward/lee July precipitation ratio | 0.85 / 2.75 / 4.49 | 1.02 / 2.59 / 4.7 |  |

| biome (mean % of land) | season-0.5 | eddy-0.6 |
|---|---|---|
| Cold desert | 40.2 | 37.3 |
| Subtropical desert | 11.8 | 9.5 |
| Tundra | 10.2 | 7.6 |
| Temperate seasonal forest | 6.4 | 7.5 |
| Temperate grassland | 6 | 7.5 |
| Tropical seasonal forest / savanna | 5.7 | 7.1 |
| Woodland / shrubland | 4.9 | 6.6 |
| Ice | 4.7 | 4.7 |
| Tropical rainforest | 3.7 | 3.4 |
| Boreal forest | 3.3 | 5.9 |
| Temperate rainforest | 3.1 | 2.9 |

Per seed:

| seed | tilt° | Köppen B % of land | runoff ratio | endorheic % | land P >70° mm/yr | all P >70° mm/yr | land snowfall ≥60° mm/yr | Köppen E % | Ice biome % |
|---|---|---|---|---|---|---|---|---|---|
| DET-00 | 32.06 | 52.6 → 49.6 | 0.652 → 0.614 | 29.2 → 20.8 | 396 → 490 | 196 → 232 | 398 → 527 | 2.7 → 2.7 | 0.9 → 0.9 |
| DET-01 | 33.7 | 55.8 → 50.6 | 0.693 → 0.704 | 27.6 → 27.3 | 220 → 326 | 191 → 257 | 213 → 317 | 7.7 → 7.7 | 4.4 → 4.4 |
| DET-02 | 30.76 | 54.8 → 50.8 | 0.628 → 0.593 | 37.4 → 29.5 | 36 → 58 | 81 → 104 | 54 → 101 | 1 → 1 | 0.2 → 0.2 |
| DET-03 | 30.48 | 56.9 → 52.5 | 0.649 → 0.613 | 33.5 → 27.5 | 33 → 65 | 112 → 142 | 140 → 305 | 2.2 → 2.2 | 1.3 → 1.3 |
| DET-04 | 25.03 | 54.6 → 53.4 | 0.641 → 0.626 | 42 → 32.8 | 1 → 27 | 38 → 67 | 25 → 97 | 3 → 3 | 1.4 → 1.4 |
| DET-05 | 23.12 | 73 → 65.8 | 0.596 → 0.556 | 53.2 → 40.9 | 6 → 41 | 17 → 49 | 72 → 178 | 5.5 → 5.5 | 2 → 2 |
| DET-06 | 17.31 | 51.8 → 48.1 | 0.664 → 0.624 | 26.9 → 24 | 1 → 20 | 3 → 18 | 63 → 470 | 10.4 → 10.4 | 5.7 → 5.7 |
| DET-07 | 29.37 | 54.7 → 51.4 | 0.596 → 0.59 | 31.2 → 20.4 | 42 → 106 | 92 → 139 | 119 → 263 | 3.5 → 3.5 | 1.3 → 1.3 |
| DET-08 | 16.41 | 49.1 → 44.9 | 0.731 → 0.703 | 25.5 → 18.3 | 0 → 11 | 2 → 13 | 33 → 171 | 31.3 → 31.3 | 19.4 → 19.4 |
| DET-09 | 31.74 | 65.5 → 59.3 | 0.632 → 0.587 | 44.5 → 36.3 | 20 → 42 | 106 → 134 | 78 → 103 | 3 → 3 | 1.2 → 1.2 |
| DET-10 | 25.19 | 56.4 → 48.9 | 0.722 → 0.676 | 34.2 → 26.6 | 7 → 39 | 28 → 60 | 27 → 153 | 5.6 → 5.6 | 2.3 → 2.3 |
| DET-11 | 22.81 | 52.4 → 47 | 0.677 → 0.664 | 37 → 22.1 | 1 → 42 | 11 → 46 | 71 → 261 | 7.7 → 7.7 | 3.3 → 3.3 |
| DET-12 | 17.6 | 64.6 → 59.7 | 0.65 → 0.575 | 38 → 32.2 | None → None | 3 → 18 | 351 → 1141 | 5.3 → 5.3 | 1.5 → 1.5 |
| DET-13 | 18.99 | 50.3 → 48.1 | 0.63 → 0.594 | 32.5 → 26.5 | 1 → 75 | 2 → 45 | 81 → 304 | 17 → 17 | 10.9 → 10.9 |
| DET-14 | 33.6 | 59.1 → 54.6 | 0.62 → 0.594 | 37.9 → 28.6 | 595 → 610 | 221 → 247 | 387 → 469 | 4.7 → 4.7 | 1.9 → 1.9 |
| DET-15 | 14.44 | 52.8 → 50.7 | 0.669 → 0.644 | 48.4 → 28.5 | 0 → 12 | 1 → 14 | 51 → 288 | 30.2 → 30.2 | 19.9 → 19.9 |
| DET-16 | 19.29 | 51.6 → 47.1 | 0.702 → 0.666 | 31.2 → 26.2 | 1 → 22 | 3 → 20 | 69 → 294 | 16.9 → 16.9 | 9.3 → 9.3 |
| DET-17 | 34.39 | 83.2 → 77.8 | 0.553 → 0.429 | 76.6 → 74 | 211 → 256 | 203 → 237 | 200 → 258 | 1.2 → 1.2 | 0.6 → 0.6 |
| DET-18 | 10.89 | 71.1 → 68.4 | 0.635 → 0.582 | 53.1 → 42.9 | 4 → 33 | 2 → 14 | 144 → 732 | 15.1 → 15.1 | 6.8 → 6.8 |
| DET-19 | 33.02 | 73.1 → 66 | 0.603 → 0.534 | 46.7 → 42.6 | 99 → 228 | 174 → 223 | 523 → 696 | 2.1 → 2.1 | 0.5 → 0.5 |

## Honest limitations

- Partly meets its goals. Desert/steppe falls 59 → 55% of land, still ≈1.8× Earth. Runoff ratio falls 0.65 → 0.61, still well above Earth's 0.35–0.40. Both biases have other causes the flux does not touch (prescribed winds, one-hop-per-iteration advection, the 0.7 land-recycling factor, Thornthwaite PET).
- Polar precipitation rises 74 → 104 mm/yr (all cells > 70°) and land snowfall poleward of 60° more than doubles, but low-tilt seeds still get almost nothing at 80–90° (e.g. DET-08 ≈ 1 mm/yr). Earth's Arctic gets ≈ 200–300.
- Köppen E and the Ice biome do not change, by design: they depend only on temperature in the Köppen rules. Poles are still too warm at Earth-like tilt (mean −5 °C poleward of 66°).
- The diffusion acts on zonal band means, so it has no longitude structure (no storm-track preference over oceans, no blocking).
- The hop time step uses an assumed 7 m/s wind speed. A different choice scales the effective D linearly.

## Sources

- Frierson, D. M. W., Held, I. M. & Zurita-Gotor, P. (2007). A gray-radiation aquaplanet moist GCM. Part II: Energy transports in altered climates. *J. Atmos. Sci.* 64, 1680–1693. doi:10.1175/JAS3913.1
- Hwang, Y.-T. & Frierson, D. M. W. (2010). Increasing atmospheric poleward energy transport with global warming. *Geophys. Res. Lett.* 37, L24807. doi:10.1029/2010GL045440
- Peel, M. C., Finlayson, B. L. & McMahon, T. A. (2007). Updated world map of the Köppen-Geiger climate classification. *Hydrol. Earth Syst. Sci.* 11, 1633–1644.
- Adler, R. F. et al. (2003). The Version-2 Global Precipitation Climatology Project (GPCP) monthly precipitation analysis. *J. Hydrometeor.* 4, 1147–1167.
