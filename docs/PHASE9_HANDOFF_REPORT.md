# Phase 9 — Wayfarer — Handoff Report (implementation + audit complete)

**Date:** 2026-08-18
**State:** All 10 tasks implemented (`src/sim/wayfarer/`), carried through the FULL cycle: per-task acceptance tests, consolidated smoke test, independent critic pass (nine findings, all fixed with regressions), composed gate test green. Rows DONE; gate PASSED.

**Numbers:** 1227/1227 fast-suite tests across 209 files; `npm run typecheck` clean; 7 composed gate tests (`npm run test:gate`) -- the new `tests/gate/p9-gate-wayfarer.test.ts` proves the gate's own sentence. Registry 83 -> 87 component types (player-control, wayfarer, wayfarer-link, companion).

## What was built

A `src/sim/wayfarer/` layer with NO separate adventure-world ruleset: the controlled character IS an ordinary beaver.

| Task | Module | One-line mechanism |
|---|---|---|
| P9-01 Direct control | `Control.ts` | player-control component; ColonyLoop skips job arbitration for it; commands execute through ordinary movement; every body system keeps ticking |
| P9-02 Verbs | `Verbs.ts` | pickup/drop/eat/drink/open/use/speak/attack/steal each call the systems' own primitives |
| P9-03 Conversation | `Conversation.ts` | options derived from identity/knowledge/relationship/culture/situation; effects are the systems' own |
| P9-04 Personal travel | `Travel.ts` | one persistent region-scale wayfarer entity; materialize/depart bridge the real P6-08 boundary; real route, real time |
| P9-05 Survival | `Survival.ts` | literally the same needs/thermal/wound primitives as colony mode |
| P9-06 Combat | `Combat.ts` | `playerAttack` = `resolveBattleExchange`, extracted from P7-15's own loop (no behavior change) |
| P9-07 Consequences | `Consequences.ts` | steal = real violation record + real pickup; deeds derived from the same records |
| P9-08 Companions | `Companions.ts` | willingness from the real edge; ordinary AI retained; one ordinary follow step per idle tick |
| P9-09 Situations | `Situations.ts` | objectives reference real entities/events only; resolution follows real state |
| P9-10 Return | `Return.ts` | releases the override and nothing else -- its size is the proof |

## Critic pass -- nine findings, all fixed with regressions (`tests/unit/phase9CriticRegressions.test.ts`, each verified to fail on the pre-fix code)

**From the critic pass (7):**
1. (Moderate) Eating a HELD food item destroyed the item but left it in the eater's Inventory -- a stale reference that crashed the next death-drop. Fixed in `BeaverNeeds.eatFoodItem` (held food leaves the inventory before destruction; the ordinary ground-eating path is unchanged).
2. (Moderate) `materializeWayfarer` consumed the promoted region items but left their ids in `wayfarer.state.itemIds` -- a second journey would re-materialize ghost items. Fixed (state cleared at materialization; `travelToSite` re-reads the wayfarer afterward instead of writing its stale copy back).
3. (Moderate) Designating control (or inviting a companion) left a currently-held job reserved forever -- the loop skips job arbitration for controlled/companion beavers. Fixed (`suspendJob` on designate/invite).
4. (Minor) `tickWayfarerSurvival` ticked mortality -- composing it with the colony loop double-ticked the body. Fixed (mortality stays the loop's own pass; the primitive is needs+thermal+wounds and `tickControlledBeaver` delegates to it -- one shared body function).
5. (Minor) `assertValidPlayerControl` did not validate verb payloads. Fixed (every verb shape validated; unknown kinds rejected).
6. (Minor) `wayfarer`/`wayfarer-link`/`companion` components had no validators. Fixed (`assertValidWayfarer` full state validation + link/companion validators on every set/get).
7. (Minor) Departure promoted a carried item out of a container but left the container listing the destroyed item. Fixed (`removeFromContainer` at promotion).

**Caught by the gate test itself (2):**
8. (Moderate) The travel API could not walk into an ALREADY-ACTIVE settlement -- the gate's own "walk into a historically generated settlement" clause. Fixed with `travelToActiveSite` (same real journey; materialization into the living settlement's world; that world's clock advances by the journey's real duration).
9. (Minor) A guilty verdict made the recovery situation VANISH instead of reporting resolved. Fixed (guilty accusations keep their situation visible; resolution follows the real ownership change).

## Gate test

`tests/gate/p9-gate-wayfarer.test.ts`: seeded generated region, two real settlements; one settlement LIVED first (founder couple, three real generations, a real leader, a real old artwork); the wayfarer walks in, meets a real descendant (parentage chains to the historical founder), talks (the edge strengthens), steals the old artwork (real violation), and the settlement's REAL justice takes it back (accusation -> judgment -> fine; the recovery situation resolves); a real wound, a real journey home, return to colony mode; Chronicle then reads every consequence from the same records.

## Known limitations (triaged, documented in code)

- Item identity across the P6-08 scale boundary is the REGION entity; the detailed materialization is a new local id. Held-but-not-owned items keep their recorded legal owner (opaque id + name in the departure event's data); materialized copies are unowned-but-carried.
- Relationship re-attachment across the boundary matches by NAME (residents are named deterministically on activation); same-named residents at a destination re-attach the remembered edge -- documented semantics, names are the boundary's durable identifiers for persons.
- The wayfarer's journey advances inactive sites' LOD and the active destination's clock, but does not itself run the destination's colony ticks across the span (the caller composes the loop as always).
