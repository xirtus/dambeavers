# Phase 8 — Chronicle — Handoff Report (joint Phase 7+8 audit)

**Date:** 2026-08-17
**Status:** Phase 8 DONE — gate PASSED. All 10 tasks `DONE` through the full project cycle: implementation, per-task acceptance tests against literal roadmap wording, consolidated smoke test, composed gate test, and the independent critic pass (joint audit with Phase 7).

## What was built

A pure READ layer, `src/sim/chronicle/` (~2,000 lines) — no new component type, no new entity kind, no tick loop, no RNG. Every query is a deterministic derivation over the already-authoritative EventLog/components/registry:

- `Chronicle.ts` (P8-01) — queries by stable id for people, sites, objects, events, relationships, wars, constructions, causal links; every record carries `references` that resolve.
- `Timeline.ts` (P8-02) — world-to-individual timelines with real windowing (tick range, type filter, entity filter, offset/limit pagination), ordered by (tick, id).
- `FigurePages.ts` (P8-03) — every claim (identity, status, birth, parentage, death, offspring, leadership, household, relationships, reputation, artworks, significance, recorded history) carries explicit sources: real event ids, real attached components, or the registry.
- `SiteHistories.ts` (P8-04) — founding, ownership, population (reconstructed from the exact recorded counts), disasters, constructions, battles, cultural changes, plus a current-state entry; `sitePopulationAt` is honest about what was never recorded.
- `ArtifactHistories.ts`/`Provenance.ts` (P8-05) — maker, owner chain (each transfer event carries BOTH owners), location trail, uses, thefts, losses, recoveries, present state; recorders live at the real mutation sites.
- `Genealogy.ts` (P8-06) — parents/children/ancestors/descendants/full lineage, no duplicated or broken identity references.
- `MapsThroughTime.ts` (P8-07) — the political map at any past date, reconstructed from claim `sinceTick` + the exact ceded cells/claim ids `War.endWar` now records.
- `CausalHistory.ts` (P8-08) — upstream causal chains AS RECORDED (traceBack), oldest first, honestly showing absence where no cause was recorded.
- `ProseSummaries.ts` (P8-09) — template-assembled prose over structured history only; every line names the exact recorded event ids it summarizes.
- `Search.ts` (P8-10) — every historical record involving a target (participation + ownership payloads + component-held references), deduplicated per (event, role).

The phase's one amendment to existing machinery (ARCHITECTURE_CONTRACT §24, documented in `EventLog.ts` itself): `RecordedEvent` gained an optional JSON-plain `data` payload (validated recursively on record AND restore, snapshot version 1 -> 2), written by the real mutation sites so past states are reconstructible — founding state, migration counts, disaster consequences, cession cell lists, ownership transfers, item moves, death names.

## The gate

`tests/gate/p8-gate-chronicle.test.ts` proves the roadmap's own sentence — *"A world simulated for centuries becomes intelligible as a network of inspectable lives, places, objects, causes, and events. Playable state: interactive historical archive"* — in three acts:

1. **The world lives**: generated region, six settlements, polities/households/orgs, two generations of REAL births (real lodge room, real reproduction eligibility), a REAL artwork, a real raid — then 120+ ticks of the real `tickPolitics` loop producing trade, migration, battles, war, cession, civilization rise/fall.
2. **The archive reads it**: events (whole-history pagination with no gap/duplicate), lives (genealogy; figure pages with every source resolving), places (site histories; population reconstructions landing exactly on live state), objects (the artwork's recorded life), causes (claim → declaration → war end), and the network (one declaration in both sites' histories, both polities' searches, the war query; maps before/after differ on exactly the ceded cells).
3. **Centuries of deep time**: 5.76M ticks through the real `advanceWorldTicks`; every record-backed fact bit-for-bit identical, every prose line still resolves, every stable id still answers.

## What the gate test found (the joint audit's seventh finding)

`FigurePages` cited an `identity` component that does not exist for unnamed beavers, and left EMPTY source lists on three claims (Reputation, Historical significance, Recorded history) for beavers with no recorded deeds — violating the page's own "every claim carries resolving sources" contract. Fixed: those claims now cite the registry honestly (the registry's own knowledge of the person is the source for an absent name, a zero score, an empty history). Regression: `tests/unit/phase78CriticRegressions.test.ts` case 7, verified to fail on the pre-fix code.

## Critic findings in Phase 7 machinery (joint audit)

Six findings — two Critical, three Moderate, one Minor — each fixed and regression-covered (`tests/unit/phase78CriticRegressions.test.ts` cases 1-6, each verified to fail on the pre-fix code). Full account: `TASKS.md`'s Phase 7 Gate section and `docs/PHASE7_HANDOFF_REPORT.md`.

## Known limitations (triaged, documented — none gate-blocking)

- Death events at the detailed scale do not name their site, so a region-scale collapse chains to the site-naming population-loss record (exodus/raid/disaster), not to an individual death event.
- `equipUnit` distributes at most one item per member per pass; a large org with scarce assets equips its lowest-id members first (deterministic, data-tunable later).
- Figure-page "Artworks" lists only live artworks (destroyed artworks remain visible through their own artifact histories).
- Chronicle is a read layer over recorded history: facts never recorded (pre-payload events, pre-recorder saves) are honestly reported as absent, never guessed.

## Verification status

- Fast suite: **1203/1203 across 207 files**; `npm run typecheck` clean.
- Gate suite: `npm run test:gate` green (p2 soak, p4, p5, p6, p7, p8 gate tests).
- Regressions: 7 cases, each verified to fail on the reverted pre-fix code.

Phase 9 (Wayfarer) is now unblocked.
