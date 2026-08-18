# THREEJS_TASKS.md — Damn Beavers Three.js World Layer Ledger

Evidence ledger for the Three.js presentation/world layer. Rules: `docs/webpage/threejs_layer.md` R0-R11.
Every DONE row has: implementation, tests, deterministic capture (if visual), critic pass, regression tests.

Tooling: `npm run web:dev` (dev server), `npm run web:build`, `npm run capture [suite...]` (deterministic screenshots into docs/webpage/shots/), `npm run check:save-load` (pixel-exact save/load visual reconciliation), `npm run check:picking` (live synthetic-pointer picking proof).

## R0 — Presentation Contract & Renderer Constitution

| ID | Task | Status | Evidence |
|----|------|--------|----------|
| R0-01 | threejs_layer.md / renderer laws in repo | DONE | docs/webpage/threejs_layer.md |
| R0-02 | audit browser compatibility of simulation imports | DONE | grep audit: `src/sim/**` has zero node/DOM imports (only relative `.js`); both Mode A (in-process) and Mode B (worker) viable. Chose Mode A first (LocalSimBridge), worker-ready via SimBridge interface. |
| R0-03 | create src/presentation/contracts | DONE | contracts/: render-frame.ts, render-entity.ts, render-chunk.ts, render-events.ts, commands.ts, queries.ts, frame-merge.ts (versioned, JSON-plain, delta patches) |
| R0-04 | immutable render projection | DONE | projection/: render-projection.ts (frames), entity-projection.ts (per-entity revisions + honest activity classification), chunk-projection.ts (content-hash revisions). Test: bridge.test.ts "renderer cannot mutate simulation through frames" |
| R0-05 | stable ID render registry | DONE | render3d/entities/registry/entity-visual-registry.ts + instanced pools with slot<->stable-id lookup (swap-back dense compaction). Picking resolves instanceId -> stable entity id (proven live, see R1-09) |
| R0-06 | command adapter | DONE | LocalSimBridge.submitCommand maps intents -> designateTreeCut / designateConstruction / clock / persistence. Round-trip proven in bridge.test.ts + pondGate.test.ts |
| R0-07 | inspection/query adapter | DONE | inspectEntity/inspectCell (DebugInspector) + whyAboutEntity/whyUnreachable/whyWaterRose (CausalExplanation) as JSON-plain views; alerts via TextUI |
| R0-08 | SimBridge | DONE | bridge/sim-bridge.ts interface (frames, chunks, commands, queries, save/load, drainFrames) |
| R0-09 | local/worker topology from audit | DONE | bridge/local-bridge.ts (Mode A in-process); clock.onTick drives stepPondScenarioSystems (same composition as headless tests) |
| R0-10 | import-boundary lint/test | DONE | tests/presentation/importBoundary.test.ts (3 tests): sim has no three/DOM/presentation imports; presentation three-free; render3d never imports sim internals |
| R0-11 | deterministic render-test mode | DONE | ?deterministic=1: forced WebGL2 backend, pixelRatio 1, pinned visual clock, fixed camera poses, explicit tick driving |
| R0-12 | renderer bootstrap + blank world scene | DONE | render3d/renderer/create-renderer.ts (WebGPURenderer, forceWebGL fallback), app/scene-root.ts stable roots |

**R0 gate**: Three.js displays frames from the real pond world; clicking a projected entity returns its stable sim ID; renderer mutation cannot alter sim state. PROVEN (bridge.test.ts 7/7, picking-check PASS).

## R1 — The 3D Pond Test

| ID | Task | Status | Evidence |
|----|------|--------|----------|
| R1-01 | camera and controls | DONE | camera/camera-controller.ts: orbit/pan/zoom, damping, pitch limits, follow, focus, drag-pan, WASDQE keys, wheel zoom |
| R1-02 | cell-to-world coordinate mapping | DONE | util/coordinates.ts; water slab-top render mapping documented in water-manager.ts |
| R1-03 | first terrain chunk renderer | DONE | world/terrain/: voxel-mesher.ts (exposed-face + per-vertex AO + diagonal flip, 5 headless tests), terrain-chunk-manager.ts (two-pass revision rebuilds, border-safe), terrain-material.ts (TSL: grass-by-real-moisture, strata bands, dam log-courses, waterline wetness+gloss) |
| R1-04 | water surface from authoritative depth | DONE | world/water/: water-surface.ts (surface quads w/ corner averaging, fall curtains, edge skirts; flow from real surface gradient; foam from real gradient/obstruction), water-material.ts (TSL: Beer-Lambert depth absorption, shared analytic sky reflection, fresnel, sun glint, shaded foam), waterfalls/skirts from real height deltas only |
| R1-05 | tree instances | DONE | vegetation/tree-geometry.ts (procedural aspen/willow) + tree-instances.ts (InstancedMesh per species, growth-scaled, health tint via aHealth, id-keyed jitter, wind sway). NOTE: TSL positionNode must compose on positionLocal (learned the hard way: replacing it drops instance transforms) |
| R1-06 | beaver visuals | DONE | entities/beavers/beaver-visual.ts: articulated procedural rig + activity-driven animation (walk/swim/chop/haul/build/eat/drink/sleep/idle/dead), interpolation between authoritative cells, splash on real swim entry |
| R1-07 | log/item visuals | DONE | entities/items/log-instances.ts: instanced pool, mass-scaled; carried logs attach to the carrier's mouth anchor preserving the same stable item id |
| R1-08 | dam/structure visuals | DONE | entities/structures/construction-visuals.ts: ghost (awaiting-materials), rising fill by real workDone; completed dams render AS TERRAIN (applyDamSegment cells) through the mesher |
| R1-09 | picking | DONE | interaction/picking.ts: entity (beaver rigs + tree/log instances -> stable ids) then cell/water-column. tools/visual/picking-check.mjs: synthetic clicks select a stacked beaver and create a real cut designation -- PASS |
| R1-10 | tree designation command | DONE | cut-tree tool -> designate-tree-cut -> real designation; colony AI fells it (pondGate steps 5-7) |
| R1-11 | dam blueprint command | DONE | build-dam tool -> designate-construction; ghosts at real sites (pondGate steps 9-11) |
| R1-12 | time controls | DONE | pause/resume/1x/4x/8x drive the real SimulationClock; HUD day/HH:MM from real dayNightPhase; day/night lighting from authoritative phase |
| R1-13 | selection inspector | DONE | ui/web/hud.ts: entity inspector (needs/health/plant/log/construction/history), cell inspector (material/water/occupants), Why? causal panel, alerts, event toasts |
| R1-14 | save/load rehydration | DONE | Law R8 proven PIXEL-EXACT: tools/visual/save-load-check.mjs captures a deterministic scene, saves, advances 400 ticks, loads -> bit-identical frame. (Found+fixed: fullSync flag was missing -- post-save-point saplings lingered as ghost instances) |
| R1-15 | Pond Test end-to-end visual capture | DONE | docs/webpage/shots/: pond-start, stream-close, beaver-close, logging, dam-early, dam-risen, night -- all deterministic (?deterministic=1, seed m0-pond-test) |

**R1 gate**: tests/presentation/pondGate.test.ts performs the full 18-step arc through bridge commands (watershed render data, inspect by stable id, designate -> AI fells -> real logs -> haul -> dam -> upstream rise -> routes change -> ecology reacts -> Why? -> save -> reload -> identical projection). PASS.

## Sim fixes driven out by this work (with regression tests)

1. `PlantLifecycle.isPlantableGround`: out-of-bounds throw when a mature tree beside top-layer/edge ground reproduced (tests/presentation/plantLifecycleCeiling.test.ts). Latent until a full colony tick ran on the watershed map.
2. Ghost visuals after load (renderer-side): added `fullSync` frame contract.

## Scenario composition notes (honesty record)

- `POND_SOURCE_INFLOW_PER_TICK = 0.05`: tuned empirically (1.0/tick M0 burst rate floods the whole map by ~tick 2400 and drowned the colony; 0.05 holds a living stream with natural pools indefinitely and ponds visibly behind a dam within a game-day).
- Driver applies completed dam-segment constructions to terrain via the same `applyDamSegment` the M0 test calls (no automatic caller exists in the sim); application defers one tick while a live entity occupies the cell being filled (mass-burial bug found by soak: 4 builders entombed).
- Fresh watershed trees start as age-0 seedlings and self-thin ~half within a day; the scenario matures the starting forest (ageTicks 20000, health 1) exactly like the M0 acceptance test's buildM0State.
- Observed sim balance note (NOT tuned here, flagged for the sim team): wildfire ignition is fierce -- ~330 ignitions over 4 game-days cut the forest from ~680 to ~480 trees in the dam-risen capture.

## Known follow-ups (R2+)

- Waterfall curtains verified in code but not yet framed in a capture; underwater camera view (R3-10).
- Tree canopy LOD / far-impostor pass (R4-11); current 633-tree forest = ~500k tris (fine on GPU, heavy for SwiftShader captures at 13fps).
- Cutaways/elevation slice (R2-07), worker meshing (R2-08), floating origin (R2-10).
- glTF production rigs replace procedural beaver/trees at the R5 asset gate.
- Fire/burn visual states (R4-08) matter now that wildfires are visibly common.
- WebGPU backend smoke capture (captures currently run the forced-WebGL deterministic path; the WebGPU path is the default in normal play).

R2-R11: not started. See docs/webpage/threejs_layer.md for the full plan.
