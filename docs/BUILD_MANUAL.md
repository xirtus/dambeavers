# Damn Beavers — Build Manual & Roadmap Ledger

> A systemic beaver-civilization simulator built on one rule above all others: **systems, not scripted outcomes.** Every mechanic — water, wood, hunger, causality — is a real, inspectable simulation, never a hard-coded story beat.

Saved locally from the published artifact manual (`https://claude.ai/code/artifact/ca9956e5-9729-4af2-9aef-b5983caec800`) so the build state has a git-tracked copy. Regenerate/update this file as tasks close rather than relying on the hosted artifact.

**Status as of 2026-08-16** — Current task: P1-21 (Save/reload full watershed state) — TODO, unblocked — 804 tests passing

- **Phase 0 — Engine Foundation:** 12/12 done — gate PASSED 2026-08-13
- **Phase 1 — One Watershed:** 20/22 done (91%)
- **Milestone 0 — Pond Test:** NOT PASSED — blocked on P1-21, P1-22 (both now unblocked, neither done yet)

## Overview stats

| Metric | Value |
|---|---|
| Tasks done | 32 / 35 |
| Tests passing | 804 |
| Test files | 70 |
| Lines of sim code | 8,060+ |
| Lines of test code | 12,543+ |
| Tasks with a critic-found defect | 28 / 32 (P1-08, P1-12, P1-13, and P1-14's critic passes found no Critical/Moderate issue; P1-15 had one Moderate finding, fixed; P1-16 had two Critical findings, both fixed and independently re-verified; P1-17 had one Critical finding, fixed; P1-18 had one Moderate finding, fixed; P1-19 had one Moderate finding, fixed; P1-20's own new code had none, but its review surfaced and fixed a pre-existing Moderate bug in P1-10's `Construction.ts`) |

## §01 — Where the build stands

Phase 0 laid the engine foundation — clock, identity, components, persistence, debug tooling — and is fully closed out. Phase 1 is building the first watershed: terrain, water, flow, navigation, the beaver creature model, basic survival needs, job/order architecture, tree cutting, physical items/hauling, construction jobs, the dam structure/hydraulic interaction, accessibility recomputation from water, basic food and drink, sleep and shelter preference, basic temperature exposure, basic injury and death, minimal ecology response, basic weather and day/night, relationships baseline, and minimal game UI (a text/terminal interface, per explicit user decision, kept outside the 3D/rendering phase) are done; save/reload full watershed state and everything downstream are next.

Test-suite growth (cumulative, by completion order): 31 → 804 across 32 completed tasks.

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
| P1-05 | 461 |
| P1-06 | 497 |
| P1-07 | 538 |
| P1-08 | 562 |
| P1-09 | 590 |
| P1-10 | 620 |
| P1-11 | 629 |
| P1-12 | 630 |
| P1-13 | 645 |
| P1-14 | 662 |
| P1-15 | 676 |
| P1-16 | 713 |
| P1-17 | 734 |
| P1-18 | 760 |
| P1-19 | 779 |
| P1-20 | 804 |

## §02 — The quality process

No task is marked done on the strength of "it compiles." Every feature goes through the same five-step cycle before its ledger row closes:

1. **Implement** — the smallest correct mechanism for exactly this task, never a future phase's system built early.
2. **Unit + acceptance tests** — unit tests for the mechanism, plus a headless test matching the roadmap's literal acceptance wording.
3. **Independent critic review** — a fresh reviewer with no context tries to break it: correctness, determinism, persistence, generality.
4. **Fix + regression-test findings** — substantive findings get fixed, with a new test that fails on the old code and passes on the fix.
5. **Ledger entry with evidence** — TASKS.md is updated with test counts and a full account of what the critic found.

**20/21** completed tasks have had at least one substantive, independently-verified finding fixed before closing — including two severe bugs (water-volume delivery off by 3.5×, and an undamped flow oscillation) that required rewriting the algorithm, not just patching a check. P1-08's critic pass is the only one so far to find no Critical/Moderate defect — three Minor items were found and fixed anyway (a floating-point edge case, and two test-coverage gaps).

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
  -> P1-05 Beaver Creature Model (done)
  -> P1-06 Needs (done)
  -> P1-07 Jobs (done)
  -> P1-08 Tree Cutting (done)
  -> P1-09 Hauling (done)
  -> P1-10 Construction (done)
  P1-10 -> P1-11 Dam & Hydraulics (done) [also needs P1-03]
  P1-11 -> P1-12 Accessibility (done) [also needs P1-04]
  P1-10 -> P1-14 Sleep & Shelter Preference (done) [also needs P1-06]
  P1-06 -> P1-13 Basic Food & Drink (done)
  P1-05 -> P1-15 Basic Temperature Exposure (done) [also needs P0-01]
  P1-15 -> P1-16 Basic Injury and Death (done) [also needs P1-05, P1-06]
  P0-08 + P1-11 + P1-12 + P1-16 -> P1-22 Causal Explanation Query (todo, unblocked)
  P0-10 + P1-03 -> P1-17 Ecology (done)
  P0-01 + P1-01 -> P1-18 Weather & Day/Night (done)
  P1-05 -> P1-19 Relationships Baseline (done)
  P0-12 + P1-07 -> P1-20 Minimal Game UI (done, text/terminal)
  P0-06 + P1-01..20 -> P1-21 Full Watershed Persistence (todo, unblocked)
  P1-12 + P1-13..22 -> M0 — Pond Test
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

### Phase 1 — One Watershed (18/22 done)

| ID | Task | Status | Deps | Severity | Notes |
|---|---|---|---|---|---|
| P1-01 | Watershed map generator | Done | P0-09, P0-10 | Moderate | Meandering channel + banks/floodplain/upland classification + trees, built so downhill connectivity holds by construction across any seed. Critic found the slope-safety guarantee only held for the one tested map size — fixed to derive from both dimensions. |
| P1-02 | Water volume | Done | P0-05, P0-07, P1-01 | Critical | Per-column depth storage plus `fillBasin()`, an exact geometry solver for a known volume in a closed basin. Critic found a severe bug: a multi-chamber basin could silently deliver 3.5× the requested volume with no error — the whole algorithm was replaced with an incremental priority-flood solver. |
| P1-03 | Flow, drainage, hydraulic obstruction | Done | P1-02 | Critical | Dynamic tick-by-tick flow between adjacent columns, obstruction and permeability falling out of one formula at different sill heights. Two critic rounds found severe bugs: water couldn't flow into dry neighbors, then an undamped oscillation under continuous inflow, then a follow-on regression that made permeability invisible. |
| P1-04 | Unified terrestrial/aquatic navigation | Done | P0-05, P1-02, P1-03 | Moderate | One Dijkstra cost function serves every agent, with swim capability as a `NavigationProfile` parameter rather than a second pathfinder. Critic found two real gaps: "shallow water" carried no cost premium at all (masked by a loosened test assertion), and there was no debug/explain observability for why a route was blocked. Fixed with a depth-proportional wading cost and new `describeEdgeBlock`/`reachableColumns` primitives. |
| P1-05 | Beaver creature model | Done | P0-03, P1-04 | Moderate | 7 of the roadmap's 10 listed components as real `ComponentStore` data (needs/current-task/relationships deliberately deferred to their own dedicated later tasks — P1-06/P1-07/P1-19), plus `spawnSevenStartingBeavers` and a real `advanceTowards` movement primitive built on P1-04's navigation. Critic found the acceptance test's stream never actually exceeded the default wading depth, so `canSwim` was never genuinely exercised through a real beaver — empirically confirmed by disabling it and watching the suite still pass. Fixed by deepening the stream past wading depth and adding a dedicated real-beaver swim-vs-no-swim test. |
| P1-06 | Basic needs | Done | P1-05, P0-01 | Critical | Hunger/thirst/fatigue/thermal-comfort-baseline needs, driving real navigation toward the nearest tree/water when urgent, via a `NeedFocus` sticky-commitment memory (not a job/order — no reservation system exists yet). Critic found two Critical bugs in the first-draft anti-starvation logic: a memoryless "already reached" check caused permanent tick-by-tick shuttling between two nearby resources, and an unreachable target could permanently starve out an equally-urgent, reachable need. Fixed with sticky focus (commit until a pursuit genuinely concludes) plus real `findPath`-based reachability exclusion; independently re-verified by a second critic pass. |
| P1-07 | Job/order architecture | Done | P1-05, P1-06 | Critical | The full designation→job→eligibility→selection→reservation→execution→completion pipeline, proved via a minimal generic "go-to" designation (real labor types are P1-08+'s job). Critic reproduced a genuine, indefinite livelock: `selectJob` ranked candidates by raw distance with no reachability check, so a beaver could reserve-fail-requeue the same unreachable job forever, permanently starving every other reachable job — the exact class of bug P1-06 had already needed a fix for, unused here. Fixed with a real `findPath` reachability check before ranking, mirroring P1-06's fix; also fixed a doc comment that overclaimed execution needed "no change" for future multi-job designations, by properly scoping designation completion to require every referencing job done. |
| P1-08 | Tree cutting | Done | P0-10, P1-07 | Minor | The first real labor type on P1-07's job pipeline: designate a tree, path there, real tool/body capability hook (always-true today — no tools exist), multi-tick skill-scaled work, tree removal, and physical log entities whose mass exactly matches the tree's real harvestable mass. Critic — primed to hunt for the same arbitration-bug class that hit P1-06/P1-07 — found no Critical/Moderate defect in the new work-accumulation state machine. Fixed three Minor items anyway: an unguarded floating-point edge case in log-mass splitting, and two test-coverage gaps (a direct `completeJob` regression test, and concurrent-designations coverage). |
| P1-09 | Physical items and hauling | Done | P0-07, P1-07, P1-08 | Critical | `Log.ts` gained `Held`/`Reservation` and `pickUp`/`drop`; `Hauling.ts` adds a real two-leg `"haul-item"` job (to-item, then a mass-penalized carry to destination) reusing `JobBoard`'s reachability-checked selection. Critic found a Critical bug in code this task itself introduced: nothing prevented two designations from targeting the same item, and `Reservation` was write-only — never actually consulted — so a second beaver could crash on a stale item position and silently clobber the first beaver's reservation. Fixed with a new `isEligibleForHaul` guard plus a belt-and-suspenders throw; verified by reverting and confirming the regression test catches it. Separately, the critic independently re-verified this task's own self-found "carrier dies mid-haul" limitation as a correctly-scoped, non-blocking deferral to a future death system (P1-16). |
| P1-10 | Construction jobs | Done | P1-07, P1-09 | Critical | The first labor type with two phases (material delivery, reusing P1-09's hauling unmodified, then labor/assembly via a new `tickBuildJob`), and the first to introduce designation cancellation as a general concept. Critic found a Critical bug in this task's own new code: delivered material had no ownership tying it to a specific construction, so it could be double-counted across two constructions sharing a site or silently stolen by an unrelated haul job after "delivery" but before assembly, letting a construction complete having consumed nothing. Fixed with site-uniqueness at designation time plus a real material-claim mechanism reusing `Log.ts`'s existing `Reservation` component; verified by reverting each piece and confirming 5 new regression tests fail as expected. A second critic pass independently re-verified the fix and found one further Minor gap (over-delivered excess material was being swept up and destroyed instead of left as reusable stock) — also fixed and empirically verified. |
| P1-11 | Dam structure and hydraulic interaction | Done | P1-03, P1-10, P0-07 | Moderate | Adds no new hydraulic formula: raises real `TerrainField` material at a completed dam-segment construction's site and lets P1-03's existing sill-height/permeability flow formula respond, exactly per ARCHITECTURE_CONTRACT §12. A second segment at the same site stacks height onto the same physical dam. Critic found a Moderate bug in this task's own new code: `applyDamSegment` wasn't idempotent, so calling it twice on the same completed construction silently fabricated a second real terrain cell from wood only ever consumed once (a Law 1.6 violation). Fixed with a `DamApplication` marker component preventing a repeat call; verified by reverting and confirming the regression test fails as expected. |
| P1-12 | Accessibility recomputation from water | Done | P1-04, P1-11 | — (clean) | Zero new production code — P1-04's `findPath`/`edgeCost` already read live `WaterField` depth on every call with no cache anywhere in the codebase, exactly the roadmap's "reacts to hydrological state, not hand-authored map flags." This task's only deliverable is the literal, real-hydrology end-to-end acceptance test (a real pond floods a ford via `stepFlow`, blocking a route, then recedes via `applyEdgeDrainage`, unblocking it again). Critic pass found no Critical/Moderate defect — confirmed no memoization anywhere in the pathfinding call chain, confirmed the block reason is genuinely `"too-deep-to-cross"` (not a coincidental cause), confirmed comfortable test margins, and confirmed skipping new unit tests was defensible given existing `pathfinding.test.ts` coverage of the same mechanism. |
| P1-13 | Basic food and drink | Done | P1-06, P1-07, P1-09 | — (clean) | Wires real consumption into P1-06's `"seek-food"`/`"seek-water"` intents, which previously only stopped travel on arrival. New `Food.ts` item reuses `Log.ts`'s generic `Held`/`Reservation`/`pickUp`/`drop` directly. On arrival: `eatFromTree` (unlimited fallback, fully satisfies hunger, real small `Plant.health` cost) or `eatFoodItem` (destroys the real item, restores hunger by its own `nutritionValue`) for hunger; `drinkWater` (fully satisfies thirst, no `WaterField` depletion -- a single sip is negligible against real pond volume) for thirst. Critic pass found no Critical/Moderate defect — its own disposable probe confirmed two beavers racing for the same food item never crash or double-consume (promoted to a permanent regression test), and confirmed no crash path exists anywhere for `eatFromTree`'s tree-must-have-Plant-data assumption. |
| P1-14 | Sleep and shelter preference | Done | P1-06, P1-10 | — (clean) | First real arbitration between survival needs and held jobs (new `BeaverBehavior.ts`) — urgent fatigue always interrupts a held job (new `JobBoard.suspendJob`, ARCHITECTURE_CONTRACT §10's "need becomes urgent," listed since P1-07 but wired up here for the first time), requeuing it for another worker. Rest now targets the nearest reachable COMPLETED lodge if one exists, else rests in place. Critic pass found no Critical/Moderate defect — confirmed via disposable probes that job-work fatigue accumulation is a defensible design choice, rest-recovery timing is consistent across cases, and a single-beaver borderline-fatigue scenario settles into a stable, productive work/rest cycle rather than thrashing. |
| P1-15 | Basic temperature exposure | Done | P0-01, P1-05 | Moderate | `thermalComfort` now genuinely responds to real environmental exposure — drifts toward a per-medium target at a rate scaled by the REAL `thermalConductivity` (P0-07) of whatever surrounds the beaver (water 0.6 vs. air 0.025, a real ~24x ratio), so "cold water changes state faster than dry ground" falls out of one shared formula, never a hardcoded special case. Critic found a Moderate issue in this task's own new code: a working (job-holding) beaver's thermal exposure uses a position read BEFORE that same tick's job-driven movement, a bounded, self-healing one-tick lag distinct from `tickBeaverNeeds`'s own genuinely-current-position guarantee. Fixed by documenting the limitation explicitly (matching this codebase's established pattern for similar known limitations) and adding a permanent regression test that locks in the lag-then-catch-up behavior. |
| P1-16 | Basic injury and death | Done | P1-05, P1-06, P1-15 | Critical (x2) | New `Breath` (respiratory state) and `Corpse`/`die`/`tickMortality`/`applyTrauma` mechanisms — all four roadmap causes (drowning/starvation/exposure/trauma) drive real, continuous `Health` damage; death only ever follows `Health.fraction` reaching 0, never a scripted event trigger. Critic found two Critical bugs in this task's own new code: `canBreatheAt` re-derived "floor" via `grid.surfaceY`, which silently returns a ceiling's own y once one exists above a beaver's true floor (the exact sealed-chamber scenario the function exists to detect), reported "breathable" for a genuinely-trapped beaver on any sufficiently large map; and `die()` destroyed a beaver without dropping items it physically held, permanently losing them from the world (Law 1.6) — a gap `Hauling.ts`'s own P1-09 comment had explicitly named as "most naturally" P1-16's to resolve. Both fixed and independently re-verified by a second critic pass via full revert/reproduce/restore cycles. |
| P1-17 | Minimal ecology response | Done | P0-10, P1-03 | Critical | New `EcologyResponse.ts`, over EXISTING data (`WaterField`, `Plant`/`PlantSpeciesProperties`) with no new parallel bookkeeping. `applyVegetationHealthTick` — a pure function matching `applyThermalExposure`'s own precedent — drifts `Plant.health` toward `siteFitness = 1 - |wetness - species.moisturePreference|`, one shared formula producing both halves of the roadmap's acceptance sentence. Also: `applyPlantGrowthTick` (real `ageTicks` advancement), `plantSapling` (real, uncalled regrowth primitive, Law 10), `isFishHabitat`/`spawnFish` (real, physical, presence-only fish entity). Critic found a Critical bug in this task's own new data: `siteFitness` only reaches its max of 1 at an EXACT wetness match, but the shipped species data used near-extremes (aspen 0.2, willow 0.85) rather than true extremes — so a species standing in its own genuinely-ideal habitat could never sustain full health from the game's real default spawn condition (`health: 1`), perpetually decaying instead of holding steady, directly contradicting the roadmap's "gains viability" framing. Fixed by changing aspen's `moisturePreference` to exactly 0 and willow's to exactly 1. Verified by reverting and confirming two new regression tests — run against the real shipped species registry, not test-local fixtures — fail with the critic's own exact numbers, then restored. A second critic pass was judged disproportionate and skipped: the fix changed only two data constants plus doc comments, no structural logic, and revert/reproduce/restore already directly reproduced the critic's numbers. |
| P1-18 | Basic weather and day/night | Done | P0-01, P1-01 | Moderate | Real day/night clock (pure functions of `SimulationClock.tick`), real sinusoidal ambient temperature (no current caller — a legitimate Law-10 deferral, since rewiring it into P1-15's already-shipped thermal system is out of this task's precipitation-only acceptance scope), real precipitation input (`applyPrecipitation` adds volume via `WaterField.addVolume`, then lets P1-03's unmodified `stepFlow` redistribute it), and a minimal `Weather` class holding one real field (`condition`), with `precipitationRate` always derived from it. Critic found a Moderate bug in this task's own new code: `Weather.setCondition`/`fromSnapshot` validated the condition with the `in` operator against a frozen plain object literal — `Object.freeze` doesn't sever the prototype chain, so `in` also silently matched inherited `Object.prototype` keys (`"constructor"`, `"toString"`, etc.), letting `setCondition("constructor")` pass validation and later return a function instead of a number from `precipitationRate`, only failing much later and far from the actual cause — notable since `fromSnapshot` is exactly the boundary P1-21's future full-watershed persistence will feed untrusted data through. Fixed by switching both checks to `Object.hasOwn`; verified by reverting and confirming a new regression test (covering `"constructor"`/`"toString"`/`"hasOwnProperty"`/`"valueOf"`/`"__proto__"`) fails exactly as expected, then restored. A second critic pass was judged disproportionate given the fix's small, contained scope. Critic also confirmed the acceptance test's downstream>upstream assertion is driven by real `stepFlow` physics (verified via its own parameter sweep against a flat-terrain control), and that the "no caller yet" deferrals for ambient temperature and weather auto-advancement are genuine and consistent with the codebase's current state (no master systems-tick loop exists yet anywhere). |
| P1-19 | Relationships baseline | Done | P1-05 | Moderate | New `Relationships.ts` — directed relationship edges (kin/familiarity/affinity, `RelationshipEdge`) per beaver toward another beaver by `EntityId`, matching `Log.ts`'s directed-reference precedent (`Held.by`/`Reservation.by`) since real familiarity/affinity are genuinely subjective per-direction; plus a real `"household"` entity (P0-02 stable identity) with `HouseholdMembership` and a live-derived `householdMembers` query. `Beaver.ts` deliberately left untouched — no relationship/household data is attached automatically to the seven starting beavers, since there's no real narrative/generation basis yet for which are kin, matching `Skills.ts`'s own "ship empty until a real system populates it" precedent. Critic found a Moderate bug in this task's own new code: `householdMembers` read each candidate's `HouseholdMembership` via a raw, unvalidated `components.get(...)` instead of this file's own validating read path (`getHouseholdMembership`) — inconsistent with `relationshipWith`, which correctly validates, and the same "validated write path, unvalidated read path" bug class this project hit before (P0-10's Plant). The critic empirically reproduced a corrupted `householdId: -5` (simulating unvalidated snapshot-restore data) silently passing through `householdMembers` with no error. Fixed by routing the filter through `getHouseholdMembership`; verified by reverting and confirming a new regression test reproducing the exact `-5` repro fails as expected, then restored. A second critic pass was judged disproportionate given the fix's small, contained scope. Critic confirmed `EntityId` reference stability across save/reload is structurally guaranteed (not assumed) by `EntityIdRegistry`'s gapless-sequence restore validation, and confirmed the "zero automatic relationship wiring" scope choice is the correct literal reading of the roadmap's own "**can have** distinct... graphs" phrasing. |
| P1-20 | Minimal game UI | Done | P0-12, P1-07 | Moderate (pre-existing, surfaced) | Per explicit user decision, built as a real TEXT/terminal UI (`src/ui/TextUI.ts`) — no graphics, no ThreeJS, kept entirely outside the deferred 3D/`src/presentation/` layer (ARCHITECTURE_CONTRACT §1/§2), one-way dependency confirmed by grep (`src/ui` → `src/sim`, never reversed). Every roadmap bullet is a real, thin command surface over already-shipped mechanisms: pause/speed (`SimulationClock`, P0-01), camera navigation (a real live column position + a pure ASCII grid re-derived from `WorldGrid`/`WaterField`/`EntityIdRegistry` every call), select/inspect beaver and object (P0-12's `inspectEntity` — its own doc comment named this exact task as the intended caller), inspect tile/water (composes P0-12's `inspectCell` with live `WaterField.depthAt`), designate tree cutting/construction (pass-throughs to P1-08/P1-10), and alerts (a real, freshly-derived list from live urgent-need and corpse-presence state, never an authored message queue). Critic found no Critical/Moderate defect in `TextUI.ts` itself — confirmed the `groundY + 1` "stands on top of the ground" convention is applied correctly and consistently, confirmed one-way layering, confirmed `alerts()` is genuinely live-derived. It DID surface one Moderate bug in *pre-existing* `Construction.ts` (P1-10) that this task's own `designateConstruction` pass-through exposed to a caller with no compile-time type safety for the first time: an invalid `kind` crashed with a raw `TypeError` deep inside the function, AFTER already permanently allocating two orphaned entities (a designation and a component-less construction entity, neither ever reclaimable). Fixed as part of closing this task — `designateConstruction` now validates `kind` first, before creating anything, matching `designateTreeCut`'s own validate-then-create precedent; verified by reverting and confirming a new regression test fails with the critic's exact `TypeError`, then restored. |
| P1-21 | Save/reload full watershed state | **Todo (unblocked)** | P0-06, P1-01…P1-20 | — | All of P1-01 through P1-20 are now DONE — this row's blanket dependency gate is satisfied for the first time. |
| P1-22 | Causal explanation query | **Todo (unblocked)** | P0-08, P1-11, P1-12, P1-16 | — | — |

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
