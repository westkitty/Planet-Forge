# Milestone 2 — Observatory (PF-09, PF-10, PF-11, PF-12, PF-13, PF-27, PF-30, PF-31)

Status: IMPLEMENTED and TESTED locally on top of main dbf3c2a. Merge, deploy and live state: see `docs/implementation/PF_MASTER_PROGRESS.md`.

## Shared foundations

**Scope:** World model `glacial-0.8` and the atlas export are unchanged. Every observatory module is read-only over the world arrays, and a unit test fingerprints the world before and after running all of them.

**Layout:** The persistent console stays at 14.5 % of the viewport. All new tools live in the Observatory drawer, which:
- is opened deliberately from the console;
- closes with × or Escape;
- has keyboard-navigable tabs;
- overlays the viewer rather than resizing it.

**`src/geo.js`** provides:
- nearest-cell lookup by greedy walk over the mesh adjacency (equal to brute force on 200 random directions);
- great-circle sampling;
- multi-source ring distances;
- analytic ray–sphere surface picking that respects displayed relief.

## Per package

**PF-10 Selection.**
- Clicks, taps, Enter and hover all use the analytic pick. No more triangle raycasts, so hover is cheap, and clouds, markers and overlays can never steal a pick.
- On-screen markers:
  - a gold reticle marks the selected cell, and a dimmer ring marks the hovered cell (mouse only);
  - an HTML label shows the biome or settlement name and the elevation.
- There is exactly one reticle. A new world clears the selection and all overlays.
- Drag and pinch never select (existing tap rules).
- Smoke check: clicking the projected screen position of five selected cells re-selects the same cell or a direct neighbour.

**PF-11 Effects** (`src/overlays.js`).
- A pool of 12 additive ring meshes with a 1.8 s lifetime; when all 12 are busy, the oldest is reused.
- Effects are fired only by real store actions that carry a cell: discoveries, bookmarks and recorded investigations.
- Under reduced motion the rings fade without expanding.
- No effect outlives its lifetime.

**PF-12 Why Engine** (`src/why.js`).
- Five questions: terrain, wet or dry, water flow, settlement, ice.
- Every answer lists computed facts (values read from the arrays), model-based inference (the documented rules of F-0002…F-0007 and the settlement generator) and causes that are not modelled.
- Deterministic and offline: no AI or network service.

**PF-13 Saves** (`src/gameState.js`).
- Gameplay state lives in a reducer store, separate from the world: discoveries, bookmarks, journal, constellations, decisions, scenario, flags and an event log.
- Undo and redo go up to 200 steps.
- A save holds the world identity (seed, tilt, model version), the view (rotation, zoom, selected cell) and the gameplay state. The world itself is regenerated, never stored.
- Save options: in this browser (localStorage), or export/import as a JSON file.
- `parseSave` uses only `JSON.parse` plus explicit checks. It refuses:
  - files over 2 MB;
  - newer save versions;
  - saves from other world-model versions (the game cannot reproduce them);
  - malformed fields;
  - non-plain objects and `__proto__`/`constructor` keys.
- The atlas JSON export is untouched.

**PF-09 Tours** (`src/observatory.js`).
- Routes are picked deterministically from the world's data:
  - highlights;
  - the five highest summits at least 12° apart;
  - the three greatest rivers, source then mouth;
  - convergent and divergent boundaries;
  - both polar regions;
  - settlements in founding order.
- The globe eases to each stop (`facingRotation`, verified by unit test) and holds for 4.5 s, with a caption that is ready for narration.
- Any pointer, wheel or key input stops a tour immediately. Under reduced motion, tours cut between stops instead of animating.
- Bookmarks store the view in the save.

**PF-27 Transect** (`src/analysis.js`).
- Pick a start and an end. The great circle is sampled every half cell spacing (≈ 37 km) and each sample snaps to its nearest cell; duplicates are dropped, so every row is a real cell.
- Each row includes elevation, ocean depth, temperature, rainfall, river discharge (≥ the atlas river threshold) and glacial ice thickness when the glacial state has been computed.
- The drawer shows an SVG profile with river-crossing marks, and the path is drawn on the globe. Export as CSV or JSON.
- Limitations of resolution and ice data are stated in the panel.

**PF-31 Correlation Observatory.** Five curated queries with editable thresholds:
- rivers near plate boundaries;
- dry land near high terrain;
- settlements near convergent boundaries;
- biome edges against rainfall gradients;
- extreme seasonal ranges inland.

Each result reports:
- the population, the subset where condition B holds, the matches, both shares and the lift;
- the top 10 matches, each with a fly-to button;
- match highlights on the globe.

All queries are O(n) passes or breadth-first searches; ATLAS-001 queries run in tens of ms. Every result carries a "correlation ≠ causation" statement.

**PF-30 The scientific method.** Five investigation protocols:
- rain shadows;
- lapse rate;
- continentality;
- river vs local rain (often comes out rejected);
- seafloor age vs depth.

Each protocol has a question, H1 and H0, two site groups with stated eligibility rules checked against the arrays, three sites per group, and a stated decision rule.
- Values are measured from the world, so players cannot type them.
- The verdict can reject H1.
- The player's conclusion is graded against the evidence and written to the journal with every observation.

## Evidence

**Tests:** `npm test` 70/70. New: `tests/observatory.test.js` (7) and `tests/gameState.test.js` (2).

**Browser smoke:** 140/140 at 1280×800 and 390×844. The new checks cover:
- hover marker;
- five-point pick accuracy;
- single reticle with label;
- drawer open/close within the console budget;
- Why answers;
- discovery event and pooled effect;
- transect profile, path and CSV export;
- correlation lift and highlights;
- investigation rule enforcement and verdict;
- tour stops and interruption;
- bookmarks;
- local save, load, undo, redo, file export/import, and refusal of a future-version save;
- a new world clearing the selection and overlays.

**Repairs made during verification:**
- the day clock was slowed by the 50 ms frame cap and now uses real elapsed time;
- Escape now closes the drawer from anywhere;
- the smoke test restores the view after the tour.

**Performance** (SwiftShader, relative only): idle desktop median frame 233.3 ms, the same as Milestone 1 high. The drawer and analysis do no per-frame work. Live GL objects are 26 / 6 / 6 with no leaks.

## Known limitations

- Investigations use three sites per group; the verdict is a small-sample comparison and is labelled as such.
- There are no free-form or AI explanations: the Why Engine only knows the rules it was given.
- Tours rotate the globe toward the fixed camera; the camera itself does not orbit.
- Hover picking is mouse-only (touch has no hover).
