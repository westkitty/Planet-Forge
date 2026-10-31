# Planet Forge development log

Append-only. Each hourly cycle adds a dated entry; failures are recorded, not removed.

## 2026-10-31 05:09 ET — cycle 1: F-0002 geodesic mesh and rigid-plate tectonics

- Started from main at fd50365. No wip checkpoint existed. Five candidates evaluated (see `docs/features/F-0002-tectonic-plates.md`); chose the 100,002-cell geodesic mesh with Euler-pole plate tectonics (WOW 9).
- Added `src/planet.js` (model version tectonic-0.2) and switched the UI to it. New layers: Plate boundaries, Seafloor age; Tectonic plates layer now shows real plates. Cell inspection reports plate, crust, speed, boundary type and seafloor age. Export carries all 100,002 cells as columns plus a 1-in-10 sample of full cell records.
- Kept `src/world.js` (prototype-0.1) and its tests; its PRNG and seed hash are reused.
- First visual check showed boundary classes flickering cell by cell and trenches hitting the −11,000 m clamp; fixed by smoothing boundary signals along each plate-pair segment and capping trench depth.
- Local verification: tests 13/13, seed report 20/20 reproducible and distinct, smoke 58/58.
- Deployed: 415370a on main, Actions run 41188679630 success, live asset hash matches local build, live smoke 58/58. F-0002 COMPLETE.

## 2026-10-31 05:40 ET — cycle 2 (started early by the user): F-0003 seasonal climate and rain shadows

- Started from main at c5318b2; no wip checkpoint. Six candidates evaluated (see `docs/features/F-0003-climate-circulation.md`); chose tilt-driven energy balance + seasonal circulation + moisture transport with rain shadows + Köppen/Whittaker (WOW 9).
- Added `src/climate.js`; `src/planet.js` now model climate-0.3. UI: Köppen layer, winds-and-rain-shadow layer with wind arrows, season and axial-tilt selectors; inspection shows Köppen class, Jan/Jul temperature, mm/yr; export carries tilt, Köppen, temperature and rainfall columns.
- Problems found and fixed during the cycle: Köppen arid threshold was first coded 10× too large (all land classed B); a coarse-mesh cell reached 99,000 mm/yr, so annual totals are now capped at 12,000 mm; stats line edit initially missed. Two moisture-parameter tuning passes reduced but did not remove the arid bias (documented).
- Deployed: 805e02f on main, Actions run 41191529995 success, live asset hash matches local build, live smoke 70/70. F-0003 COMPLETE.
- Pushes still required approval cards (2 of 2 plus this records push); commits did not.

## 2026-10-31 06:40 ET — cycle 3 (started manually by the user): F-0004 rivers, lakes and drainage basins

- Started from main at be10593; no wip checkpoint; no PAUSED/STOPPED marker. Six candidates evaluated (see `docs/features/F-0004-hydrology.md`); chose hydrology (WOW 9). Arid-bias recalibration rejected as a tuning pass, recorded as a limitation now measured by the endorheic share.
- Added `src/hydrology.js`; `src/planet.js` now model hydro-0.4. UI: Rivers and lakes layer, Drainage basins layer, Great rivers panel, river/endorheic stats, inspection adds discharge, runoff, basin, lake; export adds rivers, lakes and hydrology columns. Settlements need fresh water and the chronicle names their river system.
- First implementation passed tests; the main-stem walk stopped too early (37 m³/s cut-off), lowered to 10 m³/s. Runoff ratio and endorheic share are above Earth's and documented, not tuned.
- Deployed: 5d8ddae on main, Actions run 41194299227 success, live asset hashes match local build, live smoke 78/78. F-0004 COMPLETE.
- Branch push, the local fast-forward merge and the main push each still required an approval card; commits did not.

## 2026-10-31 07:06 ET — cycle 4: F-0005 ice-age glacial maximum (checkpointed, not shipped)

- Started from main at c08909f; no wip checkpoint existed. Seven candidates evaluated (glacial maximum 9, stream-power erosion 8, ocean gyres 8, NPP/ecology 7, seasonal-cycle correction 5, arid-bias recalibration 4 rejected, supercontinent cycle 10 not achievable); chose the glacial maximum.
- Built `src/glaciation.js` on `wip/glaciation` (1ff56c2): obliquity-minimum + glacial-CO2 forcing through the planet's EBM, PDD mass balance, Nye thickness, ice-albedo and height–mass-balance feedbacks, sea-level fall, exposed shelves, land bridges. Tests 30/30.
- First runs gave almost no ice (0.07–1.12% of the surface, 0 land bridges on 20 seeds). Adding the height–mass-balance feedback and a λ = 0.8 K/(W m⁻²) sensitivity changed little. Diagnosis: climate-0.3's undamped seasonal cycle gives 46–55 °C high-latitude summers. A heat-capacity damping experiment fixed the summers but still left ≤ 2.5% ice; it was reverted because it rewrites the whole climate without verification.
- Not deployed; production stays at hydro-0.4. Checkpoint recorded in OPERATIONAL_STATE.md; details in `docs/features/F-0005-glaciation.md` on the branch.

## 2026-10-31 07:20 ET — cycle 5 (started manually by the user): F-0006 seasonal heat-capacity damping

- Started from main at fd3b2f7; lock set. Plan from cycle 4: land the seasonal-cycle correction as its own verified feature before resuming `wip/glaciation`.
- Added `scripts/climate-diagnostics.mjs` and took a 20-seed baseline on hydro-0.4. Implemented the harmonic damped EBM (ocean mixed layer, land heat capacity, maritime coupling K = 12 exp(−d/1000 km)), then monthly snow/sea-ice albedo. Tried capping orographic precipitation efficiency at 0.4 to probe the arid bias: no measurable effect, reverted.
- The new lag test caught a sign error (ocean led the sun by 3 months); fixed before measuring. Smoke annual→January threshold lowered 1% → 0.3% with the measured reason; inspection temperatures rounded to 0.1 °C.
- Result: high-latitude summers 37 → 14 °C, ocean range 19 → 8 K; Köppen B 62 → 59% (still failing), runoff ratio 0.61 → 0.65 (worse), winters too mild. Tests 31/31, seed report 20/20 reproducible and distinct (653–900 ms), smoke 78/78 locally.
- `wip/glaciation` not rebased this cycle (time).
- 07:41–07:45 ET: F-0006 deployed and verified (Actions 41197502470, live hashes match, live smoke 78/78). With time left, merged `wip/glaciation` onto season-0.5 as `wip/glaciation-season` (98e7f52): ice 0.27–4.25%, sea fall ≤ 92.7 m, 0 land bridges, up to 1085 ms/world. Found that precipitation poleward of 70° is ≈ 0 (no eddy moisture transport). Checkpointed, not shipped. Every push and the merge ran without an approval card.

## 2026-10-31 07:48 ET — cycle 6 (user said "continue"): F-0007 eddy moisture transport

- Old lock read "released" (cycle 5); no PAUSED/STOPPED. Lock taken. Branch `feat/eddy-moisture` from fc8f80b.
- Extended `scripts/climate-diagnostics.mjs` with precipitation poleward of 70°, land snowfall poleward of 60° and Ice biome share; 20-seed baseline on season-0.5.
- Attempt 1, cell-scale random walk (share 0.2 / 0.5 of outflow spread to all neighbours): Köppen B 59 → 62 / 70%. Rejected and reverted.
- Attempt 2, zonal-band down-gradient diffusion with D from Frierson et al. (2007): B 59 → 55%, runoff ratio 0.65 → 0.61, P > 70° 74 → 104 mm/yr, land snowfall ≥ 60° 155 → 356 mm/yr. The first version cost ~+170 ms per world. Moving the transport loop into its own function and applying the diffusion every 3 iterations (operator splitting) brought `computeClimate` to 369 ms (was 389 ms). Taking precipitation from the last iteration only broke P/E closure (1.11); now averaged over the last 3-iteration cycle.
- Tests 35/35 (new `tests/eddy.test.js`), seed report 20/20 reproducible and distinct at 638–847 ms/seed, local smoke 78/78.
