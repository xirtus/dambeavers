# Damn Beavers — Build Manual & Roadmap Ledger

> A systemic beaver-civilization simulator built on one rule above all others: **systems, not scripted outcomes.** Every mechanic — water, wood, hunger, causality — is a real, inspectable simulation, never a hard-coded story beat.

Saved locally from the published artifact manual (`https://claude.ai/code/artifact/ca9956e5-9729-4af2-9aef-b5983caec800`) so the build state has a git-tracked copy. Regenerate/update this file as tasks close rather than relying on the hosted artifact.

**Status as of 2026-08-15** — Current task: P1-05 (Beaver creature model) — TODO, unblocked — 418 tests passing

- **Phase 0 — Engine Foundation:** 12/12 done — gate PASSED 2026-08-13
- **Phase 1 — One Watershed:** 4/22 done (18%)
- **Milestone 0 — Pond Test:** NOT PASSED — blocked on P1-05 through P1-22

## Overview stats

| Metric | Value |
|---|---|
| Tasks done | 16 / 35 |
| Tests passing | 418 |
| Test files | 34 |
| Lines of sim code | 4,457+ |
| Lines of test code | 6,027+ |
| Tasks with a critic-found defect | 16 / 16 |

## §01 — Where the build stands

Phase 0 laid the engine foundation — clock, identity, components, persistence, debug tooling — and is fully closed out. Phase 1 is building the first watershed: terrain, water, flow, and navigation are done; beavers, needs, and jobs are next.

Test-suite growth (cumulative, by completion order): 31 → 418 across 16 completed tasks.

| Task | Cumulative tests |
|---|---|
| P0-01 | 31 |
| P0-02 | 53 |
| P0-03 | 77 |
| P0-04 | 112 |
| P0-05 | 142 |
| P0-07 | 166 |
| P0-09 | 188 |
| P0-06 | 215 |
| P0-08 | 244 |
| P0-10 | 272 |
| P0-11 | 298 |
| P0-12 | 317 |
| P1-01 | 335 |
| P1-02 | 365 |
| P1-03 | 388 |
| P1-04 | 418 |

## §02 — The quality process

No task is marked done on the strength of "it compiles." Every feature goes through the same five-step cycle before its ledger row closes:

1. **Implement** — the smallest correct mechanism for exactly this task, never a future phase's system built early.
2. **Unit + acceptance tests** — unit tests for the mechanism, plus a headless test matching the roadmap's literal acceptance wording.
3. **Independent critic review** — a fresh reviewer with no context tries to break it: correctness, determinism, persistence, generality.
4. **Fix + regression-test findings** — substantive findings get fixed, with a new test that fails on the old code and passes on the fix.
5. **Ledger entry with evidence** — TASKS.md is updated with test counts and a full account of what the critic found.

**16/16** completed tasks have had at least one substantive, independently-verified finding fixed before closing — including two severe bugs (water-volume delivery off by 3.5×, and an undamped flow oscillation) that required rewriting the algorithm, not just patching a check.

Severity legend: **Critical** = real correctness bug, wrong results with no error · **Moderate** = real defect, contained blast radius · **Minor** = observability, docs, or test-coverage gap.

## §03 — The ten non-negotiable laws

From `AGENTS.md` — the constitution every task is built and reviewed against.

1. **Systems, not scripted outcomes.** Never a named story event like `DamFloodEvent`. Implement the underlying cause — water + pressure + flow + obstruction + permeability — and let the outcome emerge.
2. **The simulation is authoritative.** Renderer, UI, and audio only observe state; they never own it. A mesh is not a tree. The simulation must keep making sense running fully headless.
3. **Stable persistent identity.** Every important entity gets a permanent ID that survives save/load — never render-object identity, never array position.
4. **Causality must be inspectable.** Every important state change can answer: what happened, why, what caused it, what blocked it, who participated, where and when.
5. **Jobs are intentions, not puppeteering.** Designation → work → job → eligibility → agent choice → reservation → navigation → execution → completion. Never teleport an agent or item to satisfy an order.
6. **Physical resources are physical.** Three logs means three log entities that exist, get carried, and get delivered — never an invisible integer counter.
7. **Hydrology changes navigation through reality.** A flooded route becomes impassable because depth, locomotion, slope, and current actually change cost — never `if damBuilt: blockLowRoad()`.
8. **Determinism where practical.** Same version, seed, save, and command stream reproduces the same state. Authoritative nondeterminism is a bug, not a feature.
9. **Persistence is part of every system.** Never bolted on at the end. Every new persistent state considers serialization, versioning, and migration on day one.
10. **Do not implement future phases early.** Implementation order comes strictly from `TASKS.md`. A later feature may inform an interface — it never gets built ahead of its dependencies.

## §04 — Dependency map

The critical path from engine foundation to the Pond Test (condensed — the full 35-task dependency graph lives in `TASKS.md`):

```
Phase 0 (12 tasks, done)
  -> P1-01 Watershed Generator (done)
  -> P1-02 Water Volume (done)
  -> P1-03 Flow & Obstruction (done)
  -> P1-04 Navigation (done)
  -> P1-05 Beaver Creature Model (todo, unblocked)
  -> P1-06 Needs (blocked)
  -> P1-07 Jobs (blocked)
  -> P1-08 Tree Cutting (blocked) --\
  -> P1-09 Hauling (blocked) -------> P1-10 Construction (blocked)
  P1-10 -> P1-11 Dam & Hydraulics (blocked) [also needs P1-03]
  P1-11 -> P1-12 Accessibility (blocked) [also needs P1-04]
  P1-06 -> P1-13...20 Survival, Ecology, Weather, Relationships, UI (8 tasks, blocked)
  P1-12 + P1-13..20 -> M0 — Pond Test
```

## §05 — Task ledger

Every task, its status, dependencies, and a condensed account of what shipped and what the critic found. Full evidence paragraphs live in `TASKS.md`.

### Phase 0 — Engine Foundation (12/12 done)

| ID | Task | Status | Deps | Severity | Notes |
|---|---|---|---|---|---|
| P0-01 | Simulation clock | Done | — | Critical | Fixed-timestep authoritative clock, exact bigint-nanosecond accumulator, scheduler, pause/speed. Critic found a real frame-rate-dependence bug: naive per-call rounding made 1/30s and 1/60s land on different ticks for identical elapsed time — fixed with error-diffused rounding. |
| P0-02 | Stable entity identity | Done | P0-01 | Critical | Branded-number IDs, never reused, liveness tracking. Critic found a NaN/Infinity collision-guard bypass in snapshot restore that could let every future entity collide — fixed with integer validation. |
| P0-03 | Universal component/state model | Done | P0-02 | Minor | Data-oriented column-per-type storage, generic AND-query, auto-cleanup on entity destroy. Critic found real observability gaps (silent duplicate component names, no leak detection) rather than a correctness bug. |
| P0-04 | Seeded random streams | Done | P0-01 | Minor | xoshiro128** with named per-subsystem substreams so no system's draws can perturb another's. Algorithm itself verified correct byte-for-byte; critic added a golden-vector regression pin and fixed a validation gap. |
| P0-05 | Spatial world representation | Done | P0-03 | Moderate | Dense 3D cell grid, Y-up, entity↔cell occupancy index. Critic found `positionOf()` returned a live mutable reference that could silently desync occupancy tracking — fixed with a defensive copy. |
| P0-07 | Material definition system | Done | P0-03 | Minor | Properties, not identity — a compile-time type exclusion makes identity-branching a TypeScript error. Critic found the original anti-branching test was concretely defeatable and added a compile-time proof. |
| P0-09 | Terrain and strata | Done | P0-05, P0-07 | Moderate | Solidity derived from material presence, repeatable elevation+strata generator. Critic found two confirmed bugs: stale material after a second, lower generation pass, and snapshot restore silently clobbering non-terrain solidity. |
| P0-06 | Versioned persistence schema | Done | P0-02, P0-03, P0-05 | Critical | Composes every subsystem into one versioned, JSON-plain save. Critic found a high-severity DoS: a corrupted sub-tick accumulator value passed validation and could force a million synchronous ticks on the next `advance()` call. |
| P0-08 | Event and causality log | Done | P0-01, P0-02 | Moderate | Structured causal records with a `traceBack()` chain walker. Critic found `record()` never checked that a cause's tick preceded its effect's — an inspectable-but-wrong causal chain was possible. |
| P0-10 | Plants and trees as physical entities | Done | P0-02, P0-03, P0-07, P0-09 | Moderate | Real entities with species/age/health; harvestable mass derived fresh from state, never a lookup table. Critic found Plant component state had no validating write path — garbage data could become silent authoritative state. |
| P0-11 | Headless simulation runner | Done | P0-01…P0-10 | Minor | `createWorld` / `applyCommands` / `runHeadless` with zero renderer dependency anywhere in `src/sim`. Critic found the "commands run before ticking" ordering had no test that could actually catch a regression. |
| P0-12 | Debug inspection layer | Done | P0-03, P0-05, P0-08 | Critical | `inspectEntity` / `inspectCell` / `inspectWorld` — raw authoritative state via a plain function call. Critic found a high-severity bug: inspection returned live aliases into simulation state, so mutating a returned value could silently corrupt it. |

### Phase 1 — One Watershed (4/22 done)

| ID | Task | Status | Deps | Severity | Notes |
|---|---|---|---|---|---|
| P1-01 | Watershed map generator | Done | P0-09, P0-10 | Moderate | Meandering channel + banks/floodplain/upland classification + trees, built so downhill connectivity holds by construction across any seed. Critic found the slope-safety guarantee only held for the one tested map size — fixed to derive from both dimensions. |
| P1-02 | Water volume | Done | P0-05, P0-07, P1-01 | Critical | Per-column depth storage plus `fillBasin()`, an exact geometry solver for a known volume in a closed basin. Critic found a severe bug: a multi-chamber basin could silently deliver 3.5× the requested volume with no error — the whole algorithm was replaced with an incremental priority-flood solver. |
| P1-03 | Flow, drainage, hydraulic obstruction | Done | P1-02 | Critical | Dynamic tick-by-tick flow between adjacent columns, obstruction and permeability falling out of one formula at different sill heights. Two critic rounds found severe bugs: water couldn't flow into dry neighbors, then an undamped oscillation under continuous inflow, then a follow-on regression that made permeability invisible. |
| P1-04 | Unified terrestrial/aquatic navigation | Done | P0-05, P1-02, P1-03 | Moderate | One Dijkstra cost function serves every agent, with swim capability as a `NavigationProfile` parameter rather than a second pathfinder. Critic found two real gaps: "shallow water" carried no cost premium at all (masked by a loosened test assertion), and there was no debug/explain observability for why a route was blocked. Fixed with a depth-proportional wading cost and new `describeEdgeBlock`/`reachableColumns` primitives. |
| P1-05 | Beaver creature model | **Todo (unblocked)** | P0-03, P1-04 | — | — |
| P1-06 | Basic needs | Blocked | P1-05, P0-01 | — | — |
| P1-07 | Job/order architecture | Blocked | P1-05, P1-06 | — | — |
| P1-08 | Tree cutting | Blocked | P0-10, P1-07 | — | — |
| P1-09 | Physical items and hauling | Blocked | P0-07, P1-07, P1-08 | — | — |
| P1-10 | Construction jobs | Blocked | P1-07, P1-09 | — | — |
| P1-11 | Dam structure and hydraulic interaction | Blocked | P1-03, P1-10, P0-07 | — | — |
| P1-12 | Accessibility recomputation from water | Blocked | P1-04, P1-11 | — | — |
| P1-13 | Basic food and drink | Blocked | P1-06, P1-07, P1-09 | — | — |
| P1-14 | Sleep and shelter preference | Blocked | P1-06, P1-10 | — | — |
| P1-15 | Basic temperature exposure | Blocked | P0-01, P1-05 | — | — |
| P1-16 | Basic injury and death | Blocked | P1-05, P1-06, P1-15 | — | — |
| P1-17 | Minimal ecology response | Blocked | P0-10, P1-03 | — | — |
| P1-18 | Basic weather and day/night | Blocked | P0-01, P1-01 | — | — |
| P1-19 | Relationships baseline | Blocked | P1-05 | — | — |
| P1-20 | Minimal game UI | Blocked | P0-12, P1-07 | — | — |
| P1-21 | Save/reload full watershed state | Blocked | P0-06, P1-01…P1-20 | — | — |
| P1-22 | Causal explanation query | Blocked | P0-08, P1-11, P1-12, P1-16 | — | — |

### Milestone 0

| ID | Task | Status | Deps |
|---|---|---|---|
| M0 | Pond Test / Milestone 0 gate | Blocked | P1-01…P1-22 |

## §06 — Roadmap ahead

Deliberately not expanded into tasks yet — per Law 10, these stay dormant until the Pond Test passes.

| Phase | Name | Description |
|---|---|---|
| PH.02 | Living Colony | Beyond seven beavers: population growth, multi-family colonies, and the social scaffolding a real settlement needs. |
| PH.03 | Industrial Lodge | Deeper construction, crafting chains, and infrastructure beyond a single dam and lodge. |
| PH.04 | Living Ecosystem | A fuller ecology — more species, food webs, and environmental feedback loops than M0's minimal proof. |
| PH.05 | Society & History | Relationships, culture, and a persistent historical record of what the colony has done. |
| PH.06 | World Simulation | Beyond one watershed — a wider simulated world the colony exists within. |
| PH.07 | War, Politics & Civilization | Conflict, governance, and civilization-scale systems layered on the systemic foundation. |
| PH.08 | Chronicle | A player-facing history/legends system built on the same causal event log the engine already keeps. |
| PH.09 | Wayfarer | Travel and exploration beyond the home watershed. |
| PH.10 | DF Parity Audit | A deliberate pass checking coverage against Dwarf Fortress–class depth of interaction. |
| PH.11 | Systems DF Doesn't Have | Where Damn Beavers goes past its own inspiration — beaver-specific systems with no DF analogue. |

## §07 — Milestone 0: The Pond Test

Seven beavers arrive beside a stream. The player designates trees and a dam; ordinary AI does the rest. This is the project's first complete playable nucleus — every item below must hold with no scripted shortcuts.

**Status: NOT PASSED** — blocked on Phase 1 tasks P1-05 through P1-22.

- [ ] Stream generates and flows
- [ ] Seven persistent beavers arrive
- [ ] Player can designate trees
- [ ] Ordinary AI chooses cutting work
- [ ] Trees create physical logs
- [ ] Ordinary AI hauls logs
- [ ] Player can order a dam
- [ ] Physical materials are delivered
- [ ] Dam obstructs simulated water
- [ ] Upstream depth rises
- [ ] Water changes path accessibility
- [ ] Beaver AI adapts through normal jobs/navigation
- [ ] Flooding changes ecology
- [ ] Accidental harm/death is possible through universal systems
- [ ] The causal chain can be inspected
- [ ] Save during active scenario succeeds
- [ ] Reload preserves authoritative state
- [ ] Normal UI can perform the scenario

## Stack

- **Language:** TypeScript, strict mode
- **Runtime:** Node.js, ES2022 / NodeNext
- **Tests:** Vitest, 34 files
- **RNG:** xoshiro128** + splitmix32 seeding
- **Save format:** versioned, JSON-plain

## Repository shape

```
src/sim/
  core/        clock · identity · components · random
  world/       spatial grid · terrain & strata
  materials/   property-driven behavior
  ecology/     plant species & growth
  history/     causal event log
  hydrology/   water volume · flow
  navigation/  unified pathfinding
  worldgen/    watershed generator
  runtime/     headless simulation runner
  debug/       inspection layer
  persistence/ save/load
```

## Governing documents

- `AGENTS.md` — the ten laws
- `DAMN_BEAVERS_MASTER_ROADMAP.md`
- `docs/ARCHITECTURE_CONTRACT.md`
- `docs/M0_ONE_WATERSHED.md`
- `TASKS.md` — execution ledger
