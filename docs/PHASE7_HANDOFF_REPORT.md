# Phase 7 — War, Politics & Civilization — Handoff Report for the Independent Critic

**Date:** 2026-08-17
**State:** All 18 tasks implemented (`src/sim/politics/`, plus `src/sim/creatures/Anatomy.ts`), verification pass 1 of 2 complete (per-task acceptance tests, consolidated smoke test, composed gate test). Rows are `REVIEW`; the independent critic review is the remaining step before any row promotes to `DONE` and the Phase 7 gate verdict becomes final.

**Numbers:** 1168/1168 fast-suite tests across 195 files; `npm run typecheck` clean; 5 composed gate tests (`npm run test:gate`) — the Phase 7 gate test passes. Registry 66 → 83 component types (pinned count test bumped). Commit `0eabfd9`.

## What was built

A new `src/sim/politics/` layer above the Phase 6 region world (real `Site` entities, real travel network), composed by `PoliticsLoop.tickPolitics` — the political counterpart of `ColonyLoop.tickColony`. Nothing scripted: every outcome flows from shared systems (ownership, beliefs, leadership, skills, EventLog, health/death).

| Task | Module | One-line mechanism |
|---|---|---|
| P7-01 Organizations | `Organization.ts` | org entities, data-defined roles, shared assets = existing institutional ownership |
| P7-02 Settlements as polities | `PoliticalEntity.ts` | polity component on real sites; leader/pop/resources/territory/identity derived |
| P7-03 Trade | `Trade.ts` + `routeBetween` in `Travel.ts` | real caravans, real food, real routes, arrival-only delivery |
| P7-04 Markets | `Market.ts` | base utility x real scarcity (held mass / population) — no price column |
| P7-05 Migration | `Migration.ts` | push/pull from real state; physical groups; one exodus at a time |
| P7-06 Diplomacy | `Diplomacy.ts` | standing DERIVED from shared events + treaties |
| P7-07 Territory | `Territory.ts` | persistent claims; overlap = real tension; feeds war causes |
| P7-08 Government | `Government.ts` | 4 data-defined forms; succession consults deceased leaders' edges |
| P7-09 Justice | `Justice.ts` (+`EventLog.all()`) | evidence-validated accusations; real investigation/judgment/punishment |
| P7-10 Combat anatomy | `creatures/Anatomy.ts` | body plans as data; weighted part selection; per-part consequences |
| P7-11 Weapons/armor | `Weaponry.ts` | force/resistance from real material+geometry; no authored damage |
| P7-12 Medicine | `Medicine.ts` | consumes real materials; healer skill scales; modifies real wound fields |
| P7-13 Raids | `Raids.ts` | ordinary-travel raids (settlement and predator); real loot |
| P7-14 Military | `Military.ts` | ordinary orgs; real skill training; real equipment; recorded missions |
| P7-15 Battles | `Battle.ts` | ordinary exchanges; real deaths; `battle-casualty` causal records |
| P7-16 Wars | `War.ts` + `WarPlanning.ts` | real causes; attached battles; real cessions + treaty; queryable arc |
| P7-17 Civilization | `Civilization.ts` | real preconditions; institutions/beliefs carry; durable |
| P7-18 Collapse | `Collapse.ts` | real conditions; recorded dissolution; everything persists; successors |

## Defects already found and fixed by the acceptance/smoke/gate tests (regression-covered)

1. `Migration.pushScore` counted `territory-ceded` as displacement pressure on the WINNER too — fixed to press only the ceding subject.
2. Migration planning had no pacing (a new exodus every tick) — fixed with `hasActiveOutboundMigration`.
3. Raid events never named the raiders' origin — diplomacy could not sour between the two sites actually involved. Fixed; `raid-arrived` weight retuned to −0.35.
4. War-cause validation demanded the cause event name BOTH participants — no real claim event does. Relaxed to at-least-one, documented.
5. `endWar` ceded territory without registering the winner's new claim with the winner's polity — fixed via `registerClaimWithPolity`.
6. Battle deaths had no causal link to their battle — added `battle-casualty` events chained to `battle-began`.
7. First-draft weapon force could not penetrate any tissue — retuned scales; vital wounds now genuinely threaten life.
8. `Government.inherit`/`appoint` refused to consult a deceased leader's edges — fixed (edges survive their holder).
9. Wars could never end via the loop (migration's leave-one-behind kept spent sides at 1) — `tickWars` treats ≤ 1 population as spent.

## Suggested critic probes (prioritized)

1. **Component-store persistence round-trips** — every new component (17) through `WorldSnapshot`; read-boundary validation on hand-corrupted snapshots (the pattern the Phase 4/5/6 critic passes established: `RegionMap`, `Belief`, `Memory` all needed it).
2. **Determinism** — `tickPolitics` uses only named streams and sorted iteration; confirm no unordered iteration leaks into event order or scheduling.
3. **No scripted outcomes** — specifically: does any acceptance test's setup *force* its outcome (e.g. weapon masses chosen to make barter values match)? Which of those are honest demonstrations vs. rigged scenarios?
4. **Physicality at region scale** — caravans/migrations/raids move food/population abstractly along routes; is the one-physical-location-per-item contract (ARCHITECTURE_CONTRACT §13) violated anywhere for carried goods?
5. **War end edge cases** — both sides ≤ 1 population (mutual exhaustion): war stays `"ongoing"` forever. Real, but is it documented as an accepted state? What happens to a civilization whose member sites are at war with each other?
6. **Justice evidence soundness** — a witness recorded on the violation event by the ACCUSER's own filing is self-asserted (the accuser names the witnesses). Is that an acceptable honesty level, or does it need an independent witness-verification step?
7. **Battle loot/artifact paths** — dead fighters' org equipment returns to the org pool, personal items pass via `bequeathEstate`; what happens to equipment of a side whose org is later dissolved?
8. **Migration oscillation** — a pressured site with exactly 2 population departs 1 repeatedly (floor(pop/4)=0 → max(1,0)=1 each time pop>1); can a site reach 0 through migration alone? Should it?

## Known limitations (triaged, documented)

- Region-scale goods carried by caravans transfer ownership on arrival without a detailed-grid position journey (the region layer's own abstraction precedent — `Site.storedFoodKg` — applies).
- Combat skill affects force only inside battles (`Battle.ts` scales fighter force); `Weaponry.resolveCombatExchange` is the raw material/geometry formula.
- `Confinement` is a real until-tick restriction with no colony-loop enforcement hook yet (Law 10 — the wiring choice is a future task's, like P5-12's own un-wired detector).
- Politics systems tick at region scale via `tickPolitics`; they are not yet wired into any UI or into `ColonyLoop` for active sites.

## What the verification pass already covers

- `tests/simulation/p7-01` … `p7-18` — one file per task, literal roadmap wording.
- `tests/unit/phase7WarPoliticsSmoke.test.ts` — 6 end-to-end cases through the real loop.
- `tests/gate/p7-gate-war-politics-civilization.test.ts` — the gate sentence end to end (generated region → six sites → 120-tick composed advance → every clause exercised against what actually happened).
