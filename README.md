# Planet Forge

An interactive planetary observatory and seeded world-simulation game. **The planet is the interface**: a Three.js globe occupies 85.5% of the ordinary viewport, with a compact 14.5% control strip. Scientific interpretation, exploration and playable planetary scenarios share one generated world without changing the underlying physical arrays.

**[Play Planet Forge](https://westkitty.github.io/Planet-Forge/)** · [Feature and model documentation](docs/features/) · [Release evidence](docs/implementation/PF_COMPLETION_REPORT.md) · [33-package status ledger](docs/implementation/PF_MASTER_PROGRESS.md)

## What's in the game

- **Scientific planet:** 100,002 geodesic cells; seeded plate tectonics, elevation and bathymetry; seasonal climate, water balance, rivers, basins, biomes, glacial maximum and land bridges. The current model is `glacial-0.8`.
- **Astronomical view:** deterministic star catalogue and galactic sky, stellar appearance, graphics tiers, moving sunlight, ocean shading, climate-informed clouds and settlement lights.
- **Observatory:** geographic picking and highlight, camera tours, transects, the Why Engine, a correlation observatory, evidence-based investigations, discoveries and versioned saves.
- **Planetary play:** The Great Thaw, River Kingdoms, exploration by survey probes, Faultline Command, Planet Trials, seasonal expeditions, watershed allocation, ecology, ruins, mysteries and historical timelines.
- **Celestial play:** configurable parent star and habitability calculations, eclipse observations, orbital satellites and player-authored constellations.
- **Deep exploration:** deterministic local terrain, rover excursions, undersea exploration and a separate reversible, scientifically bounded planetary intervention laboratory.

These modes are **functional first implementations**, not claims of full physical realism or unlimited sandbox depth. Many gameplay outcomes use explicitly disclosed abstractions. For example, Great Thaw uses an illustrative sea-level interpolation, and the parent star's radiation does not alter the climate model until a new scientific model version is validated. Local rover terrain uses labelled procedural detail derived from the coarse planetary mesh.

### Starting the game

Open the public site. Rotate and zoom the globe with pointer or touch, inspect locations and select scientific layers in the bottom strip. Open the **Observatory** drawer for analysis tools and the **Play** tab for missions. Close the drawer to restore the planet-first view. The entire game is statically bundled; no login or server-side simulation is required.

## Development

Requires Node.js and npm, with a browser that supports WebGL.

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run smoke -- http://localhost:4173/Planet-Forge/ smoke-artifacts
```

For the smoke command, start `npm run preview -- --port 4173` in another session and set `CHROME_PATH` when Chrome/Chromium is not discoverable. The suite uses Playwright Core and covers desktop and mobile viewports.

CI:
- `.github/workflows/pr-verify.yml` tests pull requests without deploying them.
- `.github/workflows/deploy.yml` tests and builds `main`, deploys to GitHub Pages, verifies the public JS/CSS against the build by hash, then executes browser smoke against the **live URL**.
- `scripts/perf.mjs` provides a matched software-renderer frame/resource probe. Its results must not be described as real-device GPU benchmarks.

## Engineering structure

| Area | Main code |
|---|---|
| Scientific model | `src/planet.js`, `src/climate.js`, `src/hydrology.js`, `src/glaciation.js` |
| Three.js globe | `src/main.js`, `src/presentation.js`, `src/starfield.js`, `src/quality.js` |
| Scientific tools | `src/observatory.js`, `src/observatoryUI.js`, `src/analysis.js`, `src/why.js` |
| Gameplay and persistence | `src/gameState.js`, `src/gameplay/`, `src/playUI.js`, `src/playHistory.js` |
| Celestial systems | `src/celestial.js`, `src/playCelestial.js`, `src/constellations.js` |
| Local expeditions | `src/localScene.js`, `src/localTerrain.js`, `src/playExplore.js` |

The scientific world is authoritative; game state and cosmetic rendering are separate. The globe and local expeditions share one renderer and frame-loop owner. World seeds and game actions are deterministic where documented.

## Verification and limitations

Consult [the completion report](docs/implementation/PF_COMPLETION_REPORT.md) for exact CI revisions and measured outcomes. Key unresolved release-quality questions include real-device frame pacing and thermals, long-session/mobile heap behavior, and independent human playtesting of the larger modes. Historical screenshots and source presence do not prove these properties.

## License

MIT. Three.js and Vite are MIT-licensed. Adapted techniques from sibling projects are documented in feature provenance notes. Scientific and gameplay abstractions are identified in the relevant mode descriptions.
