# Operational state

- Project: westkitty/Planet-Forge
- Baseline: prototype-0.1, seeded conceptual Three.js globe with 5 layers, click inspection, settlements, chronicle, JSON export.
- Verification: source-level tests included; remote CI and browser runtime remain **UNVERIFIED** until observed.
- Not implemented: actual 100k-cell topology, physical tectonics, moisture advection, river network, erosion, Köppen classifier, 2,000-year dynamical civilization history, atlas map projections, screenshot/video capture, continuous AI executor.
- Publishing: workflow source present; Pages repository configuration and successful deployment not yet proven.
- Protected: deterministic world state given identical seed and version; no cloud runtime API dependency; never publish failing build.
- Next: check Actions deployment and enable Settings > Pages > Build and deployment > Source: GitHub Actions if necessary, then implement scientific simulation in measured slices.

## 2026-10-31 — Phase 1 bootstrap verification (append-only log entry)

Verified locally on the agent box (Node 24.22.1 / npm 11.19.1; CI uses Node 22), starting from main at d8d3cd7:

- Install: `npm install` succeeded; `package-lock.json` added so CI now uses `npm ci`. Prod dependency `three` 0.180.0 (MIT); dev deps `vite` 7.1.12 (MIT), `playwright-core` 1.64.1 (Apache-2.0); all transitive licences MIT/ISC/BSD-3-Clause/Apache-2.0. `npm audit --omit=dev`: 0 vulnerabilities.
- Tests: 7/7 pass (`npm test`). New `tests/determinism.test.js` covers 20 fixed seeds (DET-00..DET-19): repeat-generation hashes identical, 20 distinct hashes, per-cell bounds (elevation, temperature, rainfall, plate, biome set, ocean iff elevation < 0), land fraction bounds, settlement and chronicle invariants.
- `npm run seed-report`: 20/20 reproducible, 20 distinct; 5° grid = 2,520 sampled cells; land fraction 0.479–0.556 (mean 0.531); 8 settlements on every seed; ~1–6 ms per seed. The globe colour pass samples 18,721 vertices (SphereGeometry 192×96), ~7 ms in Node.
- Build: `npm run build` OK, base `/Planet-Forge/`.
- Browser: new `scripts/smoke.mjs` (Playwright-core + headless Chrome, SwiftShader WebGL) against `vite preview`, at 1280×800 and 390×844: 50/50 checks pass (non-blank globe, seed entry, same seed → identical image, drag rotation, wheel zoom, 5 layers, click inspection, settlements, chronicle, JSON export, no horizontal overflow, control names, keyboard reach, zero console/network errors).
- Fixed: missing favicon caused a console 404; layer change / re-forge reset globe orientation; globe had no keyboard access (now focusable: arrows rotate, +/- zoom, Enter inspects centre); button text contrast 4.24:1 (hover 2.99:1) raised to 5.75:1 / 7.58:1; inspection output is now `aria-live`.
- CI: workflow now runs `npm ci`, tests, build and the browser smoke test before uploading the Pages artifact; smoke screenshots uploaded as a workflow artifact.
- Pages: API reports `build_type: workflow` (source = GitHub Actions), public, HTTPS enforced. Main has no branch protection or rulesets.
- Still true: the world model is the conceptual prototype (trigonometric fields, no cell topology, no physical tectonics/climate/hydrology). ~100k-cell simulation not started. No hourly executor is configured from this repository.

## 2026-10-31 — Deployment verification for 01443bd (append-only log entry)

- Pushed 01443bd to main (direct push; no branch protection). Actions run 41182721976: verify job success (tests, build, browser smoke 50/50 in CI), deploy job success.
- Live https://westkitty.github.io/Planet-Forge/ serves `assets/index-CJqsHH8m.js` and `assets/index-8cH-Nk_m.css`, identical to the local build of 01443bd.
- `scripts/smoke.mjs` against the live URL from the agent box: 50/50 checks pass at 1280×800 and 390×844, zero console errors.
- Baseline status: functional prototype verified and deployed. Scientific simulation and hourly autonomous development not yet started.

## 2026-10-31 05:09 ET — cycle 1: F-0002 tectonic-0.2 (append-only log entry)

- Branch `feat/tectonic-plates` from fd50365. Local: tests 13/13, seed report 20/20 reproducible/distinct at 100,002 cells (165–286 ms/seed Node), smoke 58/58 against vite preview.
- Deployment status for this feature is recorded in the next entry.

## 2026-10-31 — Deployment verification for 415370a, F-0002 COMPLETE (append-only log entry)

- 415370a fast-forwarded onto main (no branch protection) and pushed. Actions run 41188679630: verify success (tests, build, smoke in CI), deploy success.
- Live https://westkitty.github.io/Planet-Forge/ serves `assets/index-DXspMwPW.js` and `assets/index-8cH-Nk_m.css`, identical to the local build of 415370a.
- `scripts/smoke.mjs` against the live URL: 58/58 at 1280×800 and 390×844, zero console errors; live page reports model tectonic-0.2 with 100,002 cells.
- F-0002 status: COMPLETE. Next candidates: hydrology (priority-flood + drainage) or moisture advection with rain shadow, now that real mountains exist.

## 2026-10-31 05:40–06:35 ET — cycle 2: F-0003 climate-0.3, COMPLETE (append-only log entry)

- Branch `feat/climate-circulation` from c5318b2; commit 805e02f fast-forwarded onto main. Local: tests 21/21, seed report 20/20 reproducible/distinct (497–703 ms/seed in Node, up from 165–286 ms), smoke 70/70 against vite preview.
- Actions run 41191529995 on 805e02f: verify success (tests, build, smoke in CI), deploy success.
- Live https://westkitty.github.io/Planet-Forge/ serves `assets/index-pAz8WxCs.js` and `assets/index-DHmw5VkL.css`, identical to the local build of 805e02f. `scripts/smoke.mjs` against the live URL: 70/70 at 1280×800 and 390×844, zero console errors.
- Approval test (user started this cycle early to test the updated Allow rule): `git commit` ran without a card, but every `git push` (feature branch, main) was still blocked by Auto-review ("requires asking first before making content publicly accessible") and needed a manual approval card. Unattended cycles will still stall at push.
- Repo-local git identity set to westkitty <todeamende@protonmail.com> (matches earlier commits) because the box has no global identity.
- Next candidates: hydrology (priority-flood drainage, rivers, lakes) using the new rainfall; stream-power erosion; wind-driven ocean currents.

## 2026-10-31 06:40–06:55 ET — cycle 3: F-0004 hydro-0.4, COMPLETE (append-only log entry)

- Started manually by the user. Branch `feat/hydrology` from be10593; commit 5d8ddae fast-forwarded onto main. Local: tests 28/28, seed report 20/20 reproducible/distinct (637–814 ms/seed in Node), smoke 78/78 against vite preview.
- Actions run 41194299227 on 5d8ddae: verify success (tests, build, smoke in CI), deploy success.
- Live https://westkitty.github.io/Planet-Forge/ serves `assets/index-bxPqxFiN.js` and `assets/index-DHmw5VkL.css`, byte-identical (sha256) to the local build of 5d8ddae. `scripts/smoke.mjs` against the live URL: 78/78 at 1280×800 and 390×844, zero console errors.
- Approval test after the user's ask-first rule change: still blocked. `git push origin feat/hydrology` ("…a personal Auto-review block rule requires approval for repository updates that do not match the standard push exception criteria"), local `git merge --ff-only feat/hydrology` on main ("Merge the hydrology feature branch into the main branch, as required by your security rules for repository merges") and `git push origin main` ("…This requires your approval per your Auto-run rules") each needed a manual approval card. `git commit` and `gh` read calls did not. Unattended cycles will still stall at merge and push.
- Next candidates: stream-power erosion using the new discharge; glaciation from orbital forcing; wind-driven ocean gyres; recalibrating the arid bias.
