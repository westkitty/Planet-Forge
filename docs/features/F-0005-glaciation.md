# F-0005 — Ice-age glacial maximum: orbital and CO2 forcing, ice sheets, sea-level fall and land bridges (glacial-0.5)

Status: IN PROGRESS — checkpointed on branch `wip/glaciation` (cycle 4, 2026-10-31). Not merged, not deployed. Blocked by a climate-0.3 defect found while building it (see *Blocking finding*).

## Candidate evaluation (cycle 4, 2026-10-31 07:06 ET)

| # | Candidate | Builds on | WOW (0–10) | Achievable this cycle |
|---|-----------|-----------|-----------|-----------------------|
| 1 | Glacial maximum: obliquity-minimum + glacial-CO2 forcing through the planet's own energy-balance model, positive-degree-day ice-sheet mass balance, Nye perfect-plastic ice thickness, ice-albedo and height–mass-balance feedbacks iterated to a fixed point, eustatic sea-level fall, exposed shelves and land bridges | EBM + monthly climate (F-0003), relief and shelves (F-0002) | 9 | believed yes; turned out blocked (below) |
| 2 | Stream-power erosion and deposition (implicit FastScape-type solver, Braun & Willett 2013) driven by hydro-0.4 discharge, then re-routing rivers on the eroded relief | F-0002, F-0004 | 8 | partially; each erosion step needs a fresh Priority-Flood pass, ≥ +0.5 s per world |
| 3 | Wind-driven ocean gyres (Sverdrup balance with Stommel/Munk western intensification) warming and cooling coasts and feeding back on moisture | prescribed winds (F-0003) | 8 | partially; basin-by-basin streamfunction on an irregular mesh is a multi-cycle job |
| 4 | Ecology: net primary productivity (Miami model, Lieth 1975) and carrying capacity, settlement populations | climate, hydrology | 7 | yes |
| 5 | Seasonal-cycle correction: heat-capacity and latent-heat damping of the seasonal temperature cycle | F-0003 | 5 | yes, but a correction of an existing layer rather than a new capability |
| 6 | Arid-bias recalibration of the moisture model | F-0003 | 4 | rejected again as a tuning pass |
| 7 | Time-stepped supercontinent cycle | F-0002 | 10 | no |

Chosen: #1. It is the only candidate that couples four existing layers at once (insolation/EBM, monthly temperature and precipitation, relief/shelves, and later hydrology and settlements), produces visible emergent geography (ice sheets, exposed shelves, land bridges joining continents) and has a well-established, cheap physical chain.

## What is implemented on `wip/glaciation` (`src/glaciation.js`)

1. **Orbital forcing.** The planet's zonal Budyko–Sellers/North EBM (climate.js, which already contains a temperature-dependent snow/sea-ice albedo) is re-solved at the seeded obliquity minimum (tilt − δ, δ seeded 1.0–2.5°; Earth's obliquity varies ≈ 22.1–24.5°, Berger 1978). The monthly temperature difference per 0.5° row is the orbital signal. Eccentricity and precession are not modelled (the climate model uses a circular orbit).
2. **Greenhouse forcing.** CO2 190 vs 280 ppm, ΔF = 5.35 ln(C/C0) ≈ −2.07 W m⁻² (Myhre et al. 1998), plus −0.7 W m⁻² for CH4 and N2O (approximate PMIP glacial values), converted with a climate-sensitivity parameter λ = 0.8 K/(W m⁻²) (≈ 3 K per CO2 doubling, IPCC AR6 best estimate). λ is an assumption, not derived.
3. **Surface mass balance.** Per land cell and month: snowfall = precipitation × P(T < 1 °C) with daily temperatures normally distributed (σ = 5 K); positive degree days from the closed-form expectation (Calov & Greve 2005); melt with degree-day factors 3 mm w.e. K⁻¹ d⁻¹ for snow and 8 for ice (Braithwaite 1995; Reeh 1991). Glacial precipitation scales by Clausius–Clapeyron, ≈ 7 % per K of cooling (Held & Soden 2006).
4. **Ice sheets and thickness.** Ice where the balance is positive. Thickness from the perfect-plastic profile H = √(2 τ0 d / (ρi g)), τ0 = 100 kPa, d = distance to the margin (Nye 1952; Paterson 1994) — about 3.3 km at 500 km from the margin.
5. **Feedbacks.** Height–mass-balance feedback (Weertman 1961; Oerlemans 1981): ice cells are evaluated at the ice-surface elevation, cells next to ice at a thin advancing margin, so sheets can advance one cell (~70 km) per iteration. Ice-albedo feedback: the zonal fraction of newly glaciated cells raises albedo to 0.62 on its rows; the absorbed-sunlight loss goes back through the EBM (local and transport-to-mean terms). Twelve iterations; present-day ice is computed the same way with no forcing.
6. **Sea level and land bridges.** Eustatic fall = (glacial − present ice volume) × ρi/ρw / ocean area. Shelf cells between the lowered sea and 0 m become land; an exposed shelf component that touches two or more major present landmasses (≥ 40 cells ≈ 200,000 km²) is a land bridge.
7. **Integration so far.** `createPlanet` returns `glaciation` and a `prehistory` sentence; cell inspection carries glacial state and ice thickness; `planetSummary` has a `glaciation` block. Model version string `glacial-0.5` on the branch. **Not done:** globe layer, UI text, export columns, smoke checks, seed-report columns.

## Blocking finding (measured, not tuned away)

Across 20 seeds at 100,002 cells the chain produces almost no ice: glacial ice covers 0.07–1.12 % of the surface (present 0.04–0.89 %), global cooling 2.2–2.7 K, sea-level fall 0.3–11.9 m, **0 land bridges on all 20 seeds**, even on worlds with 27–37 % of their land poleward of 55°. Earth's last glacial maximum had ice on ≈ 8 % of the surface and a ≈ 120–130 m sea-level fall (Clark et al. 2009).

The cause is upstream, in climate-0.3. On seed DET-02 (tilt 30.8°) land at 60–85° latitude has warmest-month means of **46–55 °C** and coldest-month means of −34 to −45 °C (annual means +3 to −7 °C). The seasonal anomaly in `zonalEnergyBalance` is the equilibrium response ΔQ(1 − α)/(B + D) with no heat capacity, ≈ ±39 K at high latitudes, and the per-cell continentality factor (0.7–1.8×) then multiplies it; the cell temperature clamp at 55 °C is reached. Real high-latitude continental summers are ≈ 10–20 °C because the seasonal cycle is damped by heat capacity and by the energy used to melt snow (North & Coakley 1979). With 50 °C summers no snow survives, so no amount of glacial forcing grows ice. This also inflates Thornthwaite PET at high latitudes and is a plausible contributor to the documented arid bias (53–81 % Köppen B).

Making this feature WOW-worthy therefore needs candidate #5 first (a heat-capacity / latent-heat-damped seasonal cycle in the EBM), which changes every climate, hydrology and settlement output and must be re-verified on its own. That did not fit in this cycle's budget and was not attempted half-way.

### Experiment: heat-capacity damping of the seasonal cycle (not committed)

A quick test multiplied the EBM seasonal anomaly by the North & Coakley (1979) annual-harmonic factor 1/√(1 + (ωτ)²), τ = C/(B + D), with a zonal mixed land/ocean heat capacity C = 1×10⁸ J m⁻² K⁻¹ (≈ 25 m of water), factor ≈ 0.28:

| seed | tilt° | warmest month at 65° land, now → damped | Köppen B % now → damped | glacial ice % now → damped | sea fall m now → damped | land bridges |
|------|------|-----------------------------------|-------------------------|-----------------------------|--------------------------|--------------|
| DET-02 | 30.76 | 51.5 → 19.3 °C | 53 → 53 | 0.07 → 0.40 | 0.4 → 1.3 | 0 → 0 |
| DET-08 | 16.41 | 21.8 → 3.5 °C | 65 → 45 | 0.94 → 2.49 | 2.6 → 24.4 | 0 → 0 |
| DET-18 | 10.89 | 11.4 → −0.3 °C | 77 → 70 | 1.12 → 2.20 | 11.9 → 27.7 | 0 → 0 |
| ATLAS-001 | 13.74 | 10.0 → −0.4 °C | 73 → 73 | 0.28 → 1.09 | 1.4 → 21.6 | 0 → 1 |
| DET-05 | 23.12 | 34.1 → 9.0 °C | 75 → 69 | 0.38 → 1.08 | 1.8 → 7.0 | 0 → 0 |

High-latitude summers become Earth-like and ice grows 2–4×, but glacial ice still stays at 0.4–2.5 % of the surface and sea level falls ≤ 28 m, because high-latitude precipitation is only ≈ 20–400 mm/yr (the arid bias starves ice sheets of snow). The experiment changes every climate, hydrology and settlement output, so it was reverted rather than shipped unverified. Next cycle: land a verified seasonal-cycle correction (candidate #5) as its own feature with tests, then revisit high-latitude moisture supply, then finish this feature (globe layer, export, smoke, seed report).

Per-seed diagnostic (Node, 100,002 cells, this branch, undamped climate-0.3):

| seed | ms | tilt° | cooling K | glacial ice % | present ice % | sea fall m | bridges | land ≥55° % |
|------|----|------|-----------|---------------|---------------|-----------|---------|-------------|
| DET-00 | 823 | 32.06 | 2.26 | 0.15 | 0.10 | 0.7 | 0 | 6.5 |
| DET-01 | 752 | 33.70 | 2.29 | 0.91 | 0.81 | 1.3 | 0 | 26.6 |
| DET-02 | 811 | 30.76 | 2.24 | 0.07 | 0.04 | 0.4 | 0 | 36.9 |
| DET-08 | 752 | 16.41 | 2.41 | 0.94 | 0.79 | 2.6 | 0 | 32.7 |
| DET-16 | 767 | 19.29 | 2.59 | 1.10 | 0.89 | 4.2 | 0 | 15.9 |
| DET-18 | 710 | 10.89 | 2.36 | 1.12 | 0.56 | 11.9 | 0 | 9.7 |

(All 20 rows: 698–979 ms per world, cooling 2.23–2.67 K, ice 0.07–1.12 %, bridges 0.)

## Assumptions, simplifications, limitations (of the WIP chain)

- A single equilibrium "glacial maximum" snapshot, not a time-integrated glacial cycle; no ice dynamics beyond the Nye profile; no isostatic depression, no marine ice sheets, no sea ice beyond the EBM's albedo term.
- Obliquity only; no eccentricity or precession (circular orbit in climate-0.3).
- λ = 0.8 K/(W m⁻²) and the CH4/N2O term are prescribed, not emergent; the EBM's own B = 2.09 W m⁻² K⁻¹ would give a weaker response.
- PDD factors and σ are Greenland-calibrated values applied to every world.
- Exposed shelves keep their present maritime temperatures.

## Sources

- Berger, A. (1978). Long-term variations of daily insolation and Quaternary climatic changes. *J. Atmos. Sci.* 35, 2362–2367.
- Myhre, G., Highwood, E. J., Shine, K. P. & Stordal, F. (1998). New estimates of radiative forcing due to well mixed greenhouse gases. *Geophys. Res. Lett.* 25, 2715–2718.
- IPCC (2021). *Climate Change 2021: The Physical Science Basis*, WG I AR6, ch. 7 (equilibrium climate sensitivity ≈ 3 K).
- Braithwaite, R. J. (1995). Positive degree-day factors for ablation on the Greenland ice sheet studied by energy-balance modelling. *J. Glaciol.* 41, 153–160.
- Reeh, N. (1991). Parameterization of melt rate and surface temperature on the Greenland ice sheet. *Polarforschung* 59, 113–128.
- Calov, R. & Greve, R. (2005). A semi-analytical solution for the positive degree-day model with stochastic temperature variations. *J. Glaciol.* 51, 173–175.
- Held, I. M. & Soden, B. J. (2006). Robust responses of the hydrological cycle to global warming. *J. Climate* 19, 5686–5699.
- Nye, J. F. (1952). The mechanics of glacier flow. *J. Glaciol.* 2, 82–93.
- Paterson, W. S. B. (1994). *The Physics of Glaciers*, 3rd ed. Pergamon.
- Weertman, J. (1961). Stability of ice-age ice sheets. *J. Geophys. Res.* 66, 3783–3792.
- Oerlemans, J. (1981). Some basic experiments with a vertically-integrated ice sheet model. *Tellus* 33, 1–11.
- North, G. R. & Coakley, J. A. (1979). Differences between seasonal and mean annual energy balance model calculations of climate and climate sensitivity. *J. Atmos. Sci.* 36, 1189–1204.
- Clark, P. U. et al. (2009). The Last Glacial Maximum. *Science* 325, 710–714.

## Cycle 5 re-measurement on season-0.5 (2026-10-31, branch `wip/glaciation-season`)

`wip/glaciation` (1ff56c2) was merged (not rebased, so no pushed history is rewritten) into a new branch from main at ecba248 (season-0.5, F-0006). The orbital signal now uses the damped zonal seasonal response (`ebm.seasonal.zonal`) instead of the equilibrium anomaly; model version on the branch is `glacial-0.6`. Tests 33/33.

| 20 seeds, 100,002 cells | on climate-0.3 (cycle 4) | on season-0.5 (cycle 5) | Earth LGM |
|---|---|---|---|
| glacial ice, % of surface | 0.07–1.12 | 0.27–4.25 | ≈ 8 |
| present ice, % of surface | 0.04–0.89 | 0.25–2.52 | ≈ 3 (Greenland + Antarctica) |
| global cooling, K | 2.23–2.67 | 2.28–3.43 | ≈ 4–6 |
| sea-level fall, m | 0.3–11.9 | 0.5–92.7 | ≈ 120–130 |
| land bridges | 0 on all seeds | 0 on all seeds | several |
| generation time per world (Node), ms | 698–979 | 773–1085 | budget ≈ 1,000 |

Low-obliquity worlds now grow real ice sheets (DET-16: 4.25% ice, 92.7 m fall; DET-08 and DET-15: ≈ 44 m), but no land bridge forms and high-obliquity worlds (> 30°) stay nearly ice-free. Still not shippable.

New diagnosis: the moisture model delivers almost no precipitation poleward of 70°. Zonal mean annual precipitation on DET-04/05/10/11/16: land 279 mm at 60–70°, **4 mm at 70–80°, 0 at 80–90°** (ocean 562, 35, 7), against ≈ 200–300 mm observed at 70–80° (GPCP, Adler et al. 2003). The subtropical band 20–30° is also extreme (land 141 mm). Cause: the transport is purely advective along the prescribed winds; polar easterlies blow equatorward, cold-air evaporation is cut to 10% below −2 °C, and there is no eddy (diffusive) poleward moisture transport, which carries most of Earth's mid-to-high-latitude moisture flux (Peixoto & Oort 1992). Ice sheets are starved of snow. Next: add eddy moisture diffusion as its own verified climate feature (it should also address the arid bias), then resume this branch and bring generation back under 1 s.

## Cycle 7 (2026-10-31 08:14 ET, manual, user said "Finish the ice age"): glacial-0.8, shipped

Status update (append-only; the status line at the top of this file is historical): F-0005 is finished as world model `glacial-0.8` on branch `feat/glaciation` (from `wip/glaciation-eddy` 42f52ae). Deployment evidence is recorded in OPERATIONAL_STATE.md.

### The bar, fixed before the final measurement

Earth's last glacial maximum is an Earth-specific result: Earth's obliquity and its northern continents at 45–75°. Planet Forge seeds draw obliquity from 10–35°, and a 33° world gets far more polar summer sunshine than Earth. So the bar is measured on each of the 20 test seeds' own geography **at Earth's obliquity (23.44°)**, and the seeded-obliquity results are reported next to it without a pass/fail claim:

| Measure (median of 20 seeds, 100,002 cells) | Bar | Earth reference |
|---|---|---|
| Sea-level fall | 100–140 m | ≈ 134 m (Lambeck et al. 2014); ≈ 120–125 m commonly cited |
| Glacial ice, % of surface | 5–11 % | ≈ 8 % at the LGM, ≈ 3 % today (USGS) |
| Global mean cooling | 4–6.5 K | 4.5 ± 0.9 K (Annan, Hargreaves & Mauritsen 2022); 6.1 K (Tierney et al. 2020) |
| Seeds with a land bridge | ≥ 3 of 20 | Beringia, Sunda, Sahul and others on Earth |
| Default (interglacial) generation | unchanged, ≤ ≈ 1 s | — |

### What changed from glacial-0.7, and why

1. **On demand.** `planet.glaciation` is a memoised getter, so default generation does not pay for it. Interglacial outputs are byte-identical to eddy-0.6 on main: the same 20-seed fingerprint (e79e4d88…) over elevation, temperature, precipitation, Köppen, biome, monthly fields, discharge, lakes, basins, settlements and chronicle.
2. **Linear EBM forcing (fixes the runaway).** The first attempt re-solved the EBM with its temperature-dependent snow/sea-ice albedo and the full Köhler et al. (2010) forcing. It cooled mid-obliquity worlds by 7 K before any ice sheet and ran away to 11–17 K and 340–800 m sea fall. That is the small-ice-cap instability of Budyko–Sellers models, made worse because today's model poles sit on the steep part of the albedo ramp. glacial-0.8 freezes the EBM albedo at today's monthly values, so ΔT = ΔF / B globally. Each albedo feedback is then an explicit term: GHG −2.77 (computed; Köhler −2.8), dust −1.9, exposed shelf −0.6 (uniform), sea ice/snow −2.1 (on rows with a freezing month today), vegetation −1.1 (land at 40–80°), plus the modelled ice sheets (row albedo raised to 0.62). The total prescribed forcing is −8.5 W m⁻²; Köhler's LGM total, including land ice, is −12.4. The prescribed λ = 0.8 of glacial-0.5 to 0.7 is gone. Polar amplification comes from where the sea-ice, vegetation and ice-sheet forcings are placed.
3. **Whole-sheet mass budget (fixes the iteration-limited growth).** glacial-0.7 lifted every cell next to the ice by a 620 m margin, so sheets advanced one cell per iteration until the iterations ran out. Now accumulation cells are ice. A sheet spreads into its ablation ring (least negative first) only while its total balance stays ≥ 0 and it has built its full Nye profile, and a sheet in deficit retreats.
4. **Accumulation-limited thickness.** Each sheet's volume is last step's ice plus its net balance over the step. The Nye profile is scaled down to that volume, never up, so ice cannot exceed the snow that fell.
5. **Elevation desert.** Precipitation is scaled by Clausius–Clapeyron (7 %/K) for the full surface cooling, including the lapse-rate cooling of the ice surface.
6. **Build-up time.** The model runs a 90,000-year build-up (inception ≈ 116 ka to the LGM ≈ 26.5 ka; Clark et al. 2009 date the LGM positions to 26.5–19 ka) in N steps, and margins move at most one cell (~70 km) per step. **N = 48 is the one calibrated parameter.** It was chosen from N = 24/36/40/44/48 so that the Earth-obliquity median sea-level fall lands inside Earth's 120–134 m range. It implies a maximum margin advance of ≈ 37 m/yr, below the ≈ 57 m/yr mean radial growth implied by the Laurentide's 611 km²/yr area growth (Clark et al. 2009). Ice cover, cooling and land bridges were not tuned.
7. **Gazetteer, UI and export.** Named ice sheets (area, volume, maximum thickness, centroid, whether it survives today) and named land bridges (landmasses joined, area, centroid). The UI gains an Era toggle (Today / Last glacial maximum) that draws ice and exposed shelves over any layer, an "Ice age: ice sheets and land bridges" layer, an Ice age panel, glacial stats and an inspection line. The export gains `glacial` (prehistory, stats, ice sheets, land bridges, state codes) and columns `glacialState` and `glacialIceM`.

### Before/after, 20 seeds DET-00..19, 100,002 cells, Node on the agent box

| | glacial-0.7 (42f52ae), seeded obliquity | glacial-0.8, seeded obliquity | glacial-0.8, Earth obliquity 23.44° | Bar |
|---|---|---|---|---|
| glacial ice, % of surface | 0.34–9.02 (median 1.26) | 0.66–17.52 (median 3.85) | 2.22–12.15 (median **5.28**) | 5–11 ✔ |
| sea-level fall, m | 0.6–141.9 (median 4.3) | 3.3–381.2 (median 74.8) | 34.9–284.1 (median **127.1**) | 100–140 ✔ |
| global cooling, K | 2.29–3.65 (median 2.46) | 4.14–7.71 (median 4.96) | 4.51–7.28 (median **5.45**) | 4–6.5 ✔ |
| seeds with a land bridge (bridges) | 1 (1) | 4 (5) | **5** (6) | ≥ 3 ✔ |
| default world generation, ms | 739–1,291 (glacial included, median 910) | 642–853 (median 692; glacial not computed) | 710–919 (median 783) | ≤ ≈ 1,000 ✔ |
| glacial state on demand, ms | — | 266–823 (median 469) | 428–805 (median 557) | — |

The interglacial default generation on main (eddy-0.6), measured the same way, is 685–915 ms (median 766), so there is no regression. In headless Chrome (SwiftShader) the live-equivalent preview reported forge-and-render 1,090–1,143 ms for ATLAS-001 and glacial on demand 632–660 ms.

### Honest limitations

- **Seeded obliquity is bimodal.** The 9 seeds with obliquity ≥ 29° glaciate weakly (3–22 m). Their poles get much more summer sunshine, and the base climate gives their polar land 23–30 °C warmest months, which is probably too warm (no snowmelt or permafrost latent-heat buffer, no polar summer cloud). Low-obliquity seeds glaciate strongly: DET-08 (16.4°) reaches 381 m and 17.5 % ice, about 3× Earth. The seeded-obliquity median sea fall (74.8 m) is below Earth's.
- Today's poles are still warm and dry. Present-day ice is a median 1.4 % of the surface against Earth's 3 %. This base-climate defect was not fixed in this cycle, because fixing it changes every interglacial output.
- High tropical plateaus (> ~5 km) carry present-day "ice sheets" of up to ~2 M km² (Nye-profile height feedback on mountain plateaus). They mostly cancel in the sea-level difference, but they appear in the gazetteer.
- It is a snapshot, not a time-integrated glacial cycle. There is no ice dynamics beyond the scaled Nye profile and no isostasy, calving, marine ice sheets or sea-ice dynamics. Eccentricity and precession are not modelled. The forcings are Earth's LGM values applied to every world. The build-up step count is calibrated, as stated above.

### Additional sources (verified 2026-10-31)

- Köhler, P. et al. (2010). What caused Earth's temperature variations during the last 800,000 years? *Quat. Sci. Rev.* 29, 129–145. LGM forcing −12.4 W m⁻²: GHG −2.8, land cryosphere −4.5 (land ice −3.2, exposed shelves −0.6), sea ice −2.1, vegetation −1.1, dust −1.9.
- Lambeck, K. et al. (2014). Sea level and global ice volumes from the Last Glacial Maximum to the Holocene. *PNAS* 111, 15296–15303. −134 m, ≈ 52 × 10⁶ km³ more grounded ice.
- Annan, J. D., Hargreaves, J. C. & Mauritsen, T. (2022). A new global surface temperature reconstruction for the Last Glacial Maximum. *Clim. Past* 18, 1883–1896. −4.5 ± 0.9 K.
- Tierney, J. E. et al. (2020). Glacial cooling and climate sensitivity revisited. *Nature* 584, 569–573. −6.1 K (−6.5 to −5.7).
- USGS FAQ, "How does present glacier extent and sea level compare to … the Last Glacial Maximum?": 8 % of the surface and 25 % of land at the LGM; 3 % and 11 % today.
- Clark, P. U. et al. (2009). The Last Glacial Maximum. *Science* 325, 710–714. LGM positions 26.5 to 19–20 ka; Laurentide area growth 611 km² yr⁻¹.
