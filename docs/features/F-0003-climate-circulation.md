# F-0003 — Seasonal climate, circulation, moisture transport and rain shadows (climate-0.3)

Status: COMPLETE — deployed 2026-10-31 in 805e02f (Actions run 41191529995, live smoke 70/70).

## Candidate evaluation (cycle 2, 2026-10-31 05:40 ET)

| # | Candidate | Builds on | WOW (0–10) | Achievable this cycle |
|---|-----------|-----------|-----------|-----------------------|
| 1 | Axial tilt + insolation-driven energy-balance climate, seasonal three-cell winds following the ITCZ, moisture advection over the 100k mesh with orographic rain shadows, Köppen–Geiger and Whittaker classification, tilt/season controls and wind-arrow layer | tectonic relief (F-0002) | 9 | yes |
| 2 | Hydrology: priority-flood depression filling, steepest-descent drainage, river discharge, lakes | relief; but discharge needs rainfall (#1) to be meaningful | 8 | yes, but would route placeholder rainfall |
| 3 | Time-stepped supercontinent cycle (plates move, collide, rift over 500 Myr) | F-0002 | 9 | no; too large for one cycle |
| 4 | Stream-power erosion and sediment deposition reshaping the tectonic relief | relief, rainfall (#1) for runoff | 7 | partially |
| 5 | Ocean surface currents (wind-driven gyres) and their effect on coastal temperature | winds (#1) | 7 | no; needs #1 first |
| 6 | Glaciation / ice-age cycles from orbital forcing | energy balance (#1) | 8 | no; needs #1 first |

Chosen: #1. It turns the tectonic mountains into climate consequences (deserts in their lee, wet windward slopes), adds a planetary parameter the user can change (axial tilt) with visible, emergent effects, and it is the input every later model (rivers, erosion, ecology, settlements) needs.

## What it does (`src/climate.js`)

1. **Insolation.** Daily-mean top-of-atmosphere insolation for each mid-month from the axial tilt, circular orbit, S0 = 1361 W m⁻² (Kopp & Lean 2011): Q = (S0/π)(h0 sinφ sinδ + cosφ cosδ sin h0), δ = asin(sin ε sin λ). Seeded tilt 10–35° (independent random stream, so relief is unchanged); the UI can override it (0–90°).
2. **Energy balance.** Zonal Budyko–Sellers-type model on 0.5° rows (North 1975; North, Cahalan & Coakley 1981): OLR = A + B·T with A = 203.3 W m⁻², B = 2.09 W m⁻² K⁻¹; heat transport γ(T̄ − T) with γ = 3.81 W m⁻² K⁻¹; albedo 0.30, ramping to 0.62 below −2…−18 °C (ice–albedo). Annual-mean temperature per row, plus monthly equilibrium anomalies.
3. **Surface temperature per cell, per month.** Zonal annual temperature + damped monthly anomaly (ocean ×0.35 with 2-month lag; land ×0.7–1.8 increasing with distance from the sea, 1-month lag) − 6.5 K/km lapse rate (ICAO) + ±1.5 °C noise.
4. **Circulation.** Prescribed Hadley/Ferrel/polar cells: trade easterlies with equatorward flow, mid-latitude westerlies with poleward flow, polar easterlies. The belts are remapped around the ITCZ, which follows the sun at 0.35 × declination (≈ ±8° at Earth's tilt). Ascent is strong at the ITCZ and the polar front, suppressed in subtropical highs. Computed for January and July.
5. **Moisture transport (steady state, 90 Jacobi iterations per season).** Ocean cells evaporate in proportion to Magnus saturation vapour pressure (Murray 1967); moisture moves downwind to neighbouring cells weighted by the wind's projection on each mesh edge; each cell rains out a fraction set by ascent and by orographic uplift along the wind, plus any excess over a saturation capacity that falls with temperature (so cold mountain tops wring out air); downslope (lee) cells have reduced rain-out (foehn drying); land re-evaporates 70% of its rain (recycling). Rain shadows emerge from this; they are not painted. The global moisture budget closes to 96–98% (P/E) after 90 iterations.
6. **Precipitation units.** Model units × a fixed constant (76) → mm/yr. The constant was calibrated once so seed ATLAS-001 at 23.44° gives ≈1,000 mm/yr (Earth's global mean is ≈1,000 mm/yr; Adler et al. 2003). Monthly precipitation blends the January and July regimes with a cosine weight. Annual totals are capped at 12,000 mm (≈ Earth's wettest stations); ≈0.4% of cells hit the cap.
7. **Köppen–Geiger.** All 30 classes using the criteria of Peel, Finlayson & McMahon (2007) (E before B; summer = Apr–Sep in the north), with their legend colours.
8. **Whittaker-inspired biomes.** 11 land biomes from annual temperature and precipitation, boundaries hand-approximated from Whittaker (1975) / Ricklefs' rendering; Köppen EF → Ice.
9. **UI.** New layers: Köppen climate; Winds and rain shadows (arrows of the prevailing wind on ~2,500 cells, land coloured by precipitation relative to the zonal mean at that latitude: blue wetter, brown drier). Season selector (Annual / January / July) for temperature, rainfall and winds. Axial-tilt selector (Seeded, 0°, 23.44°, 45°, 60°, 90°) re-forges the climate. Inspection shows Köppen class, January/July temperature and mm/yr. Export adds tilt, Köppen, temperature and rainfall columns.

## Assumptions, simplifications, limitations

- **Not a general circulation model.** Winds are prescribed by latitude, not solved from momentum equations; they do not respond to continents, mountains or tilt beyond the ITCZ shift. At high tilt (≳ 45°) real circulation reorganises (e.g. Ferreira et al. 2014); this model only shifts its belts, so high-tilt climates are qualitative.
- The energy balance is zonal and diffusive-to-mean; there are no ocean currents, no ocean heat transport geography, no clouds, no greenhouse feedback beyond the linear OLR. Seasonal anomalies are equilibrium values scaled by fixed heat-capacity factors, not integrated in time.
- Polar annual temperatures are warm compared with Earth (EBM pole ≈ −5 °C at 23.44°), because there are no ice sheets or polar inversions. Few EF/ET cells result.
- Moisture moves one cell per iteration regardless of wind speed; wind speed only sets direction. Monthly rain is a blend of two regimes (January, July), not twelve.
- **Arid bias:** across 20 seeds 53–81% of land is Köppen group B (Earth ≈ 30%; Peel et al. 2007). Causes: large tectonic continents, strong lee drying, no monsoon/thermal-low dynamics. Treat desert extent as exaggerated.
- Precipitation is scaled by one fixed constant; the 12,000 mm cap is a guard, not physics.
- Whittaker boundaries are approximations; real biome boundaries depend on seasonality, soils, fire and history.

## Verification (local, 2026-10-31)

- `npm test`: 21/21 pass (8 new in `tests/climate.test.js`: insolation identities incl. global mean = S0/4 within 1%; EBM gradient vs tilt; Magnus value and ~7%/K scaling; zero tilt ⇒ no seasons and seasonal range grows with tilt; ITCZ follows the sun; tilt changes climate but not relief and is reproducible; 20-seed moisture-budget closure, Köppen/ocean consistency, EF ⇒ Ice, warmest month < 10 °C ⇒ E, monthly sums = annual, equator ≥ 15 °C warmer than poles; windward vs lee precipitation > 1.5× on 100,002 cells; Köppen textbook cases Af, BWh, ET, EF, Csa, Dfb).
- `npm run seed-report`: 20/20 reproducible and distinct at 100,002 cells (fingerprint now includes temperature, rainfall, Köppen); generation 497–703 ms per seed (Node 24, was 165–286 ms); mean precipitation 969–1,341 mm/yr; P/E 0.962–0.984.
- Browser smoke (headless Chrome, SwiftShader, vite preview): 70/70 at 1280×800 and 390×844.

## Sources

- Kopp, G. & Lean, J. L. (2011). A new, lower value of total solar irradiance. *Geophys. Res. Lett.* 38, L01706.
- North, G. R. (1975). Theory of energy-balance climate models. *J. Atmos. Sci.* 32, 2033–2043.
- North, G. R., Cahalan, R. F. & Coakley, J. A. (1981). Energy balance climate models. *Rev. Geophys.* 19, 91–121.
- Hartmann, D. L. (2016). *Global Physical Climatology*, 2nd ed. Elsevier. (Insolation, Hadley/Ferrel circulation, ITCZ.)
- Murray, F. W. (1967). On the computation of saturation vapor pressure. *J. Appl. Meteor.* 6, 203–204.
- Roe, G. H. (2005). Orographic precipitation. *Annu. Rev. Earth Planet. Sci.* 33, 645–671.
- Adler, R. F. et al. (2003). The Version-2 GPCP monthly precipitation analysis (1979–present). *J. Hydrometeor.* 4, 1147–1167.
- Peel, M. C., Finlayson, B. L. & McMahon, T. A. (2007). Updated world map of the Köppen–Geiger climate classification. *Hydrol. Earth Syst. Sci.* 11, 1633–1644.
- Whittaker, R. H. (1975). *Communities and Ecosystems*, 2nd ed. Macmillan.
- Ferreira, D., Marshall, J., O'Gorman, P. A. & Seager, S. (2014). Climate at high-obliquity. *Icarus* 243, 236–248.
- ICAO (1993). *Manual of the ICAO Standard Atmosphere*, Doc 7488.
