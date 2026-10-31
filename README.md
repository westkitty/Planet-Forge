# Planet Forge

A seeded procedural planet viewer and living atlas. This repository is being bootstrapped in small verifiable stages; the planet is a 100,002-cell geodesic mesh with seeded rigid-plate tectonics, a conceptual seasonal climate and a conceptual water balance with rivers, lakes, salt lakes and drainage basins (model `hydro-0.4`; see `docs/features/`); erosion and history are not yet implemented.

## Run locally

```sh
npm ci
npm run dev
```

`npm run build` creates the GitHub Pages bundle. `npm test` checks reproducibility and basic geographic invariants across 20 fixed seeds. `npm run seed-report` prints per-seed hashes, distributions and timings. `npm run smoke -- <url> [outDir]` drives the app in headless Chrome (set `CHROME_PATH` if Chrome is not in a standard location); CI runs it against `vite preview` before every deploy. All runtime dependencies are bundled into the built static site.

## Architecture

- `src/planet.js` deterministic tectonic world model (geodesic mesh, plates, boundaries, relief, climate proxies)
- `src/world.js` original prototype-0.1 model (kept for reference; PRNG and seed hash reused)
- `docs/features/` feature records with assumptions, limitations and sources
- `DEVELOPMENT_LOG.md` append-only cycle log
- `src/main.js` Three.js globe, controls and data inspection
- `src/presentation.js` lighting, atmosphere, clouds, terrain relief; `src/starfield.js` deterministic galactic starfield (PF-01)
- `scripts/perf.mjs` matched WebGL frame/resource probe
- `src/style.css` responsive presentation
- `.github/workflows/deploy.yml` Pages CI/CD (activate Pages > GitHub Actions in repository Settings)
- `OPERATIONAL_STATE.md` verified vs unverified implementation state

Hosted site (once enabled and successfully deployed): https://westkitty.github.io/Planet-Forge/

## Status

Baseline prototype, not the full Planet Forge scientific simulation. Automated hourly feature creation requires a separate authorized coding-agent runtime and scheduler; the Pages workflow only builds and deploys tested commits.

## License

MIT; Three.js MIT license; Vite MIT license. Scientific classifications are qualitative approximations pending citation-backed model development.
