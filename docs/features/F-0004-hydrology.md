# F-0004 — Rivers, lakes, salt lakes and drainage basins (hydro-0.4)

Status: COMPLETE — deployed 2026-10-31 in 5d8ddae (Actions run 41194299227, live smoke 78/78).

## Candidate evaluation (cycle 3, 2026-10-31 06:40 ET)

| # | Candidate | Builds on | WOW (0–10) | Achievable this cycle |
|---|-----------|-----------|-----------|-----------------------|
| 1 | Hydrology: Budyko runoff, Priority-Flood drainage over the 100k mesh, river discharge, lakes with a closed water balance (terminal salt lakes and salt flats where evaporation wins), drainage basins, named great rivers, settlements on fresh water | relief (F-0002) + monthly temperature and rain (F-0003) | 9 | yes |
| 2 | Stream-power erosion and sediment deposition reshaping the relief | needs discharge (#1) | 8 | only after #1 |
| 3 | Glaciation / ice-age cycles from orbital forcing (Milankovitch-style tilt and eccentricity cycles, ice-albedo growth of ice sheets) | energy balance (F-0003) | 9 | partially; ice-sheet flow and sea-level coupling too large for one cycle |
| 4 | Wind-driven ocean gyres and western boundary currents that warm and cool coasts | prescribed winds (F-0003) | 8 | partially |
| 5 | Time-stepped supercontinent cycle (plates move, collide and rift over 500 Myr) | F-0002 | 10 | no; multi-cycle epic |
| 6 | Recalibrate the arid bias in the moisture model (53–81% Köppen B) | F-0003 | 4 | yes, but a tuning pass, not a new capability |

Chosen: #1. It turns the existing rain and mountains into a visible, explorable network (rivers that grow downstream, lakes, closed desert basins with salt lakes that emerge in rain shadows), every later model (erosion, ecology, trade routes, civilisations) needs discharge and basins, and settlements now sit on rivers and lakeshores. Candidate #6 was not done: it is a re-tuning with no new capability, and the new endorheic-basin statistic now makes the bias measurable (below).

## What it does (`src/hydrology.js`)

1. **Potential evapotranspiration.** Thornthwaite (1948) monthly PET from the climate model's monthly temperature, heat index I and exponent a, corrected for day length (from latitude and the planet's own solar declination) and month length; Willmott, Rowe & Mintz (1985) hot-month branch above 26.5 °C.
2. **Actual evapotranspiration and runoff.** Long-term annual water balance from the Budyko framework in Fu's form, AET/P = 1 + PET/P − (1 + (PET/P)^w)^(1/w), w = 2.6 (Zhang et al. 2004). Runoff = P − AET on every land cell.
3. **Drainage.** Priority-Flood (Barnes, Lehman & Mulla 2014) from every coastal land cell over the 100,002-cell mesh fills depressions and gives a drainage order in which each receiver is processed before its donors. Cells with a strictly lower neighbour drain by steepest descent on the filled surface (O'Callaghan & Mark 1984, generalised from D8 to the geodesic mesh); cells inside depressions follow the flood route to the spill point.
4. **Discharge.** Runoff (mm/yr × cell area, ≈5,100 km²) is accumulated downstream to m³/s. Cells with ≥ 150 m³/s are drawn as rivers, coloured by log discharge.
5. **Lakes with a water balance.** Each connected filled depression is a lake. Inflow (upstream discharge + rain on the lake) is compared with open-water evaporation (≈ PET over the lake area). If inflow exceeds evaporation, the lake overflows and the surplus continues downstream (fresh lake). Otherwise the lake has no outlet: it becomes a terminal salt lake that shrinks to the area its inflow can sustain (the deepest cells stay wet) and the rest of the basin floor becomes salt flat; its whole catchment is an endorheic basin. These emerge mostly in the tectonic rain shadows produced by F-0003.
6. **Basins and rivers.** Every land cell is assigned to the basin of its sea mouth or terminal lake. The 12 largest basins (by mouth discharge) are named with seeded syllables; main-stem length follows the largest tributary upstream from the mouth (Hack 1957 style) until discharge falls below 10 m³/s.
7. **Integration.** Settlements now require fresh water within one cell (a river of ≥ 50 m³/s or a fresh lake); after 4,500 failed tries rain-fed sites are accepted. The chronicle records which river system or lakeshore a settlement was founded on.
8. **UI.** New layers: *Rivers and lakes* (river network, fresh lakes blue, salt lakes teal, salt flats white) and *Drainage basins* (one colour per basin, endorheic basins in browns, with the river network). A *Great rivers* panel lists the five largest rivers with discharge and length. Stats show total river discharge to the sea and the endorheic share of land. Cell inspection adds discharge, runoff, basin and lake type. Export adds rivers, lakes and per-cell runoff, discharge, basin, lake and receiver columns.

## Assumptions, simplifications, limitations

- **Conceptual water balance, not hydrodynamics.** Steady state, annual mean; no seasonality of flow, no groundwater, no channel routing, no floods. Lakes evaporate at the Thornthwaite PET of their cells, a crude stand-in for open-water evaporation.
- Thornthwaite PET is temperature-only; it is known to underestimate PET in arid and windy climates and overestimate it in humid tropics (e.g. Allen et al. 1998 prefer Penman–Monteith). One global Fu parameter (w = 2.6) ignores vegetation, soils and seasonality.
- **Runoff ratio is high**: 0.52–0.70 across 20 seeds vs ≈0.35–0.40 for Earth's land (Oki & Kanae 2006). Most rain falls on a few very wet windward cells, where the Budyko curve sends most of it to runoff. River discharges are therefore larger than Earth analogues (largest river 67,000–545,000 m³/s vs the Amazon's ≈209,000 m³/s).
- **Endorheic share is high**: 28–76% of land drains to terminal lakes (Earth ≈ 20%). This follows from the climate model's known arid bias (53–81% Köppen B) and from small closed pits in the tectonic relief; it is a consequence, not a separately tuned quantity.
- Rivers follow mesh edges (≈ 70 km steps), so they are straighter and shorter than real rivers; lengths are mesh path lengths.
- Relief is not eroded or changed by rivers (no stream-power incision or deposition yet), and land below 0 m is always sea, so there are no below-sea-level dry basins.
- Salt lakes shrink by cell count, not by a hypsometric volume calculation.
- River names are seeded syllables with no linguistic model.

## Verification (local, 2026-10-31)

- `npm test`: 28/28 pass (3 new tests in `tests/hydrology.test.js`: Thornthwaite and Fu/Budyko limits; on 20 seeds at 10,242 cells every land cell drains, flow never goes uphill on the filled surface, receivers lead to the sea or a terminal lake with no cycles, runoff ≤ rain, terminal lakes evaporate at least their inflow, fresh-lake outflow = inflow − evaporation, global water balance (runoff + lake rain = discharge to sea + lake losses) closes within 0.2%, settlements never sit in a lake, reproducible; on 100,002 cells discharge never decreases downstream along named rivers, > 1,000 river cells, > 10 lakes, relief unchanged by tilt).
- `npm run seed-report`: 20/20 reproducible and distinct at 100,002 cells (fingerprint now includes discharge, basins and settlements); 637–814 ms per world in Node (was 497–703 ms); runoff ratio 0.52–0.70; endorheic land 28–76%; discharge to sea 0.89–3.81 million m³/s; 160/160 settlements on fresh water.
- Browser smoke (headless Chrome, SwiftShader, vite preview): 78/78 at 1280×800 and 390×844, zero console errors.

## Sources

- Thornthwaite, C. W. (1948). An approach toward a rational classification of climate. *Geogr. Rev.* 38, 55–94.
- Willmott, C. J., Rowe, C. M. & Mintz, Y. (1985). Climatology of the terrestrial seasonal water cycle. *J. Climatol.* 5, 589–606.
- Budyko, M. I. (1974). *Climate and Life*. Academic Press.
- Fu, B. P. (1981). On the calculation of the evaporation from land surface. *Sci. Atmos. Sin.* 5, 23–31.
- Zhang, L., Hickel, K., Dawes, W. R., Chiew, F. H. S., Western, A. W. & Briggs, P. R. (2004). A rational function approach for estimating mean annual evapotranspiration. *Water Resour. Res.* 40, W02502.
- Barnes, R., Lehman, C. & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm for digital elevation models. *Comput. Geosci.* 62, 117–127.
- O'Callaghan, J. F. & Mark, D. M. (1984). The extraction of drainage networks from digital elevation data. *Comput. Vis. Graph. Image Process.* 28, 323–344.
- Hack, J. T. (1957). Studies of longitudinal stream profiles in Virginia and Maryland. *USGS Prof. Paper* 294-B.
- Oki, T. & Kanae, S. (2006). Global hydrological cycles and world water resources. *Science* 313, 1068–1072.
- Allen, R. G., Pereira, L. S., Raes, D. & Smith, M. (1998). *Crop evapotranspiration*. FAO Irrigation and Drainage Paper 56.
