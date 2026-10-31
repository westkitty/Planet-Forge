# F-0006 — Seasonal heat-capacity damping: ocean mixed layer, land heat capacity, maritime coupling, seasonal snow albedo (season-0.5)

Status: COMPLETE once deployment is verified (see OPERATIONAL_STATE.md, cycle 5 entries). Feature number F-0005 stays reserved for the ice-age work on `wip/glaciation`, which is still in progress.

## Why

Cycle 4 found that climate-0.3 used the equilibrium (zero heat capacity) seasonal response of its zonal energy-balance model, ΔQ(1 − α)/(B + D), then multiplied it by an ad-hoc continentality factor of 0.7–1.8 on land and 0.35 on ocean. High-latitude land reached 46–55 °C in summer (the 55 °C clamp), oceans at 50–60° swung 19 K, and no snow could survive summer, which blocks the glaciation feature.

## What changed (src/climate.js)

1. **Seasonal EBM in harmonics.** The monthly absorbed-sunlight anomaly per 0.5° row is decomposed into 3 annual harmonics. Each harmonic is answered with the linear damped response of C dT/dt = F − (B + D)T (North & Coakley 1979): T_n = F_n / (B + D + i n ω C). Amplitude falls as 1/√(1 + (nωτ)²) and phase lags by atan(nωτ), τ = C/(B + D).
2. **Ocean.** C_o = ρ c_p h for a 50 m mixed layer = 2.04 × 10⁸ J m⁻² K⁻¹ (typical global mixed-layer depth, de Boyer Montégut et al. 2004). Annual-harmonic damping ≈ 0.14, lag ≈ 2.7 months.
3. **Land.** C_l = atmospheric column (c_p p_s/g ≈ 1.0 × 10⁷) + the soil layer reached by the annual thermal wave (≈ 1.5 m × 2 × 10⁶ J m⁻³ K⁻¹) = 1.3 × 10⁷ J m⁻² K⁻¹. Land is coupled to the zonal ocean response by advected maritime air: C_l dT/dt = F − (B + D)T + K(T_o − T), K = 12 exp(−d / 1000 km) W m⁻² K⁻¹, d = distance to the coast. This is the model's "ocean heat transport to land" term; it replaces the old 0.7–1.8× continentality multiplier and the fixed 1–2 month lag shift, so continentality and lag now emerge from one equation.
4. **Seasonal snow and sea-ice albedo.** Albedo is evaluated per month from the month's zonal surface temperature (half ocean, half land 500 km inland), ramping from 0.30 at 0 °C to 0.62 at −10 °C, and the annual absorbed sunlight is insolation-weighted. climate-0.3 used the annual mean temperature with a −2 to −18 °C ramp. 30 relaxed fixed-point iterations.
5. The old equilibrium anomaly is still returned (`ebm.anomaly`) for diagnostics and the glaciation branch.

The annual-mean transport (Budyko D = 3.81 W m⁻² K⁻¹) is unchanged. It already parameterises total atmosphere-plus-ocean heat transport, so no separate annual ocean heat transport was added: it would double-count and make the warm-pole bias worse.

## Verification

- Tests: new `tests/seasons.test.js` (3 tests) checks the heat capacities and damping factor, zero-mean anomalies, ocean damping to < 20% of the equilibrium range, a 1–3 month ocean lag, no seasons at zero tilt, and on all 20 seeds at 100,002 cells: mean warmest month of land poleward of 60° < 32 °C, hottest such month < 50 °C, ocean range at 45–65° < 13 K, and inland range > coastal range + 3 K. All earlier tests (climate invariants, rain shadow ≥ 1.5×, hydrology water balance, uphill-flow, settlements) pass unchanged: 31/31.
- A sign error in the first implementation made the ocean *lead* the sun by 3 months; the lag test caught it and the complex division was corrected before any numbers below were taken.
- Smoke: the annual→January map-change threshold was lowered from 1% to 0.3% of pixels. With damped oceans January differs from the annual map mostly over land (0.7% on ATLAS-001, tilt 13.7°); the January→July check (≥ 2%, measured 12.6–15.6%) is unchanged. Cell inspection now rounds temperatures to 0.1 °C (it printed raw Float32 values such as 20.100000381469727).
- `scripts/climate-diagnostics.mjs` (new) produced the tables below; same mesh, same seeds, hydro-0.4 at c08909f vs this build.

## Before / after (20 seeds DET-00..DET-19, 100,002 cells)

| quantity (20 seeds, min / mean / max) | hydro-0.4 | season-0.5 | Earth reference |
|---|---|---|---|
| Köppen B (desert + steppe) % of land | 53.1 / 61.98 / 81.4 | 49.1 / 59.17 / 83.2 | ≈30 (Peel et al. 2007) |
| Köppen E (polar) % of land | 0.3 / 3.09 / 9.8 | 1 / 8.8 / 31.3 | ≈ 7 excl. Antarctica |
| Köppen A % of land | 0 / 3.86 / 13.2 | 0 / 7.84 / 21.3 |  |
| Köppen D % of land | 6 / 19.09 / 38.9 | 1.2 / 12.96 / 31.2 |  |
| Köppen C % of land | 2.3 / 11.97 / 30.2 | 2.9 / 11.23 / 26.5 |  |
| Annual mean temperature poleward of 66°, °C | -13 / -2.74 / 5.4 | -17.3 / -5.09 / 5.5 | ≈ −15 to −20 (Arctic) |
| Mean warmest month, land 60–75°, °C | 8.3 / 37.36 / 53.8 | -9.7 / 13.72 / 30.8 | ≈ 10–20 |
| Mean coldest month, land 60–75°, °C | -39.6 / -30.78 / -20.4 | -20.7 / -16.83 / -12.1 | ≈ −20 to −35 |
| Hottest month on any land poleward of 60°, °C | 24.8 / 47.94 / 55 | 8.3 / 27.17 / 45.3 | ≈ 20–25 (Yakutsk ~19) |
| Ocean seasonal range 50–60°, K | 8.7 / 19.32 / 26 | 3.6 / 7.94 / 10.6 | ≈ 4–8 |
| Runoff ratio (land) | 0.52 / 0.61 / 0.7 | 0.55 / 0.65 / 0.73 | ≈ 0.35–0.40 |
| Inward-draining (endorheic) land % | 27.6 / 42.36 / 75.8 | 25.5 / 39.33 / 76.6 | ≈ 18–20 |
| Windward/lee July precipitation ratio | 1.05 / 2.98 / 5.6 | 0.85 / 2.75 / 4.49 |  |
| Global mean temperature, °C | 14.2 / 15.09 / 15.6 | 12.3 / 14.38 / 15.6 |  |
| Global mean precipitation, mm/yr | 969 / 1201.4 / 1341 | 914 / 1139.3 / 1302 |  |
| Generation time per world (Node), ms | 590 / 721.6 / 1155 | 621 / 699.35 / 829 |  |

Biome shares of land, mean over 20 seeds (%): hydro-0.4 {"Cold desert":37,"Subtropical desert":14.3,"Tundra":12.9,"Temperate seasonal forest":6.7,"Tropical seasonal forest / savanna":6,"Temperate grassland":5.7,"Woodland / shrubland":5.1,"Tropical rainforest":4.3,"Boreal forest":4,"Temperate rainforest":2.9,"Ice":1.1}; season-0.5 {"Cold desert":40.2,"Subtropical desert":11.8,"Tundra":10.2,"Temperate seasonal forest":6.4,"Temperate grassland":6,"Tropical seasonal forest / savanna":5.7,"Woodland / shrubland":4.9,"Ice":4.7,"Tropical rainforest":3.7,"Boreal forest":3.3,"Temperate rainforest":3.1}

Per seed (hydro-0.4 → season-0.5):

| seed | tilt° | B% | E% | polar >66° annual °C | warmest month, land 60–75° °C | coldest month, land 60–75° °C | ocean range 45–60°… K | runoff ratio | endorheic % | windward/lee | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DET-00 | 32.06 | 54.5 → 52.6 | 1.1 → 2.7 | 4.3 → 3.9 | 52.4 → 26.9 | -32.7 → -13.9 | 24.5 → 10 | 0.623 → 0.652 | 29 → 29.2 | 1.05 → 0.85 | 790 → 805 |
| DET-01 | 33.7 | 54.9 → 55.8 | 5.2 → 7.7 | 2.6 → 3.4 | 51.4 → 27.1 | -34.8 → -15.9 | 25.6 → 10.5 | 0.633 → 0.693 | 27.6 → 27.6 | 4.3 → 3.38 | 700 → 759 |
| DET-02 | 30.76 | 53.1 → 54.8 | 0.3 → 1 | 0.1 → 1.3 | 51.6 → 27 | -34.6 → -15.1 | 23.5 → 9.6 | 0.558 → 0.628 | 42.7 → 37.4 | 5.6 → 4.49 | 728 → 689 |
| DET-03 | 30.48 | 58.8 → 56.9 | 0.9 → 2.2 | 1.6 → 1.3 | 49 → 21.7 | -39.6 → -20 | 23.4 → 9.6 | 0.616 → 0.649 | 36.2 → 33.5 | 3.02 → 1.88 | 750 → 684 |
| DET-04 | 25.03 | 56 → 54.6 | 1.3 → 3 | -1.8 → -3.3 | 44.8 → 18.2 | -34.2 → -16.7 | 19.5 → 8 | 0.603 → 0.641 | 42.5 → 42 | 2.64 → 2.8 | 850 → 696 |
| DET-05 | 23.12 | 75.3 → 73 | 2.3 → 5.5 | -2.1 → -4.2 | 34 → 12.7 | -26.8 → -14 | 18.1 → 7.4 | 0.555 → 0.596 | 53.5 → 53.2 | 2.51 → 2.09 | 1155 → 648 |
| DET-06 | 17.31 | 55.9 → 51.8 | 3.1 → 10.4 | -9.4 → -15.7 | 21 → -1.6 | -28 → -19.6 | 13.7 → 5.7 | 0.643 → 0.664 | 29.5 → 26.9 | 1.46 → 1.69 | 663 → 655 |
| DET-07 | 29.37 | 58.5 → 54.7 | 2.1 → 3.5 | 1 → 0.5 | 47.2 → 21.6 | -29.8 → -13.9 | 22.6 → 9.3 | 0.549 → 0.596 | 34.6 → 31.2 | 3.77 → 3.25 | 676 → 808 |
| DET-08 | 16.41 | 64.9 → 49.1 | 9.8 → 31.3 | -10.8 → -16.8 | 19.3 → -3.4 | -26.5 → -19.3 | 13 → 5.4 | 0.696 → 0.731 | 38.6 → 25.5 | 2.8 → 3.38 | 762 → 636 |
| DET-09 | 31.74 | 65.6 → 65.5 | 2.1 → 3 | 2.3 → 2.7 | 52.1 → 27.7 | -36.6 → -16.4 | 24.2 → 9.9 | 0.605 → 0.632 | 54.5 → 44.5 | 4.1 → 3.44 | 665 → 794 |
| DET-10 | 25.19 | 56.1 → 56.4 | 2.1 → 5.6 | -2.2 → -3.5 | 47.5 → 19.5 | -37.6 → -18.1 | 19.6 → 8 | 0.679 → 0.722 | 35.5 → 34.2 | 4.34 → 3.66 | 788 → 638 |
| DET-11 | 22.81 | 55.1 → 52.4 | 3 → 7.7 | -5.1 → -7.1 | 41.1 → 14.3 | -36 → -18.6 | 17.8 → 7.3 | 0.621 → 0.677 | 39.8 → 37 | 2.55 → 2.51 | 631 → 829 |
| DET-12 | 17.6 | 66.3 → 64.6 | 1.4 → 5.3 | -8.3 → -14.8 | 16.1 → 0.8 | -22.7 → -16.6 | 13.9 → 5.8 | 0.629 → 0.65 | 38.6 → 38 | 4.51 → 4.18 | 678 → 621 |
| DET-13 | 18.99 | 54.9 → 50.3 | 3.4 → 17 | -9.6 → -16 | 21 → -2.6 | -28.8 → -20.7 | 15 → 6.2 | 0.598 → 0.63 | 36.7 → 32.5 | 3.14 → 3.2 | 753 → 621 |
| DET-14 | 33.6 | 59.7 → 59.1 | 2.4 → 4.7 | 5.1 → 4.9 | 52.9 → 28.4 | -34.3 → -14.6 | 25.5 → 10.4 | 0.591 → 0.62 | 39.6 → 37.9 | 2.58 → 2.61 | 631 → 626 |
| DET-15 | 14.44 | 60.7 → 52.8 | 9.7 → 30.2 | -12.1 → -17.3 | 16.9 → -5.9 | -26.6 → -20.2 | 11.5 → 4.8 | 0.64 → 0.669 | 56.8 → 48.4 | 1.78 → 2 | 776 → 625 |
| DET-16 | 19.29 | 58.5 → 51.6 | 4.3 → 16.9 | -7.6 → -13.9 | 22.5 → 0.8 | -26.5 → -18.3 | 15.2 → 6.3 | 0.675 → 0.702 | 32.4 → 31.2 | 2.3 → 2.18 | 603 → 793 |
| DET-17 | 34.39 | 81.4 → 83.2 | 0.8 → 1.2 | 5.4 → 5.5 | 53.8 → 30.8 | -33.8 → -13.7 | 26 → 10.6 | 0.516 → 0.553 | 75.8 → 76.6 | 2.01 → 1.88 | 590 → 639 |
| DET-18 | 10.89 | 76.8 → 71.1 | 5.6 → 15.1 | -13 → -17.2 | 8.3 → -9.7 | -20.4 → -18.8 | 8.7 → 3.6 | 0.625 → 0.635 | 52.9 → 53.1 | 3.04 → 3.31 | 607 → 767 |
| DET-19 | 33.02 | 72.5 → 73.1 | 0.9 → 2.1 | 4.8 → 4.5 | 44.4 → 20.1 | -25.2 → -12.1 | 25.1 → 10.3 | 0.546 → 0.603 | 50.4 → 46.7 | 2.17 → 2.22 | 636 → 654 |

## Honest assessment

- **Fixed:** high-latitude summers (37 → 14 °C mean warmest month at 60–75° land; no seed reaches the 55 °C clamp) and the ocean seasonal range (19 → 8 K at 50–60°) are now Earth-like. Polar annual means cooled by 2.4 K on average (seasonal snow albedo). Ice and tundra climates (Köppen E 3 → 9%) and the Ice biome (1 → 5%) grew.
- **Not fixed, still failing:** the arid bias. Köppen B moved only 62 → 59% (Earth ≈ 30%), cold desert grew 37 → 40% of land. A test capping orographic precipitation efficiency (0.9 → 0.4) changed nothing measurable, so the bias is not the windward-slope cap; it is upstream in moisture supply and transport and needs its own feature.
- **Worse:** runoff ratio 0.61 → 0.65 (Earth ≈ 0.35–0.40) because cooler summers cut Thornthwaite PET. Windward/lee ratio fell slightly (mean 2.98 → 2.75; DET-00 is 1.05 → 0.85, below 1); the pooled rain-shadow test still passes. Winters at 60–75° are now too mild (mean coldest month −17 °C vs ≈ −20 to −35 °C on Earth) because land is coupled to a single zonal ocean anomaly and there is no snow-insulation or inversion physics. High-obliquity worlds (tilt > 30°) keep polar annual means near +5 °C, which is plausible for high obliquity but untested against any reference.
- **Poles still warm** at Earth-like tilts (DET-11, 22.8°: −5 → −7 °C poleward of 66°, vs ≈ −15 to −20 on Earth). Summer sea ice and the latent heat that pins melting surfaces at 0 °C are not modelled.
- Generation time 621–829 ms per world in Node (was 590–1155 ms), under the 1 s budget.

## Assumptions and limitations

- Linear, zonal, harmonic (3 harmonics) seasonal response; no sea-ice thermodynamics, no latent heat of snowmelt, no snow insulation, no seasonal change of transport.
- One mixed-layer depth everywhere; no ocean currents or gyres, so western boundary currents and maritime west coasts are absent.
- K = 12 W m⁻² K⁻¹ at the coast with a 1,000 km e-folding scale is a chosen order-of-magnitude value, not fitted; it is the main control of continentality.
- Snow-albedo ramp limits (0 and −10 °C) are assumptions in the spirit of Budyko's −10 °C ice line.

## Sources

- North, G. R. & Coakley, J. A. (1979). Differences between seasonal and mean annual energy balance model calculations of climate and climate sensitivity. *J. Atmos. Sci.* 36, 1189–1204.
- North, G. R., Cahalan, R. F. & Coakley, J. A. (1981). Energy balance climate models. *Rev. Geophys. Space Phys.* 19, 91–121.
- Budyko, M. I. (1969). The effect of solar radiation variations on the climate of the Earth. *Tellus* 21, 611–619.
- de Boyer Montégut, C., Madec, G., Fischer, A. S., Lazar, A. & Iudicone, D. (2004). Mixed layer depth over the global ocean. *J. Geophys. Res.* 109, C12003.
- Hartmann, D. L. (2016). *Global Physical Climatology*, 2nd ed., ch. 2 and 4 (heat capacity of the atmosphere, soil and ocean mixed layer; seasonal amplitude and lag).
- Peel, M. C., Finlayson, B. L. & McMahon, T. A. (2007). Updated world map of the Köppen-Geiger climate classification. *Hydrol. Earth Syst. Sci.* 11, 1633–1644.
