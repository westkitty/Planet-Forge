# Milestone 4 — Living worlds (PF-15, PF-20, PF-21, PF-23, PF-33)

Status: IMPLEMENTED and TESTED locally. Merge, deployment and live state are recorded in `docs/implementation/PF_MASTER_PROGRESS.md`.

All five systems are in the Play tab. They read the world arrays and never write them; a test fingerprints the world before and after.

## PF-15 River Kingdoms (`src/gameplay/civilization.js`)

A deterministic 2,000-year history of the generated settlements, run in 10-year steps.

**Carrying capacity.** Each site supports the sum, over land within 3 mesh rings, of NPP × 0.6 people, ×1.3 when the site has fresh water. NPP comes from the Miami model (Lieth 1975) using the world's temperature and rainfall; a unit test checks the reference values.

**Each decade:**
- Population grows logistically.
- Droughts last 1–4 decades. Their chance comes from the site's month-to-month rainfall variability.
- Exposed sites can be hit by earthquakes or floods (exposure as in PF-18).
- Trade runs over land-weighted routes up to 5,000 km.
- People migrate to partners with spare capacity.
- Famine takes half of any population above capacity.
- Overcrowding depletes soils.
- Stressed partners may go to war.

**Abandonment.** A settlement is abandoned when it falls below 12 % of its peak after 150 years. The recorded cause is the dominant stress of its last 50 years.

**Player decisions.** One investment per decade (irrigation, granary or road). Decisions are stored as a gameplay flag, so they are saved and replay exactly.

**Settlement lights.** Each settlement's night lights now follow its recorded population; ruins show grey markers and settlements not yet founded are hidden. This also completes PF-08's population-based lighting.

**Tests:** determinism; population bookkeeping (no people before founding or after abandonment); capacity varying with geography; original settlement data unchanged; investments changing history.

All rates and scalings are gameplay values, listed in the panel's rules.

## PF-23 Deep Time

- A year slider (0–2,000), Play/Pause and Rewind. Seeking returns the recorded snapshot for that decade (tested).
- Epochs separate the two **computed** world states (last glacial maximum, present) from **recorded** history (age of founding, age of decline or growth).
- Branches: save the current decisions as a branch, then compare population, famines and ruins against it. Re-running a branch reproduces it (tested).
- No geological change is animated: the model has no time-evolving geology.

## PF-33 The World Remembers

- Ruins come only from recorded abandonments. A test checks each ruin's year against the abandonment event and confirms abandoned settlements are never silently repopulated.
- Ruins decay by age: fresh (< 100 years), weathered (< 400), buried.
- Excavation lists every recorded event at or involving the site as layers (each one is a real event record), states the facts, and gives a clearly labelled interpretation.
- Excavated ruins are logged as discoveries and persist in saves.

## PF-21 The Silent Planet

- One case per ruin, but only when the recorded cause is supported by at least two evidence items. This keeps every offered case solvable.
- Clue sites: the ruin itself (event layers), a trading partner's records, water and climate (capacity, drought chance), and geological context.
- You must stand within two cells of a site to examine it.
- A conclusion needs at least two collected items that support it and must match the recorded cause. Unsupported or wrong conclusions fail (tested).
- Each case is labelled as generated scenario history.

## PF-20 Life Finds a Way (`src/gameplay/ecology.js`)

**Regions.** Land is grouped into 10° × 10° regions with at least 20 land cells; ATLAS-001 has 234. Each region has a mean climate and an NPP-based capacity.

**Species.** Ten seeded species, each with a temperature optimum and tolerance, a rainfall preference, a dispersal rate and a size.

**Each generation:**
- logistic growth;
- dispersal to neighbouring regions;
- niche competition;
- adaptation, at most 0.25 °C per generation;
- extinction below 1 individual;
- speciation once a species' core range has stayed split for 5 generations.

**Pressures.** Warming or cooling, or the computed glacial maximum (its cooling, with ice-covered regions made barren).

**Limits.** At most 40 species. Ten generations take about 10 ms.

**Panel.** Field guide, tree of descent, history of life, and each species' range highlighted on the globe.

**Tests:** determinism; bounded populations; speciation under +6 °C warming; extinctions under severe cooling.

## Evidence

- **Unit tests:** `npm test` 85/85, including 7 new tests in `tests/history.test.js`.
- **Browser smoke:** 151/151, including five new desktop checks:
  - an investment changes the history;
  - Deep Time seek, epochs and branch save;
  - excavation layers with interpretation;
  - examining clues and reaching the correct, evidenced solution;
  - 30 generations with a tree of descent.
- **Smoke-test robustness:** after PR #5 CI failed on one Milestone 3 check, the computed-panel checks now wait for conditions instead of fixed delays. One wait used an invalid combined Playwright selector; its error was swallowed, so it never waited at all. This is the most likely cause of the CI failure.

**Repairs during design:**
- The first simulation produced no ruins. Collapse dynamics were reworked: multi-decade droughts, soil depletion, and abandonment relative to peak.
- Every collapse cause read "famine". Cause is now attributed to the dominant stress of the last 50 years.
- Mysteries with an unsupported cause were filtered out to keep every case solvable.
- Updating the light field on every seek would have orphaned GPU buffers. It is now updated in place.
- Ecology produced no events. Range gaps were made density-based and adaptation was slowed.

## Known limitations

- History, ecology and mysteries are gameplay models with declared rules; they are not demography, archaeology or evolutionary biology.
- History uses the present-day climate throughout.
- Ecology regions are coarse boxes and ignore narrow sea barriers.
