# Damn Beavers — Three.js World Layer Agent Prompt

You are now building the **Three.js presentation/world layer for Damn Beavers**, a completed Dwarf Fortress-inspired beaver civilization simulator whose authoritative systemic simulation already exists and has passed its Phase 0–11 gates.

Read before touching code:

1. `AGENTS.md`
2. `DAMN_BEAVERS_MASTER_ROADMAP.md`
3. `docs/ARCHITECTURE_CONTRACT.md`
4. `docs/BUILD_MANUAL.md`
5. `TASKS.md`
6. `threejs_layer.md`
7. the existing `src/sim/**` implementation and tests

The simulation is already the game. **Do not rebuild it in Three.js.**

The Three.js client is a read-only presentation and interaction layer over the authoritative simulation:

```text
player input
  -> presentation command
  -> authoritative simulation
  -> immutable render projection / deltas
  -> Three.js world
```

A mesh is not a tree. An animation is not a job. A particle is not water. A UI button may submit an intent, but it may never directly mutate authoritative game state.

The completed simulation's laws remain absolute:

- systems, not scripted outcomes;
- simulation is authoritative;
- stable persistent identity;
- causality is inspectable;
- jobs are intentions, not puppeteering;
- physical resources are physical;
- hydrology changes navigation through reality;
- deterministic behavior where practical;
- persistence is part of every system.

## Mission

Build the actual intended 3D game: Dwarf Fortress-class systemic depth experienced as a meticulous, living, modern Three.js world.

The visual target is not a tech demo and not "some cubes over the sim." It should feel like a finished high-end strategy/simulation world:

- Dwarf Fortress depth and inspectability,
- Timberborn-quality water/settlement readability as a minimum reference,
- modern high-end terrain, vegetation, lighting, materials, weather and animation,
- seamless close inspection of individual beavers,
- multi-level excavation/cutaways,
- settlement-scale management,
- region/world-scale Chronicle and Wayfarer views,
- rich causal inspection,
- extreme systemic legibility.

Use current Three.js. Prefer a **WebGPU-forward renderer using `WebGPURenderer`/TSL with WebGL 2 fallback**, while keeping the renderer abstract enough to test fallback paths. Use modern instancing/batching, chunking, LOD, worker meshing, compressed assets, spatial culling, and disciplined GPU budgets.

## Architecture first

Before visual polish, establish a hard boundary:

```text
src/sim/**             authoritative, renderer-free
src/presentation/**    immutable projections, queries, commands, bridges
src/render3d/**        Three.js-only rendering
src/ui/**              UI over presentation contracts
```

Add tests/linting so `src/render3d/**` cannot casually import arbitrary simulation internals.

Create a versioned presentation contract with:

- stable entity IDs,
- chunk revisions,
- create/update/remove entity patches,
- terrain/strata projection,
- water depth/surface/flow facts,
- environment facts,
- inspect/query APIs,
- causal/history APIs,
- command intents.

Build a `SimBridge` abstraction so the renderer can work with an in-process development bridge, Web Worker simulation if compatible, or Node/WebSocket topology if required. Do not contaminate `src/sim/**` with DOM, GPU, or Three.js dependencies.

Rendering may interpolate between authoritative states for smoothness, but interpolation must never feed back into simulation.

## FIRST GATE: One Pond in Three Dimensions

Do not start by spreading across the whole game.

Your first goal is to reproduce the original Pond Test through the real 3D client, end to end:

1. render a real generated watershed;
2. render real terrain and the real stream;
3. render the seven real persistent beavers;
4. inspect real cells/entities by stable ID;
5. designate a real tree through the normal command path;
6. let ordinary AI choose the cutting job;
7. show the real tree transition to real physical log entities;
8. show a real beaver haul a real log;
9. place a dam order through the normal command path;
10. show materials physically delivered;
11. show the dam becoming complete from authoritative construction state;
12. render upstream water rising because the actual hydrology rises;
13. show routes changing because the actual navigation state changes;
14. show ecology reacting;
15. expose the real causal chain with a "Why?" inspector;
16. save during the scenario;
17. reload;
18. reconstruct the same 3D world solely from restored simulation state.

No fake pond. No scripted beaver. No renderer-owned construction. No water shader pretending the upstream depth changed.

Do not advance until this gate is true.

## Then implement `threejs_layer.md` phase by phase

Use its R0–R11 dependency order:

- R0 Presentation Contract & Renderer Constitution
- R1 3D Pond Test
- R2 Terrain, Strata, Excavation & Streaming
- R3 Hydrology Visual System
- R4 Vegetation, Ecology & Environmental Change
- R5 Beavers, Animals & Animation
- R6 Structures, Industry, Items & Infrastructure
- R7 Player Control Surface, UI & Causality
- R8 Lighting, Weather, Atmosphere & Sensory World
- R9 Chronicle, Wayfarer & Multi-scale World
- R10 Performance, Scalability & Platform Hardening
- R11 AAA Readability / Final 3D World Gate

Create `THREEJS_TASKS.md` and maintain it as an evidence ledger.

For every task:

1. implement the smallest correct production mechanism;
2. write unit/integration tests;
3. preserve all existing headless simulation tests;
4. create a deterministic render scene/camera if visual;
5. capture screenshots/video;
6. send the result to an independent harsh critic sub-agent;
7. fix every substantive defect;
8. add regression tests;
9. record evidence in `THREEJS_TASKS.md`;
10. only then mark it done.

## Fan out aggressively

Fan out sub-agents by independent subsystem when dependencies allow.

Good parallel tracks include:

- presentation contracts / bridge,
- terrain meshing / chunk streaming,
- water rendering,
- vegetation,
- creature rig/animation pipeline,
- structures/items,
- UI/inspection,
- lighting/weather,
- world map/history,
- performance instrumentation,
- visual QA.

Do not let parallel agents invent conflicting architecture. The presentation contracts and renderer laws are shared constraints.

Use `/loop`, ultracode, and parallel sub-agents where supported.

## Terrain

The world is truly 3D. Do not reduce it to a decorative heightmap.

Build a chunked exposed-surface/voxel-style mesher capable of:

- cliffs,
- strata,
- digging,
- rooms,
- caves,
- tunnels,
- stairs/ramps,
- multi-story structures,
- dynamic chunk rebuilds,
- slice/cutaway views.

Use worker meshing and LOD.

Add elevation slicing, transparent-above cutaway, underground view, selection x-ray, and debug grid modes.

## Water

Water is the signature visual system.

Surface height and presence must come from actual hydrology.

Use real depth/flow/temperature/composition facts to drive:

- surface geometry,
- depth absorption,
- flow-aligned detail,
- shoreline wetness,
- foam at real gradients/obstructions,
- rapids,
- falls,
- underwater appearance,
- ice,
- contamination/turbidity.

Visual micro-motion may be synthetic. Macro hydraulic state may not be.

Maintain a hydrology debug overlay showing the source cells/vectors beneath the pretty water.

## Beavers and animals

Use production glTF rigs and a stable-ID `EntityVisualController`.

Animation is a projection of actual state:

- walk/run,
- swim,
- chop,
- build,
- haul,
- carry,
- craft,
- eat,
- drink,
- sleep,
- social,
- injury,
- combat,
- death.

A carried log must remain the same persistent item ID while visually attached to a beaver.

Root motion/IK may improve visuals but may never become authoritative movement.

Eventually add foot placement, tool contact, carried-object alignment, tail/head motion, and waterline-aware animation.

## Vegetation/ecology

Use instancing/batching.

Trees and plants must visibly reflect real:

- species,
- age,
- health,
- season,
- hydration,
- flooding,
- fire,
- regrowth.

The player should be able to look at a landscape and understand that ecology has changed.

## Structures and physical resources

Construction must visibly communicate:

```text
blueprint
-> materials reserved/delivered
-> partial build
-> complete structure
-> damage/destruction
```

Show real physical logs/items moving through stockpiles, workshops, trade, construction, and hauling.

Optimize with instance/batch lookup tables that preserve stable IDs.

## Camera

Build:

- management orbit/pan/zoom,
- smooth selection focus,
- follow camera,
- close inspect camera,
- free camera,
- world-scale camera,
- elevation/cutaway controls.

The player should be able to go from a watershed overview to following one beaver carrying one log without losing context.

## UI

Keep the 3D world primary and reveal density on demand.

Required:

- time/pause/speed,
- selection,
- entity inspector,
- cell inspector,
- construction/designations,
- labor/jobs,
- zones/stockpiles,
- alerts,
- save/load/settings,
- Chronicle,
- Wayfarer,
- world map,
- debug overlays,
- causal **Why?** queries.

Any major visible state should be inspectable.

## Chronicle and Wayfarer

Do not make these disconnected menus.

Render history spatially:

- timeline events,
- participants,
- sites,
- jump-to-location,
- past/present overlays,
- territory/polity history.

Render world travel spatially:

- sites,
- rivers,
- roads,
- territories,
- armies,
- trade,
- migration,
- routes.

Preserve stable entity/site identity as representation changes between world and local scales.

## Performance

This sim can contain far more entities than should be individual Three.js objects.

Use:

- chunk meshes,
- `InstancedMesh`,
- `BatchedMesh`,
- LOD,
- frustum/spatial culling,
- render-interest sets,
- worker geometry,
- update throttling,
- quality tiers,
- render-scale control.

Track CPU, GPU, memory, draw calls, triangles, geometry update time, projection time, and simulation time separately.

Build deterministic stress scenes for:

- dense forest,
- huge item pile,
- large colony,
- deep excavation,
- flood,
- fire,
- battle,
- world map.

Never tie simulation correctness to FPS.

## Visual quality loop

Take the spirit of the original Claude-of-Duty build process seriously:

**fan out, render, inspect, criticize, fix, repeat.**

Every major visual subsystem gets its own independent critic agent.

The critic should be harsh and specifically look for:

- prototype-grade geometry,
- repetitive procedural assets,
- flat lighting,
- plastic materials,
- weak water,
- scale errors,
- clipping,
- floating objects,
- bad animation blending,
- unreadable selection,
- ugly LOD transitions,
- excessive draw calls,
- "Three.js demo" appearance,
- visual states that lie about simulation state.

Create fixed deterministic screenshot suites.

Blind-compare our screenshots against carefully chosen references for the relevant quality:

- Dwarf Fortress for depth/inspectability/cutaway readability,
- Timberborn for beaver settlement/water readability,
- high-quality modern settlement/strategy games for terrain and built-world cohesion,
- real river/forest/geology references for natural materials.

Do not copy proprietary art. Compare quality, readability, composition, materiality, and polish.

If the critic can immediately tell ours is the prototype because of an obvious deficiency, loop on it.

## Simulation truth audit

Beauty is not enough.

For visual gates, sample visible objects and prove:

- the stable ID exists in the sim;
- position matches authoritative state;
- terrain material matches source facts;
- water exists only where simulated;
- construction stage is real;
- carried items are the real item IDs;
- weather matches the sim;
- selection resolves to the correct entity/cell;
- save/load reconstructs visuals without hidden renderer state.

## Do not stop at scaffolding

Do not respond with a plan only.

Read the repo, create the ledger, implement the first unblocked task, run tests, render it, visually inspect it, fan out the next independent work, and keep going.

Do not declare success because "the architecture is in place."

Do not leave a beautiful disconnected demo next to the simulation.

The final gate is:

> From world scale down to one working beaver, the player can see, inspect, command, and understand the same authoritative systemic world that passes the headless Damn Beavers simulation gates; every important visible thing has persistent identity, every important action goes through real simulation commands, every major visual state can be traced to simulated causes, and the 3D presentation is beautiful and performant enough that the renderer no longer feels like a visualization prototype but like the intended game.

Fan out sub-agents. `/loop` on every major subsystem. Use an independent harsh visual critic. Blind-compare quality wherever possible. Preserve simulation truth above all else. Do this in Three.js. Ultracode until Damn Beavers is no longer a headless masterpiece with a renderer attached, but a world you can inhabit.
