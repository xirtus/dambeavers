# Phase 11 — Systems DF Doesn't Have — Handoff Report

**Status: DONE — all 20 tasks, critic pass run, gate composed and green.**

Per the roadmap's own gate sentence: *"Damn Beavers is no longer defined by whether it matches Dwarf Fortress. It has become its own deep simulation platform centered on hydrology, ecology, engineering, social memory, and causal history. Playable state: the intended final game."*

## What landed (per batch, as committed)

1. **Hydrology/fluids/ecology** (`014efcf`) — P11-01 watershed engineering (seepage/bank saturation, pond chains, channel migration, closed-form deep-time spans with inflow/outflow), P11-02 habitat mosaics (multi-species knock-on effects from one dam), P11-03 fluid composition (component vocabulary, column-derived fills), P11-04 metabolism/intoxication (blood chemistry wired into craft work-rate/quality and battle force — no drunk event anywhere), P11-05 dynamic river morphology (the channel genuinely migrates into the saturated bank and breaks a water wheel).
2. **Knowledge/culture** (`96f7c33`) — P11-06 knowledge ledger with four real acquisition routes, P11-07 rumor distortion (believed versions never touching the EventLog), P11-08 cultural evolution (generational norm/belief drift), P11-09 technological knowledge gating craft execution, P11-10 per-household invention, P11-11 infrastructure memory (ruins repaired or mythologized across a deactivation-gap-reactivation cycle).
3. **Explanation/replay/scale** (`efd6223`) — P11-12 grounded NL explanation with a structural no-fabrication proof, P11-13 counterfactual replay (fork/alter/diff over P0-08 snapshots), P11-14 multi-scale continuity (the detailed world persists with the same entities; extinction ends continuity but keeps the physical record).
4. **Senses** (`9096d46`) — P11-15 environmental acoustics (distance/obstruction/environment, real stress consequences), P11-16 scent/chemical traces (transported decaying field with gradient-following predation).
5. **Engineering/landscape/archaeology/benchmark** (`a3fcc07`) — P11-17 design knowledge (blueprints from real builds, copyable/modifiable/forgettable), P11-18 cultural landscape (queryable signatures), P11-19 archaeology (partial reconstruction with honest gaps), P11-20 the 14-family x 7-seed emergence benchmark suite.
6. **Parity matrix + gate** (`8c4ced5`) — 26 P11-referencing parity rows resolved (20 flipped with real evidence, 6 honestly re-marked where the P11 task did not cover the full DF row), `tests/gate/p11-gate-final.test.ts`.

## Critic pass

Four findings, each reproduced before fixing, each regression-covered in `tests/simulation/p11-critic-regressions.test.ts`:

1. `advanceWatershedSpan` queued `spanTicks` events per probability-1 pair (a million-entry array for one column pair) — capped at `MAX_EVENTS_PER_PAIR` (32).
2. The closed-form seepage advance solved a different equation (max over wet neighbors) than the per-tick saturating sum — aligned; the regression proves both paths settle at the same saturation.
3. The P11-01 settlement-access assertion was vacuous (masked by an always-true OR clause) — now the change itself (verified: 36 -> unreachable).
4. `attemptInvention` threw on unknown candidate recipe ids — now filtered.

## Final state

- 183 / 183 tasks DONE (all of Phases 0-11)
- Fast suite: 1534 tests across 256 files, green
- Gate suite: 9 composed gates (p2 soak, p3-p11), green
- `npm run typecheck` clean
- BUILD_MANUAL.md/.html, TASKS.md synced
