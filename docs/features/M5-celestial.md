# Milestone 5 — Celestial systems (PF-04, PF-24, PF-25, PF-26)

Status: IMPLEMENTED and TESTED locally. The ledger (`docs/implementation/PF_MASTER_PROGRESS.md`) records merge, deployment and live state.

All four systems are in the Play tab. Their state is stored as gameplay flags, so it is saved and restored with the world.

`src/celestial.js` uses explicit units throughout: km, s, days, AU and W m⁻². It works in two frames:
- **Ecliptic:** heliocentric and inertial.
- **Body:** the app's planet frame, with y as the north pole and longitude = atan2(z, x).

The planet's axis is tilted by the world's obliquity and spins once every 24 h (a stated assumption).

## PF-24 Stellar Foundry

**Choices.** Seven main-sequence types (M5V–A0V), each with a representative effective temperature, luminosity, mass and radius, plus an orbital distance of 0.01–50 AU. Invalid input is rejected.

**What it computes:**
- Incoming flux S = 1361 W m⁻² × (L/L☉)/d².
- Year length from Kepler's third law.
- Equilibrium temperature at albedo 0.3.
- Habitable-zone edges from Kopparapu et al. (2013), with "runaway greenhouse" as the inner edge and "maximum greenhouse" as the outer edge.

**Checked against the Sun–Earth case (tests):**
- 1361 W m⁻²
- a 365.25-day year
- a habitable zone of 0.95–1.68 AU
- an equilibrium temperature of about 255 K
- the inverse-square law

**Climate is not coupled.** The glacial-0.8 climate assumes 1361 W m⁻². Every other configuration therefore says "Not coupled … recomputing the climate needs a new, validated model version". The star's colour and brightness tint the natural-view sunlight only.

**Compatibility.** Existing worlds stay compatible: the default star is G2V at 1 AU.

## PF-25 Eclipse Hunter

**The moon.** A seeded moon (radius, distance, inclination, node, phase), with its period from Kepler's law. Its orbit is circular with a fixed node: there is no nodal precession or perturbation, and the panel says so.

**Prediction.** The predictor scans every new and full moon over three simulated years. It refines the closest approach and classifies each event from the shadow-cone geometry built from the star, moon and planet radii:
- total, annular or partial solar eclipses;
- total, partial or penumbral lunar eclipses.

**Where and when.** The solar shadow centre is converted to latitude and longitude on the planet. Times are simulation days, never the wall clock.

**Go.** "Go" points the natural-view sun to the subsolar point at that moment, flies to the shadow and highlights the umbra cells.

**Objective.** Observe a total or annular solar eclipse from a place inside the shadow; the observation is recorded as a discovery.

**Tests:**
- the timetable is reproducible;
- every predicted time really is an eclipse;
- solar and lunar eclipses both occur;
- the north pole maps to latitude 90°;
- one sidereal day returns the same longitude.

## PF-26 Orbit Architect

**Fleet.** Up to six satellites in circular Keplerian orbits around a planet with Earth's mass and radius. Each has a class with its own minimum elevation:
- imaging: 60°
- survey: 30°
- weather: 10°

**Constraints:**
- Altitudes outside 160–37,800 km are rejected.
- Manoeuvres cost a Hohmann transfer plus a plane change. Each satellite has a 2 km/s budget, and a manoeuvre that exceeds it is rejected with the amount required.

**Coverage.** Footprint radius λ = acos(R cos ε / (R + h)) − ε. Coverage is simulated over 24 h at 2-minute steps on every 7th cell (≈ 14,300 cells), counting settlement passes at least 30 minutes apart.

**Missions:**
- polar caps ≥ 80 %
- every settlement overflown at least twice
- land ≥ 60 %

Met missions are recorded as flags.

**On the globe.** Satellites and their orbit paths are drawn in the planet's frame, at 2 simulated minutes per second; they are frozen under reduced motion.

**Tests:**
- ISS-like period 92.8 min;
- geostationary period 1,436 min;
- 7.91 km/s at the surface;
- LEO→GEO about 3.9 km/s;
- a 98° orbit reaches about 82° latitude;
- a polar orbit sees the caps and an equatorial one never does;
- over-budget manoeuvres are rejected.

## PF-04 Constellation Cartography

**Picking.** In this mode, a tap that misses the planet picks the nearest star brighter than magnitude 4.5 within 1.2°. A tap on the planet still selects a place, never a star.

**Drawing.** Lines connect successive picks. Self-lines, duplicate lines, faint stars and more than 40 lines are rejected. The draft has its own undo, and saved constellations are covered by the journal's undo/redo.

**Saving.** A constellation is named, saved and listed in the journal, and drawn over the sky by catalogue id. Every pickable star is drawn on every quality tier (tested), so a pattern is identical on all tiers and after reload.

**Disclaimer.** These are the player's own figures, not real astronomical constellations.

## Evidence

- `npm test`: celestial suite 6/6.
- Browser smoke, desktop:
  - Stellar Foundry: not-coupled statement, and a match at G2V 1 AU;
  - Eclipse Hunter: timetable, jump and observation;
  - Orbit Architect: launch, rejection of an unsafe orbit, 24 h coverage, satellites on the globe;
  - Constellation Cartography: three real sky stars picked by screen position, then a named constellation saved.
