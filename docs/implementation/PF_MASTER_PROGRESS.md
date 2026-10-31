# Planet Forge — PF master progress ledger

States: NOT_STARTED · IN_PROGRESS · IMPLEMENTED · TESTED · MERGED · DEPLOYED · LIVE_VERIFIED · BLOCKED.
LIVE_VERIFIED only after the deployed build was exercised in a real browser. Reconcile against git/GitHub on every start; git evidence wins over this table.

| PF | Feature | Owner layer | Depends on | State | Branch | Commit | PR | Merge | Deploy run | Evidence / open problems |
|---|---|---|---|---|---|---|---|---|---|---|
| PF-01 | Definitive galactic starfield | Presentation | — | DEPLOYED | claude/determined-mayer-wvolun | b7093cf | [#2](https://github.com/westkitty/Planet-Forge/pull/2) | 5ca234b | 41222630943 ✓ | PR CI 41222008846 ✓ (tests, build, smoke 102). Live browser check not possible from the agent container (westkitty.github.io blocked by its network policy); post-deploy live-verify job added in M1 |
| PF-02 | Spectral stellar identity | Presentation | PF-01 | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-03 | Adaptive graphics quality | Presentation | PF-01 | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-04 | Constellation cartography | Celestial/Observatory | PF-01, PF-02, PF-10, PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-05 | Dynamic solar illumination | Presentation | — | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-06 | Living oceans | Presentation | PF-03, PF-05 | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-07 | Climate-informed clouds | Presentation | PF-03 | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-08 | Settlement illumination | Presentation | PF-05 | MERGED | claude/determined-mayer-wvolun | b4dee86 | [#3](https://github.com/westkitty/Planet-Forge/pull/3) | dbf3c2a | (pending) | tests 61/61, smoke 119/119; docs/features/M1-planetarium.md |
| PF-09 | Cinematic planetary expeditions | Presentation/Observatory | PF-10 | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-10 | Intelligent geographic selection | Observatory | — | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-11 | Planetary event effects | Presentation | — | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-12 | The Why Engine | Observatory | PF-10 | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-13 | Saved worlds and experiments | Gameplay | — | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-14 | The Great Thaw | Gameplay | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-15 | River Kingdoms | Gameplay | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-16 | God of Consequences | Gameplay/Science | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-17 | The Cartographer's Oath | Gameplay | PF-10, PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-18 | Faultline Command | Gameplay | PF-13, PF-11 | NOT_STARTED | — | — | — | — | — | — |
| PF-19 | First Footfall | Exploration | PF-10 | NOT_STARTED | — | — | — | — | — | — |
| PF-20 | Life Finds a Way | Gameplay | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-21 | The Silent Planet | Gameplay | PF-15, PF-33 | NOT_STARTED | — | — | — | — | — | — |
| PF-22 | The Planet Trials | Gameplay | PF-10, PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-23 | Deep Time | Gameplay | PF-13, PF-15 | NOT_STARTED | — | — | — | — | — | — |
| PF-24 | Stellar Foundry | Celestial | — | NOT_STARTED | — | — | — | — | — | — |
| PF-25 | Eclipse Hunter | Celestial | PF-24 | NOT_STARTED | — | — | — | — | — | — |
| PF-26 | Orbit Architect | Celestial | PF-24 | NOT_STARTED | — | — | — | — | — | — |
| PF-27 | Planetary transect | Observatory | PF-10 | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-28 | Seasons as strategy | Gameplay | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-29 | The Watershed Council | Gameplay | PF-13 | NOT_STARTED | — | — | — | — | — | — |
| PF-30 | The scientific method | Observatory | PF-10, PF-27 | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-31 | Correlation observatory | Observatory | PF-10 | TESTED | claude/determined-mayer-wvolun | (M2) | — | — | — | tests 70/70, smoke 140/140; docs/features/M2-observatory.md |
| PF-32 | Abyssal Frontier | Exploration | PF-10 | NOT_STARTED | — | — | — | — | — | — |
| PF-33 | The World Remembers | Gameplay | PF-15 | NOT_STARTED | — | — | — | — | — | — |

## Restart instruction

1. `git fetch origin main` and read this ledger, OPERATIONAL_STATE.md and the tail of DEVELOPMENT_LOG.md.
2. Reconcile each row with `git log origin/main` and the PR list.
3. Continue with the first row that is not LIVE_VERIFIED, in the milestone order of the roadmap.
