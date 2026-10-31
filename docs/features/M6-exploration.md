# Milestone 6 — Deep exploration and experimentation (PF-16, PF-19, PF-32)

Status: IMPLEMENTED and TESTED locally. See the ledger for merge, deployment and live state.

## Local scenes (PF-19, PF-32)

**Rendering.** A descent swaps the scene that the app's single renderer draws, inside the same single animation loop. Nothing else is created. "Return to orbit" disposes the scene's geometries and materials and restores the globe. A new world also exits any descent.

**Terrain (`src/localTerrain.js`).** A 96 × 96 grid spanning 4 mesh cells (about 300 km) around the selected cell:
- **Large-scale height** is inverse-distance interpolated from the authoritative cell elevations. The grid centre is the selected cell (tested).
- **Small-scale detail** is seeded value noise. Its amplitude is half the local relief, clamped to 40–600 m.
- The panel labels the detail as procedural and illustrative. Relief is exaggerated ×4 for display, and the panel says so.

**Sample sites** are deterministic and derived from the cells under the patch:
- on land: river sediment, deformed boundary rock, granitic rock or basalt;
- at sea: hydrothermal vents on divergent boundaries, trench sediment, basalt.

## PF-19 First Footfall

- **Start.** Select a land place, then descend.
- **Controls.** On-screen buttons (touch), or arrows and WASD on the focused view.
- **Energy.** 100 units. Each grid step costs 0.12, plus 0.002 per metre climbed.
- **Mission.** Collect three samples and return to the lander. Running out of energy fails the mission.
- **Record.** The result goes to the journal.

## PF-32 Abyssal Frontier

- **Start.** Select an ocean place. The seafloor comes from the world's bathymetry.
- **Controls.** Move horizontally, and dive or ascend with Q/E or the buttons.
- **Pressure.** Pressure = ρgh + 1 atm, with ρ = 1,025 kg m⁻³ and g = 9.81 m s⁻². A test checks about 1,006 bar at 10 km.
- **Hull.** Rated to 6,500 m (enforced in a test). The vehicle never goes below the seafloor.
- **Energy.** Each horizontal step costs 0.08, and each metre of vertical travel costs 0.004.
- **Mission.** Reach the floor, collect two samples, then surface.

## PF-16 God of Consequences (`src/gameplay/lab.js`)

**Supported interventions.** Only interventions the scientific model supports are offered:
- **Axial tilt.** A full re-run of the same model (glacial-0.8) with the same seed. Relief is unchanged; climate, hydrology and biomes are recomputed.
- **Glacial maximum.** The computed glacial state.

**Isolation.** The baseline planet object is never modified (tested with a fingerprint). The experiment is a separate object, and "Revert" discards it.

**Comparison.** Baseline and experiment are compared in consistent units:
- mean and land temperature;
- land fraction;
- ice-covered land;
- desert land;
- mild, wet land (a habitability proxy: 0–25 °C and ≥ 400 mm/yr);
- mean land rainfall.

**Display.** The globe shows the per-cell temperature change: blue is colder, red is warmer.

**Records.** Each experiment is recorded in the journal.

**Example (ATLAS-001, tilt 13.7° → 45°):**
- mean temperature +2.78 °C;
- land mean −2.43 °C;
- desert land −20.8 points;
- mild, wet land +11.7 points.

**Glacial maximum:** −4.89 °C, with +1.0 point of land as the sea falls.

**Repair.** The first glacial land test used the wrong sign for sea level, so glacial land came out smaller than today's. It now uses the explicit sea-level fall.

**Not offered.** Terraforming, ocean engineering and atmospheric chemistry would each need new, validated, versioned models.

## Evidence

- `tests/explore.test.js` (4 tests):
  - terrain follows the authoritative cells within the stated detail amplitude, and is deterministic;
  - rover energy never increases, and a mission can be completed or failed;
  - submersible pressure and hull limit;
  - lab baseline untouched, reproducible, and units consistent.
- Browser smoke, desktop:
  - rover descent renders local terrain, driving costs energy, and return restores the globe;
  - submersible dive shows ρgh pressure;
  - lab tilt experiment shows the change map and reverts cleanly.

## Known limitations

- Local detail is procedural; the world does not resolve features smaller than about 75 km.
- Vehicles move on a grid with stated costs. There is no physics simulation of traction or buoyancy.
- The lab cannot yet compare two arbitrary saved worlds side by side.
