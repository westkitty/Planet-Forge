# Milestone 3 — Playable planetary science (PF-14, PF-17, PF-18, PF-22, PF-28, PF-29)

Status: IMPLEMENTED and TESTED locally on top of main 3628217. Merge, deployment and live state are tracked in `docs/implementation/PF_MASTER_PROGRESS.md`.

All six modes live in the Observatory drawer's **Play** tab, which opens on demand; the console stays at 14.5 %.

## Rules that apply to every mode

- **Read-only world.** Modes read the world arrays and never write them. A unit test fingerprints the world before and after running every mode.
- **Deterministic randomness.** All randomness comes from `gameRng(worldSeed, scenario, gameSeed)`, so the same world, decisions and seed replay to the same outcome. Tests assert deep equality between replays.
- **Stated rules.** Every gameplay rule is listed in the mode's "Rules (gameplay approximations)" panel.
- **Recorded results.** Outcomes go to the gameplay store (journal, decisions, discoveries, flags), so saves (PF-13) and future history systems (PF-23) can use them.
- **Shared engine.** `src/gameplay/core.js` provides a binary-heap Dijkstra over the cell mesh (tested to match breadth-first hop counts), a reachability search, and the seeded RNG.

## The modes

### PF-28 Seasons as Strategy — `expedition.js`

- **Route.** Least-time land route between two places (no lakes, no sea).
- **Step costs.** Pace 25 km/day, slowed by:
  - slope (×(1 + 25 × grade));
  - altitude (+50 % above 3,000 m);
  - the month at each cell, using the model's monthly climate: snow below −5 °C, mud and swollen streams from rainfall, heat above 32 °C.
- **Changing seasons.** The month advances with elapsed days, so a long trip crosses seasons.
- **Daily incidents.** Chances for cold, flood, heat and altitude.
- **Supplies.** One ration per person per day, with restocks at settlements.
- **Forecast.** A 12-month table of distance, days, expected incidents and rations needed.
- **Run.** Pick party size, rations, pace (forced march is faster and riskier per day) and departure month, then run the expedition.

### PF-22 The Planet Trials — `trials.js`

- **Five challenge kinds:**
  - a sustainable settlement site (six scored criteria);
  - a large basin that drains to the sea;
  - a rare Köppen meeting point found in this world;
  - a rift research station;
  - the safest travel month between two settlements.
- **Solvable by construction.** Each challenge is offered only after the generator finds a solution in this world.
- **Scoring.** Three attempts each. Hints cost 10 points each.
- **Sharing.** A challenge code `WORLD~n` regenerates the same set.
- **Records.** Wins are journalled. Winning all five sets an achievement flag.

### PF-17 The Cartographer's Oath — `survey.js`

- **Optional mode.** Begin survey, then leave survey; leaving restores the full atlas.
- **Fog.** Unmapped cells render as fog (presentation only).
- **Budget.** 14 points:
  - a probe (1 point) reveals 12 mesh rings;
  - an orbital pass (3 points) reveals a ±3° latitude band.
- **Coverage.** Rebuilt from the scan log, so saves stay small and replay exactly.
- **Objectives.** Highest summit, deepest trench, mouth of the largest river, largest freshwater lake, and every settlement. Each comes with a 20° latitude-band clue.
- **Findings.** Collision ranges, spreading ridges, salt lakes and great river mouths are logged automatically as discoveries.

### PF-29 The Watershed Council — `watershed.js`

- **Reaches.** The main stem of a river that reaches the sea is split into four reaches, each gaining the discharge the hydrology model adds along it.
- **Monthly flow.** Follows the basin's monthly rainfall. This is a declared approximation: the hydrology model itself is annual.
- **Irrigation.** Level 0–3 per district asks L × 15 % of the mean monthly flow reaching it, in growing-season months. 60 % of what is taken is consumed; the rest returns to the river.
- **Reservoirs and environmental flow.** Reservoirs store up to two months of a reach's mean inflow. The environmental flow at the mouth must stay at or above 30 % of natural flow.
- **Conservation.** Water is conserved exactly: inflow = consumed + outflow + Δstorage, with a balance error of about 1e-11 km³ in the smoke run.
- **Trade-offs are real.** On ATLAS-001's largest river:
  - irrigation level 1 everywhere gives 100 % harvest and 100 % river health;
  - irrigation level 3 everywhere gives 98 % harvest but only 25 % river health.
- **Upstream effects.** Upstream withdrawals can only reduce what the delta receives (asserted in tests).

### PF-14 The Great Thaw — `thaw.js`

- **Setup.** Uses the computed glacial maximum. The start is the largest present-day landmass touching a land-bridge cell. The goal is the largest other present-day landmass joined to it only in the glacial world, using the glaciation model's own 40-cell landmass threshold.
- **Rising sea (declared approximation).** Sea level rises linearly to today's level over 24 turns. The model computes only the glacial and present end states, not the path between them.
- **Passability.** Cells above the current sea level and not under ice are passable.
- **Choices per turn.** March (6 cells, no foraging), travel (3 cells, forage) or rest (forage twice).
- **Rations.** One per person per turn. Foraging yield depends on present-day rain and warmth.
- **Outcomes.** Victory on reaching the far landmass. Defeat if rations run out or the route closes.
- **Chronicle.** Every turn is recorded.
- **Tests (DET-10):** forced marching from the start crosses; waiting 23 turns fails; all exposed shelf is underwater by the final turn.
- **Bridge worlds.** Worlds with a land bridge at seeded obliquity are DET-10, DET-11, DET-13 and DET-15; ATLAS-001 also has one. Other worlds explain that they have none and offer to forge DET-10.

### PF-18 Faultline Command — `faultline.js`

- **Hazard exposure (from the world).**
  - Earthquake: near convergent or transform boundaries.
  - Volcano: near a convergent boundary with high land.
  - Flood: beside rivers of 2,000 m³/s or more.
- **Fictional values, disclosed as such.** Yearly event chances and the 10,000-person settlement figure are gameplay values.
- **Budget.** 12 points:
  - reinforce (3): −70 % quake and eruption losses;
  - levee (2): −80 % flood losses;
  - evacuate (1): −90 % of losses that year, at a 5 % disruption cost.
- **Campaign.** Eight years. Outcomes are deterministic, and people are conserved: survivors + losses = starting population.
- **Catastrophe laboratory.** A separate, illustrative scaling (crater ≈ 20 × impactor diameter) reports the settlements inside the blast radius. It is explicitly not a validated impact model.

## Evidence

**Unit tests.** `npm test` 78/78, including 8 new tests in `tests/gameplay.test.js`:
- Dijkstra optimality;
- expedition determinism and the forced-march trade-off;
- every trial solvable via its own hint, with hint-cost scoring and challenge-code parsing;
- survey budget conservation and coverage reconstruction;
- watershed conservation, upstream→downstream effect and real trade-off;
- faultline budget, determinism and population conservation;
- Great Thaw open-then-closed bridge, win/loss and determinism;
- the world unmodified after all of the above.

**Browser smoke.** `scripts/smoke.mjs` 146/146. Six new desktop checks run each mode through its real panel:
- trial criteria and attempts;
- 12-month expedition forecast and launch;
- survey fog, probe and full-atlas restore;
- watershed ledger;
- eight-year faultline campaign;
- a Great Thaw played to a terminal outcome.

**Repairs during verification.**
- The river path runs mouth → source, so the watershed now reverses it.
- Ocean cells have no basin; the trial now guards for this.
- The thaw setup now uses glacial connectivity: bridge cells alone only touched one landmass.
- Watershed demand was negligible against large rivers, so harvests were always 100 %. Demand is now scaled to reach flow.
- Survey probes were too small and objectives gave no clues. Probes now cover 12 rings and each objective has a latitude-band clue.

**Build.** JS 648.44 kB (184.36 kB gzip), up from 563.74 kB at M1. The existing >500 kB advisory still applies; code-splitting the drawer is a candidate follow-up.

## Known limitations

- All six modes use stated gameplay approximations, not physical simulations: seasonal river flow, linear sea-level rise, fictional hazard frequencies and populations, and illustrative impact scaling.
- Expedition routes are land-only; there is no sea travel.
- Survey mode affects colours only. The other drawer tools still read the full world, by design: the free atlas stays available.
