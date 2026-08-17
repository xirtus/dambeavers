# Phase 3 (Industrial Lodge) — Handoff Report for the Verification Agent

**Date:** 2026-08-17 · **Author:** verification pass (per-task acceptance tests)
**For:** the agent running the remaining verification step (independent critic review + DONE promotion).

---

## 1. Where the phase stands

All 18 Phase 3 tasks (P3-01..P3-18) are implemented and wired into the real
simulation (job pipeline, persistence, `ColonyLoop`). The previous pass
batch-implemented the phase and deferred per-task verification. This pass
**finished the per-task acceptance tests** — the first of the two remaining
verification steps. The **second step — independent critic review — is still
owed**, and no P3 row may be promoted from `REVIEW` to `DONE` until it is done
and its findings are fixed with regression tests (TASKS.md's own rules).

**Current evidence (all verified this pass):**
- `npm run typecheck` clean.
- Full fast suite green: **1050/1050 tests across 128 files** (was 1029/110).
- New: 18 acceptance files, `tests/simulation/p3-01-workshop-framework-acceptance.test.ts`
  through `p3-18-trade-goods-production-acceptance.test.ts` (21 cases), each
  matching its roadmap acceptance sentence literally.
- Pre-existing: `tests/unit/phase3EconomySmoke.test.ts` (8 end-to-end cases).

## 2. Code changes made by this pass (two real fixes the tests surfaced)

1. **P3-17 quality gap CLOSED** (`src/sim/economy/Craft.ts`):
   `qualityOf(materials, components, beaverId, recipe)` is now the geometric
   mean of three factors — skill `level / (level + 10)`, material hardness
   `hardness / (hardness + 4)`, process `workRequired / (workRequired + 10)`.
   All three roadmap inputs are load-bearing; quality is 0 if any input is 0.
   The old signature lacked the material input entirely (the flagged gap).
2. **P3-14 bridge navigation gap FIXED** (`src/sim/structures/Bridge.ts`):
   navigation's depth check ignored raised floors, so no bridge ever changed
   reachability. `applyBridgeSegment` now zeroes the column's open water when
   the deck clears the surface (there is none above it) and records the
   displaced depth in a new `BridgeSegment.displacedDepthL` field;
   `removeBridgeSegment` restores `max(current, displaced)` so the water is
   never silently destroyed (Law 1.6). `BridgeSegment` gained a required
   field — safe because no released saves contain bridge segments yet (this
   phase is uncommitted/unreleased); flag it for a save-version bump if any
   released save ever holds one.

## 3. Remaining known limitations (triaged, NOT fixed — deliberate)

1. **Flat-height support BFS (P3-10/P3-14).** `Structural.isSupported` chains
   segments only at the identical height and only to segments with solid
   ground directly beneath. Consequences today:
   - a multi-segment bridge over water collapses on its first structural tick
     (each segment computes its own deck height from LOCAL water depth, so
     heights disagree across a wet/dry boundary; and an elevated bank segment
     has nothing solid beneath it);
   - the P3-14 acceptance test therefore proves route creation + stress-driven
     removal, and does NOT tick the support system while the deck stands.
   A real fix needs: one shared deck height computed across a whole span up
   front, plus real abutment/pier grounding (solid beneath the end segments).
   This is genuine follow-up design work, not a hot-fix.
2. **Bridge displaced-water heightfield approximation.** While a deck stands,
   water physically beneath it is not representable in the column heightfield
   (depth is always modeled above the floor), so flow through a bridged column
   pauses until the deck is removed (depth restored on collapse). Documented
   in `Bridge.ts`'s `applyBridgeSegment` comment.

## 4. Critic review brief (the remaining work)

Run the project's normal independent critic pass over the whole Phase 3
workspace (this pass's diff plus the batch implementation). Highest-value
probes, in priority order:

1. **P3-14 bridge water displacement** (new code, most consequential): is the
   displaced depth restored correctly in every collapse/removal path? Does
   `displacedDepthL` survive save/reload (`assertValidBridgeSegment` validates
   it)? Is water ever destroyed or duplicated across apply/remove cycles?
   Is the "flow pauses under a standing deck" approximation correctly
   documented rather than silently wrong?
2. **P3-17 quality formula**: monotonicity, bounds, and whether the geometric
   mean hides any degenerate case (e.g. hardness 0 materials — `water`/`air`
   as an output material would yield quality 0; is that reachable through any
   recipe data and is it handled?). `materials.get` throws on unknown ids —
   is `recipe.outputMaterialId` ever unregistered in a real path?
3. **P3-01/P3-02 generic driver**: can any recipe data make `designateCraft`/
   `ensureCraftMaterialHaul`/`assembleCraftOrder` misbehave (mass overshoots,
   reservations leaking on failure, two orders at one site double-claiming)?
   The claim logic mirrors P1-10's fixed pattern — verify it truly does.
4. **P3-10/P3-11 structural ticks**: determinism of the BFS (visited set is
   entity-id-based; allSegments order), whether `tickAllDamStructures`/
   `tickAllBridgeStructures` sort ids for determinism, and whether collapse
   debris can ever spawn inside solid terrain.
5. **P3-06/P3-16 multipliers**: interaction of tool + skill + power
   multipliers (all three multiply in `tickCraftJob`) — any unbounded growth?
6. **Persistence**: all 12 new component types round-trip (registry pinned at
   55 in `tests/unit/allComponentTypes.test.ts`); `BridgeSegment`'s new
   required field vs. any pre-existing snapshot fixtures.
7. **Authored-outcomes check (Law 1)**: no named scene, no per-recipe quality
   table, no per-material-name branch anywhere in the new modules.

Then, per the project's five-step cycle: fix substantive findings with
regression tests that fail on the old code, promote each row `REVIEW → DONE`
in TASKS.md with the critic's account, sync `docs/BUILD_MANUAL.md` (rows,
§08.5, gate note) and the `BUILD_MANUAL.html` banner/stats, and only then
evaluate the Phase 3 gate.

## 5. Files this pass touched

- `src/sim/economy/Craft.ts` (qualityOf + assembleCraftOrder signature)
- `src/sim/structures/Bridge.ts` (displacedDepthL + apply/remove behavior)
- 18 new files under `tests/simulation/` (one per P3 task)
- `TASKS.md` (all 18 P3 rows + process note + gate note)
- `docs/BUILD_MANUAL.md`, `docs/BUILD_MANUAL.html` (status, stats, P3 section)
