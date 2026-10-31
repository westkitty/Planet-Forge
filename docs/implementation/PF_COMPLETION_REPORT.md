# Planet Forge — PF-01 through PF-33 Release and Completion Evidence

**Evidence cutoff:** 2026-10-31, release candidate `4fb4cea4892ed36460a9b82661c1927ae2dd44b9` on `main`.
**Site:** https://westkitty.github.io/Planet-Forge/
**Verified release status:** all 33 PF first-implementation packages merged and deployed; **158/158 live-site browser checks passed** on run 41233978729 at the exact application revision `4fb4cea`. See the [progress ledger](PF_MASTER_PROGRESS.md). This is evidence of release and smoke-tested functionality, not a claim of full real-device or human-playtest quality.

## 1. Verified release identity

- Final milestone implementation: `be24949c70c86d5c5afe06a2af4b43d8d0572c41` in [PR #6](https://github.com/westkitty/Planet-Forge/pull/6).
- Final milestone merge: `4fb4cea4892ed36460a9b82661c1927ae2dd44b9` in `main`.
- Final release workflow: [Actions run 41233978729](https://github.com/westkitty/Planet-Forge/actions/runs/41233978729), with separate `verify`, `deploy`, and `live-verify` jobs.
- Prior milestone merge: `0821d721667a055565bf0a4d3887c3cb7b08f8e3` in [PR #5](https://github.com/westkitty/Planet-Forge/pull/5), verified and deployed by [run 41233105655](https://github.com/westkitty/Planet-Forge/actions/runs/41233105655).
- Earlier milestones: [PR #2](https://github.com/westkitty/Planet-Forge/pull/2), [#3](https://github.com/westkitty/Planet-Forge/pull/3) and [#4](https://github.com/westkitty/Planet-Forge/pull/4) passed their respective production verification paths.

All 33 named packages are represented in the source tree and merged history; a completed **implementation package** means a bounded, playable first implementation, not an unlimited or scientifically exact simulation.

## 2. Implemented and integrated feature groups

| Group | Package IDs | Implementation surface |
|---|---|---|
| Planetarium | PF-01–03, PF-05–08 | Deterministic star catalogue, galactic band, spectral stars, graphics tiers, day/night, oceans, climate-influenced clouds and settlement lighting |
| Observatory | PF-09–13, PF-27, PF-30–31 | Camera tours, accurate picking, effects, explanatory tools, saves, transects, investigations and scientific correlations |
| Playable planetary science | PF-14, PF-17–18, PF-22, PF-28–29 | Ice-age migration, mapping, disaster scenarios, trials, seasonal expeditions and watershed management |
| Living worlds | PF-15, PF-20–21, PF-23, PF-33 | River kingdoms, ecological succession, detective cases, recorded history and ruins |
| Celestial systems | PF-04, PF-24–26 | Player constellations, parent stars, eclipses and a bounded orbital satellite fleet |
| Deep exploration | PF-16, PF-19, PF-32 | Isolated planetary interventions, local-terrain rover and submersible missions |

Implementation details, game rules and their limitations: [M1](../features/M1-planetarium.md), [M2](../features/M2-observatory.md), [M3](../features/M3-playable-science.md), [M4](../features/M4-living-worlds.md), [M5](../features/M5-celestial.md) and [M6](../features/M6-exploration.md).

## 3. Release verification

**CI verified against the final merge SHA `4fb4cea`:**
- `npm test`: **95 tests passed, 0 failures**, per `verify` job logs.
- `npm run build`: passed; final JS asset is substantially larger than the historical initial build.
- `scripts/smoke.mjs` against Vite preview: **158/158 checks passed** at desktop and mobile viewports.
- GitHub Pages deployment: passed.
- Production JS/CSS served by the public site: byte-hash comparison with the CI build passed.
- Live-site browser smoke: **158/158 PASS**, directly verified from the completed `live-verify` job logs for run 41233978729 (released application SHA `4fb4cea`).

The browser suite covers actual Play-tab operation of every newly added mode in addition to seed determinism, scientific layers, touch input, export, layout, sky render and major world transitions. It is automated acceptance evidence, not independent human playtesting.

**Protected invariants:** a 100,002-cell scientific world, `glacial-0.8`, 12 atlas layers, reproducible seed behavior, JSON export, a single Three.js renderer, and an 85.5% viewer / 14.5% persistent controls layout. See tests and `OPERATIONAL_STATE.md` for specific proof scope.

## 4. Performance and resource integrity

The original feature execution reported the following matched **SwiftShader software-renderer** medians:

| Configuration | Desktop median frame interval | Difference vs original |
|---|---:|---:|
| Original planetary viewer | ~167 ms | baseline |
| Completed package set, high quality | ~233 ms | ~+40% |
| Completed package set, low quality | ~200 ms | ~+20% |

These final comparative values were supplied by the prior executor; the final comparison's raw measurements have **not** been located in the committed repository. Treat them as **reported**, not independently reproduced benchmarks. Existing committed intermediate measurements include `docs/features/PF-01/perf-*.json`, `docs/features/M1/perf-*.json` and `docs/features/M2/perf-high.json`.

Reported resource probes found no increase in live WebGL object counts across regeneration and quality-tier cycles. One mobile run's JS heap reportedly rose to ~107 MB after eight regenerations, while others stayed around 66–71 MB. **Cause unknown:** this is a reproducibility investigation, not proof of a memory leak or proof of no leak.

Real phone/browser GPU frame pacing, thermal stability, accessibility beyond existing automation, and long-session behavior are **not verified**. The single JS bundle is reported at roughly 715 kB and should be evaluated for optional code-splitting if it affects startup or mobile performance.

## 5. Scientific and gameplay scope limits

- Glacial retreat between computed present/glacial endpoints is an explicitly declared **gameplay interpolation**.
- Disaster frequencies, hypothetical populations, watershed seasonal-flow estimates and impact scaling are **gameplay models**, not validated predictive science.
- The Stellar Foundry calculates incident flux and habitable-zone metrics; changing the parent star does **not** alter `glacial-0.8` climate.
- Orbital models use simplified circular/Keplerian cases and a fixed planetary radius/mass convention.
- Local rover and submersible terrain is generated from coarse authoritative cell data plus clearly labelled procedural small-scale detail.
- Deep Time represents recorded civilization history and computed world states; continuous tectonic/erosion evolution is not simulated.
- God of Consequences allows only currently supported model interventions (e.g. tilt and computed glacial state), not speculative atmosphere/ocean terraforming.
- Several modes are short, deterministic single-session experiences. They have not been independently balance-tested through extensive human play.

These limits are disclosed in their feature files and should remain user-visible. A future simulation extension requires its own scientific model/version, validation, and compatibility contract.

## 6. Non-negotiable remaining product-quality evidence

The full PF roadmap was implemented as 33 **functional first-slice systems**. That is distinct from demonstrating that the entire project meets an unqualified AAA commercial quality bar. The following evidence remains outstanding and must not be silently promoted to complete:

1. Real-device performance on representative mobile and desktop GPU hardware, including sustained interaction and thermal behavior.
2. Reproduction or resolution of the reported 107 MB heap excursion.
3. Human gameplay/playability evaluation (clarity, challenge quality, failure loops and novelty), particularly for PF-15, PF-19, PF-23, PF-26 and PF-32.
4. Model-depth expansions not claimed as implemented, including true tectonic evolution and parent-star climate coupling.
5. Focused accessibility review beyond existing keyboard, focus, responsive-layout and reduced-motion smoke checks.

Treat these as explicit release-quality limitations, not as grounds to rewrite or discard the verified 33-system application.

## 7. Release closure and remaining quality work

Run 41233978729 completed **successfully** on `2026-10-31T19:38:12Z`: verify 95/95 unit and 158/158 preview, deploy success, public assets byte-identical to the CI build, and public browser smoke **158/158 PASS**. All 33 package rows are now `LIVE_VERIFIED` against their deployed milestone revisions. The original program is implemented as integrated first-slice experiences and public-site automated acceptance has passed.

**Outstanding independent quality evidence is tracked in [GitHub issue #8](https://github.com/westkitty/Planet-Forge/issues/8)**: real-device performance and thermals, reproduction of the reported mobile heap excursion, and human gameplay/accessibility review. This record does not upgrade unmeasured properties to verified.

A subsequent documentation-only merge may advance `main` without altering application JS/CSS; keep the tested application SHA and the documentation merge SHA distinguishable.

**Final distinction:** “33 packages merged and deployed” is a repository/release fact; “33 playable first implementations checked on the public site” requires a successful live browser job; “commercially polished, comprehensively playtested, scientifically coupled AAA simulation” is not established by these checks.

## 8. Follow-up QA pass (2026-10-31, after release closure)

This section updates sections 4 and 6 with new evidence. The earlier text is kept unchanged for the record.

- **Raw final performance measurements are now committed.** The files are `docs/implementation/perf-final-high.json` and `perf-final-low.json`. Both come from `scripts/perf.mjs`, run on headless SwiftShader against the final application tree. The numbers in section 4 come from these files. They are still software-renderer measurements, not real-GPU frame rates.
- **The 107 MB heap excursion does not reproduce once garbage collection is forced.** The new tool is `scripts/memprobe.mjs`. It runs at a 390×844 viewport on the medium tier and forces garbage collection twice before every reading. Results:
  - **Phase 1:** 24 cycles of world regeneration, layer switches and quality-tier switches. JS heap ranged from 38.5 to 40.8 MB with no upward trend. Live WebGL buffers, textures and programs stayed at exactly 28 / 6 / 7 the whole time.
  - **Phase 2:** 4 cycles of heavy modes: rover descent, driving and return; the intervention lab, which builds a second planet; River Kingdoms; and Deep Time. Heap was 41.1–41.2 MB. The first cycle added 4 buffers and 2 shader programs, which then stayed constant. These are three.js's one-time objects for the local-scene materials, reused afterwards, not a growing leak.
  - **Conclusion:** no leak was found in the exercised paths. The earlier 107 MB reading came from `scripts/perf.mjs`, which reads the heap without forcing garbage collection, so it most likely captured garbage that had not yet been collected. Real-device long-session behaviour is still unverified (issue #8).
- **Portrait framing fix.** On portrait screens (width/height < 0.75), the camera now fits the planet's edge to the screen width instead of keeping a 13 % margin. The globe's diameter on a 390 × 844 phone grows by about 13 %, and the whole planet remains visible. Landscape framing is unchanged. Before/after screenshots: `docs/implementation/portrait-before.jpg` and `portrait-after.jpg`.
- **Still open, and cannot be done from the agent environment:** real-device GPU and thermal measurements, and human playtesting of every mode. These remain tracked in issue #8.
