# Damn Beavers — Three.js World Layer

## Status

**Purpose:** turn the completed authoritative Damn Beavers simulation into a meticulous, inspectable, performant 3D world without moving game authority into the renderer.

**Core premise:** the simulation is already the game. The Three.js layer is a spatial presentation, interaction, camera, audio, and player-control layer over that game.

The renderer must never become a second simulation.

---

# 0. Mission

Damn Beavers already has the systemic depth: terrain and strata, hydrology, navigation, physical items, beavers and other creatures, ecology, construction, industry, society, history, politics, regions, travel, Chronicle, Wayfarer, and the post-DF systems.

The Three.js phase has one job:

> Make every important simulated fact legible, beautiful, spatially coherent, and interactable in a living 3D world.

The target is not merely "Dwarf Fortress in 3D." It is:

- Dwarf Fortress-class systemic density.
- Timberborn-class water and settlement legibility.
- Modern high-end environment rendering.
- A camera that can move seamlessly from landscape scale to individual beaver scale.
- A renderer that makes emergent causality visible rather than hiding it.
- A UI that can control the real simulation without puppeteering it.
- A world in which a player can visually follow a tree becoming logs, logs being hauled, a dam rising, water backing up, routes flooding, vegetation changing, animals responding, settlements adapting, and history recording the result.

---

# 1. Non-negotiable renderer laws

These extend the existing AGENTS.md constitution. They do not replace it.

## R1 — Simulation authority is absolute

`src/sim/**` remains authoritative.

Three.js may observe simulation state and submit commands. It must not own authoritative:

- entity positions,
- inventories,
- job completion,
- water quantity,
- damage,
- construction state,
- pathing,
- time,
- weather,
- relationships,
- political state,
- history,
- resources,
- or persistence.

A mesh is not an entity. An animation is not an action. A particle is not water.

## R2 — Every rendered thing maps back to stable simulation identity

Any selectable creature, plant, item, structure, vehicle, site, or other important object must map to a stable simulation ID.

Never use:

- array index as identity,
- Three.js object identity as game identity,
- transient instance index without an ID lookup table.

## R3 — Every player action becomes a simulation command

The interaction path is:

`input -> pick -> stable entity/cell/site ID -> command intent -> simulation validation -> authoritative state change -> render update`

The renderer never directly "finishes" an order.

## R4 — Visual interpolation may smooth truth, never replace truth

The simulation can tick at its deterministic cadence while the renderer runs at display rate.

Interpolation may smooth:

- creature motion,
- carried-item motion,
- doors,
- water surface appearance,
- foliage,
- camera motion.

It may not create authoritative movement or change outcomes.

## R5 — Derived visuals must be reconstructible from authoritative facts

Examples:

- wet ground may derive from water depth / recent inundation;
- muddy water may derive from sediment or contamination;
- a stressed beaver pose may derive from current state;
- smoke may derive from an actual fire;
- foam may derive from actual flow gradients / obstruction;
- snow cover may derive from real weather and temperature.

Do not create fake gameplay-significant conditions for visual drama.

## R6 — Renderer reads through presentation contracts, not arbitrary ECS internals

Create a narrow presentation boundary.

Recommended import law:

- `src/sim/**` may know nothing about Three.js.
- `src/presentation/**` may adapt/query the simulation.
- `src/render3d/**` may import presentation contracts but may not import simulation internals directly.
- `src/ui/**` talks to presentation commands/queries, not mutable simulation structures.

## R7 — Headless must remain first-class

The entire existing headless test suite must continue to run without browser, DOM, GPU, WebGL, WebGPU, or Three.js dependencies.

## R8 — Save/load must rehydrate visuals from state, not serialize meshes

Do not save Three.js scene objects.

After load:

1. simulation restores,
2. presentation snapshot is rebuilt,
3. render registries reconcile,
4. meshes/instances are recreated or updated from authoritative IDs.

## R9 — One world, several visual scales

Local watershed, settlement, region, and world views are views of the same authoritative world.

Do not fork separate "map entities" and "3D entities" as different game objects.

## R10 — Visual debugging is a feature

Every subsystem should have overlays that expose the simulation beneath the beauty.

A sophisticated simulator must be able to show why it looks the way it does.

## R11 — Deterministic screenshot mode

Provide a deterministic visual test mode:

- fixed seed,
- fixed simulation tick,
- fixed camera transform,
- fixed exposure,
- deterministic procedural visuals where possible,
- disabled temporal noise,
- fixed resolution.

This is required for visual regression and critic comparison.

## R12 — No decorative architecture debt

Do not build a beautiful demo that bypasses the real sim.

The first vertical slice must use the actual Pond Test data path end to end.

---

# 2. Architectural boundary

## 2.1 Recommended top-level shape

```text
src/
  sim/                         # EXISTING authoritative game; stays renderer-free

  presentation/
    contracts/
      render-frame.ts
      render-entity.ts
      render-chunk.ts
      render-events.ts
      commands.ts
      queries.ts
    adapters/
      sim-read-adapter.ts
      command-adapter.ts
      history-adapter.ts
      world-scale-adapter.ts
    bridge/
      sim-bridge.ts
      local-bridge.ts
      worker-bridge.ts
      websocket-bridge.ts
    projection/
      render-projection.ts
      chunk-projection.ts
      entity-projection.ts
      environment-projection.ts

  render3d/
    app/
      bootstrap.ts
      game-loop.ts
      scene-root.ts
    renderer/
      create-renderer.ts
      render-settings.ts
      frame-profiler.ts
      quality-manager.ts
    world/
      origin/
      streaming/
      terrain/
      strata/
      water/
      vegetation/
      structures/
      roads/
      world-map/
    entities/
      registry/
      beavers/
      animals/
      items/
      vehicles/
      effects/
    materials/
      material-registry.ts
      terrain-materials.ts
      water-materials.ts
      vegetation-materials.ts
      structure-materials.ts
    lighting/
    atmosphere/
    weather/
    particles/
    audio/
    camera/
    interaction/
    overlays/
    debug/
    assets/
    workers/

  ui/
    hud/
    inspector/
    commands/
    construction/
    labor/
    zones/
    chronicle/
    wayfarer/
    world-map/
    settings/
    accessibility/

tests/
  presentation/
  render3d/
  visual/
  perf/

public/
  assets/
    models/
    textures/
    audio/
```

The exact folder names may adapt to the repository, but the boundary must survive.

---

# 3. Presentation contract

Do not make Three.js scrape raw component stores each frame.

Create a read-only presentation projection with versioned contracts.

## 3.1 Render frame

A render frame should conceptually contain:

```ts
interface RenderFrame {
  schemaVersion: number;
  tick: string | number;
  simTime: number;
  worldRevision: number;

  focus: RenderFocus;
  environment: RenderEnvironment;

  chunkPatches: RenderChunkPatch[];
  entityPatches: RenderEntityPatch[];
  eventPatches: RenderEventPatch[];

  removals: StableEntityId[];
}
```

Use the repository's existing types where possible. This is a boundary concept, not a requirement to duplicate all state.

## 3.2 Chunk projection

Spatially large state should be chunked and revisioned.

A chunk projection may expose:

- cell bounds,
- terrain occupancy,
- exposed material faces,
- elevation,
- strata/material IDs,
- water surface/depth/flow fields,
- soil moisture,
- snow/ice,
- vegetation instances,
- static structures,
- zone/territory overlays,
- revision numbers.

The render layer should rebuild a chunk only when its relevant revision changes.

## 3.3 Entity projection

Dynamic/inspectable entities should expose only facts necessary to render and inspect them:

- stable ID,
- kind,
- authoritative position,
- orientation or facing facts,
- velocity / locomotion facts if present,
- size/bounds,
- species/type/material,
- health/condition presentation facts,
- current job/activity,
- carried item IDs,
- visible equipment,
- visual tags derived from real components,
- selection/inspection metadata.

Do not create a giant duplicate ECS in the renderer.

## 3.4 Delta model

Prefer `create / update / remove` patches over full-world copies every frame.

Every dynamic presentation record should have a revision or change mask so the renderer can avoid unnecessary GPU/object updates.

## 3.5 Queries

The Three.js/UI layer should be able to ask the presentation layer for:

- inspect entity,
- inspect cell,
- inspect world/site,
- causal explanation,
- path/accessibility explanation,
- historical timeline,
- material facts,
- job/order facts,
- relationship/society facts,
- territory/polity facts,
- world travel facts,
- overlays.

Return immutable/copy-safe data.

## 3.6 Commands

Commands must remain intents.

Examples:

```text
DesignateTree
DesignateDig
PlaceConstructionBlueprint
CancelDesignation
CreateZone
SetLaborPolicy
SetWorkshopOrder
FollowEntity
TravelToSite
Pause
SetSpeed
Save
Load
```

Use actual existing command types whenever they exist. Do not invent duplicate mechanics.

---

# 4. Runtime topology

Build the bridge so the renderer is not coupled to one execution topology.

## Mode A — Local/in-process development

Fastest path for initial integration if the current simulation can be bundled safely.

## Mode B — Web Worker simulation

Preferred browser topology if simulation code is browser-compatible:

```text
UI / Three.js main thread
          |
      SimBridge
          |
     Web Worker
          |
     authoritative sim
```

Benefits:

- rendering cannot stall simulation as easily,
- simulation cannot stall pointer/camera UI as easily,
- clean message boundary encourages immutable contracts.

## Mode C — Node simulation + WebSocket client

Fallback / large-world topology if Node-only dependencies make browser-worker execution undesirable:

```text
Browser Three.js client
          |
   binary/JSON protocol
          |
      Node server
          |
     authoritative sim
```

Build `SimBridge` so all three modes can share the same renderer.

---

# 5. Render loop and time

There are two clocks:

1. authoritative simulation time,
2. presentation/display time.

Never conflate them.

Recommended frame sequence:

```text
receive latest authoritative patch
        ->
update render registries
        ->
interpolate dynamic visuals between known authoritative states
        ->
update camera
        ->
update non-authoritative visual simulations
        ->
cull / LOD
        ->
render
        ->
record frame timings
```

Visual-only simulations may include:

- foliage wind,
- water micro-normal motion,
- dust motes,
- rain splashes,
- foam particles,
- camera springs,
- ambient insects.

They may not feed authoritative state back into the game.

---

# 6. Coordinates and world scale

The simulation already uses a Y-up 3D world. Preserve that convention.

## 6.1 Integer simulation coordinates, floating render coordinates

Keep authoritative cell/world positions in their existing precise representation.

Convert to Three.js local floats only at the rendering boundary.

## 6.2 Floating origin

For large regions/world travel, use origin rebasing.

Store:

- authoritative world coordinate,
- current render origin,
- local Three.js coordinate.

When focus crosses a threshold, rebase the scene around the camera/focus without modifying simulation coordinates.

## 6.3 Scale modes

Support at least:

### Local mode
Beavers, logs, rooms, workshops, water, terrain, trees.

### Settlement/site mode
Whole lodge/settlement, farms, dams, transport, nearby ecosystem.

### Region/world mode
Sites, rivers, roads, territories, armies, trade, migrations, travel.

The camera and renderer may change representation by scale, but identity remains continuous.

---

# 7. Renderer foundation

Use current Three.js with a renderer abstraction.

Preferred path:

- `WebGPURenderer` primary.
- automatic WebGL 2 backend/fallback.
- TSL/node materials for custom modern materials.
- feature flags for effects that cannot run acceptably on fallback hardware.
- a forced-WebGL CI/dev mode.

Do not allow renderer choice to leak into simulation code.

## 7.1 Core scene

Create stable roots:

```text
Scene
  WorldRoot
    TerrainRoot
    WaterRoot
    VegetationRoot
    StructuresRoot
    EntityRoot
    EffectsRoot
  Overlay3DRoot
  DebugRoot
```

## 7.2 Quality tiers

At minimum:

- Low
- Medium
- High
- Ultra

Quality can alter:

- render scale,
- shadows,
- water reflection/refraction quality,
- vegetation density/LOD,
- particle counts,
- post-processing,
- shadow distance,
- anisotropy,
- volumetrics.

Quality may never hide gameplay-significant entities or states.

---

# 8. Terrain, digging, and strata

A Dwarf Fortress-derived game cannot use a simple decorative heightmap.

The terrain renderer must handle true 3D occupancy and excavation.

## 8.1 Hybrid surface/voxel mesher

Build chunk meshes from exposed solid/empty boundaries.

Requirements:

- only exposed faces are rendered;
- merge coplanar compatible faces where possible;
- exposed vertical cliffs show correct strata/material;
- digging reveals newly exposed interior faces;
- caves/tunnels/underground spaces render correctly;
- mesh generation runs off the main render path when expensive;
- chunk mesh rebuild is driven by chunk revisions.

## 8.2 Terrain material system

Materials should derive from simulation material properties.

Visual parameters may include:

- base color family,
- roughness,
- wetness response,
- normal detail,
- subsurface tint for soil,
- rock variation,
- sediment,
- snow/ice coverage.

Do not make renderer logic depend on hard-coded material identity when the simulation deliberately uses properties.

## 8.3 Cutaway and level controls

Required for deep simulation legibility:

- elevation slice,
- hide-above plane,
- hide-below plane,
- x-ray selected entity,
- underground cutaway,
- transparent upper stories,
- lock to selected floor,
- reveal path to selection.

This should make subterranean and multi-story behavior understandable without abandoning 3D.

## 8.4 LOD

Near:
- full exposed geometry and material detail.

Mid:
- merged chunk geometry and reduced material complexity.

Far:
- simplified terrain surface / macro geometry.

World scale:
- region representation, not millions of local cells.

---

# 9. Water and hydrology

Water is one of Damn Beavers' signature systems. It must be both beautiful and honest.

## 9.1 Authoritative geometry

Water surface height and presence derive from real simulated water state.

Never paint water into a dry cell to make a river prettier.

## 9.2 Water rendering inputs

The presentation projection should expose enough to derive:

- surface height,
- depth,
- flow direction,
- flow magnitude,
- obstruction/contact,
- temperature,
- ice state,
- contamination/composition where available,
- sediment/turbidity where available.

## 9.3 Visual layers

Build:

- smooth surface geometry over discrete hydrology cells,
- animated normal detail,
- depth-based absorption,
- shoreline wetness,
- foam around high gradients/obstructions,
- current streaking aligned to authoritative flow,
- rapids,
- falls where neighboring surface heights justify them,
- underwater color/visibility,
- ice surfaces and breakup state,
- optional caustics near shallow water.

Micro-motion is visual only.

## 9.4 Dam truth test

A canonical screenshot sequence must prove:

1. stream flowing before construction,
2. logs physically delivered,
3. dam geometry completing,
4. upstream surface rising,
5. downstream behavior changing,
6. path accessibility changing,
7. ecology reacting over time.

The exact simulation state should be inspectable alongside the rendered frame.

---

# 10. Vegetation and ecology

## 10.1 Trees and plants

Use instancing/batching aggressively.

Visual variation may derive from:

- species,
- age,
- health,
- season,
- hydration,
- fire damage,
- disease,
- flooding,
- growth stage.

## 10.2 Tree lifecycle

The 3D layer must visibly support:

```text
standing tree
-> cutting activity
-> fall / transition
-> physical log entities
-> carrying / hauling
-> stockpile / workshop / construction
```

The simulation decides when state changes occur. Animation bridges those states visually.

## 10.3 Ground ecology

Render meaningful ecological differences:

- dry soil,
- moist soil,
- marsh,
- pond edge,
- grass/groundcover,
- dead vegetation,
- burn scar,
- contamination,
- regrowth,
- snow/frost.

The player should be able to see ecological cascades without opening a spreadsheet.

---

# 11. Beavers and animals

## 11.1 Character representation

Use glTF rigs and a reusable animation architecture.

Create an `EntityVisualController` keyed by stable entity ID.

## 11.2 Animation facts

Drive animation from authoritative facts such as:

- locomotion mode,
- speed,
- job/activity,
- carried item,
- injury,
- sleep,
- eating/drinking,
- swimming,
- combat,
- social interaction.

Do not infer gameplay outcomes from an animation.

## 11.3 Animation graph

Minimum beaver states:

- idle variants,
- walk,
- run/scurry,
- swim,
- climb where supported,
- chop,
- haul/carry,
- build,
- craft/work,
- eat,
- drink,
- sleep,
- injured movement,
- social,
- fight,
- death.

Use blend trees based on speed and locomotion.

## 11.4 Physical carried items

A carried log is the same stable log entity represented as attached to the carrier for presentation.

Maintain a mapping:

`item ID -> visual ownership attachment`

When authoritative ownership/position changes, reconcile the representation.

## 11.5 IK and contact polish

Later polish:

- foot placement,
- hand/paw tool contact,
- carried-log alignment,
- tail motion,
- head look-at,
- waterline awareness.

IK never decides whether the job succeeded.

---

# 12. Structures, construction, workshops, and infrastructure

## 12.1 Construction stages

Buildings must visually expose real construction progress.

At minimum:

- blueprint/designation,
- reserved/delivered materials,
- partial construction,
- finished structure,
- damaged state,
- destroyed state.

## 12.2 Modular procedural structures

Create render adapters for:

- dams,
- bridges,
- lodges,
- walls,
- floors,
- roofs,
- stairs/ramps,
- workshops,
- storage,
- mechanical infrastructure,
- roads/paths,
- farms,
- zones.

Use simulation cells/materials/structure components as source facts.

## 12.3 Industry

Workshop visuals should react to actual jobs:

- moving mechanisms,
- tools,
- powered shafts/wheels,
- stock movement,
- liquids,
- finished goods.

Mechanical motion may interpolate aesthetically, but power availability remains simulated.

---

# 13. Items and material culture

Damn Beavers' "physical resources are physical" law must be visible.

## 13.1 Render important physical items

Examples:

- logs,
- stone,
- food,
- containers,
- weapons,
- armor,
- crafted goods,
- tools,
- corpses/remains where appropriate,
- trade goods.

## 13.2 Aggregation policy

Do not destroy identity merely to optimize rendering.

Use instancing/batching while retaining:

`instance slot <-> stable item ID`

For extreme piles, a far LOD may visually aggregate them, but picking/inspection near the player must resolve actual items.

---

# 14. Camera system

A single camera mode is not enough.

## 14.1 Colony camera

Primary management view:

- orbit,
- pan,
- zoom,
- pitch limits,
- smooth focus,
- cursor-centric zoom,
- keyboard edge/drag movement,
- follow selection.

## 14.2 Inspect camera

Close cinematic inspection:

- follow one beaver/animal,
- shoulder/third-person orbit,
- optional first-person/eye-level observer camera,
- cinematic depth of field only when it does not hurt play.

## 14.3 Free camera

Developer / screenshot / exploration mode.

## 14.4 World camera

Smoothly transitions from site to regional/world representation.

## 14.5 Camera bookmarks

Save local camera bookmarks separately from game simulation state.

---

# 15. Selection, picking, and interaction

## 15.1 Picking

Support:

- cell picking,
- entity picking,
- structure picking,
- instance picking,
- water surface picking with underlying cell resolution.

Picking returns stable game identifiers, not only Three.js objects.

## 15.2 Selection model

Selection may contain:

```text
entity
cell
area
structure
site
historical event
route
territory
```

## 15.3 Designation tools

3D versions of existing commands:

- click,
- drag rectangle,
- brush,
- line,
- volume,
- elevation-constrained selection.

Preview is non-authoritative.

Submitting creates real simulation command(s).

## 15.4 Ghosts

Blueprint ghosts must clearly distinguish:

- valid,
- invalid,
- blocked,
- missing material,
- inaccessible.

The reason should come from simulation/query logic when possible.

---

# 16. UI and information architecture

Do not recreate Dwarf Fortress complexity as modal clutter.

The 3D world is the primary surface. Panels reveal depth on demand.

## 16.1 Persistent HUD

Keep minimal:

- date/time,
- pause/speed,
- population,
- critical alerts,
- current selection,
- camera layer/elevation.

## 16.2 Entity inspector

For any selected entity:

- name/type,
- identity,
- current activity,
- needs/health,
- inventory/equipment,
- relationships,
- memories/knowledge where relevant,
- current job,
- history,
- causal "why?" query.

## 16.3 Cell inspector

Show:

- coordinates/elevation,
- material/strata,
- water depth/flow,
- temperature,
- soil/ecology,
- accessibility,
- contamination,
- ownership/territory,
- scent/acoustics overlays where relevant.

## 16.4 Causality inspector

This is a flagship interface.

Any important visible change should offer:

**Why?**

Examples:

- Why is this path inaccessible?
- Why is this beaver idle?
- Why did this tree die?
- Why is this pond polluted?
- Why did this workshop stop?
- Why did this settlement collapse?
- Why did this battle occur?

Display the actual causal chain / grounded explanation.

## 16.5 Chronicle

Make history spatial.

Features:

- timeline,
- event filtering,
- people/sites/polities,
- jump camera to event location,
- trace participants,
- compare past/present,
- historical overlays.

## 16.6 Wayfarer

World travel UI:

- select site,
- route preview,
- travel facts/costs/risks from simulation,
- follow traveling entities,
- transition local <-> world representation.

---

# 17. Debug and simulation overlays

Required overlays:

- cell grid,
- chunk bounds,
- entity IDs,
- occupancy,
- navigation cost,
- selected path,
- inaccessible cells,
- water depth,
- flow vectors,
- pressure/obstruction where available,
- soil moisture,
- temperature,
- fire,
- contamination,
- scent,
- acoustics,
- territory,
- zones,
- jobs,
- reservations,
- stockpile ownership,
- mechanical power,
- world/site IDs,
- render LOD,
- draw calls,
- triangle count,
- frame CPU/GPU timing.

A "beautiful mode" may hide debug visuals. The debug layer must always exist.

---

# 18. Lighting, weather, seasons, and atmosphere

All macro conditions derive from simulation.

## 18.1 Day/night

Use real simulated date/time to drive:

- sun angle,
- sky,
- moon/night lighting if the simulation exposes appropriate facts,
- artificial lights,
- exposure target.

## 18.2 Weather

Render actual:

- rain,
- snow,
- fog/mist,
- wind,
- storms,
- heat/cold cues.

## 18.3 Seasons

Seasonal visuals should derive from real ecology/weather:

- leaf states,
- snow,
- wetness,
- frozen water,
- ground color,
- plant lifecycle.

## 18.4 Fire and smoke

Fire effects must attach to real burning cells/entities.

Smoke is visual, but its source is real.

---

# 19. Sensory layer

Phase 11 created systems worth visualizing.

## 19.1 Audio

Build spatial audio emitters keyed to actual state:

- water,
- rain,
- wind,
- workshops,
- machinery,
- animals,
- voices/social activity,
- combat,
- fire.

Use simulated acoustics/occlusion facts where practical.

## 19.2 Scent

Scent is not normally visible, but expose a debug/analysis overlay:

- source,
- strength,
- gradient,
- decay,
- affected entities.

## 19.3 Historical landscape / archaeology

Provide optional overlays for:

- old infrastructure,
- ruins,
- former settlement extents,
- prior river/dam footprints if recorded,
- archaeological/historical interpretation.

---

# 20. Multi-scale world rendering

The wider world must not become a disconnected menu.

## 20.1 World representation

Render:

- terrain regions,
- watersheds/rivers,
- sites,
- roads/travel links,
- territories,
- polities,
- armies/migrants/trade movements,
- historical hotspots.

## 20.2 Entity continuity

When the same entity moves between local and regional scales:

- keep the same stable ID,
- switch renderer representation,
- preserve inspection/history linkage.

## 20.3 Transition

Preferred:

- zoom outward,
- local detail simplifies,
- site becomes macro representation,
- regional entities appear,
- world map becomes interactive.

Avoid hard scene swaps where possible, but correctness beats spectacle.

---

# 21. Materials and visual language

The game should feel handcrafted, wet, woody, geological, and tactile.

## Principles

- material readability before photoreal noise,
- strong differentiation between wet/dry,
- wood species/material differences visible,
- strata readable at cutaways,
- structures visually communicate construction method,
- water clarity changes with depth/composition,
- ecology conveys health,
- selection/debug overlays remain legible.

Use physically based materials, but art direction is more important than raw shader complexity.

---

# 22. Asset pipeline

Preferred standards:

- glTF/GLB for models/rigs,
- compressed texture pipeline,
- mesh compression where appropriate,
- generated LODs,
- consistent unit scale,
- consistent Y-up conventions,
- asset manifest,
- asset license/source metadata.

## Asset acceptance

Every production asset needs:

- correct scale,
- pivot/origin,
- collision/picking proxy if needed,
- LOD strategy,
- material assignment,
- test scene,
- performance classification.

Procedural placeholders are acceptable only until the relevant visual gate.

---

# 23. Performance architecture

The game may contain far more simulated objects than should be rendered individually.

## 23.1 Never one draw call per small object

Use:

- instancing for identical geometry/material,
- batching for varied geometry sharing material,
- chunk meshes,
- texture atlases/arrays where sensible,
- aggressive frustum culling,
- distance LOD,
- update budgets.

## 23.2 Render-interest set

Do not send/render the whole world at local detail.

Presentation layer computes or supports:

- focus area,
- visible chunks,
- near dynamic entities,
- selected/followed exceptions,
- world-scale summaries.

## 23.3 Worker jobs

Move expensive non-authoritative work off the main thread where practical:

- terrain meshing,
- chunk simplification,
- some geometry generation,
- asset decoding where supported.

## 23.4 Frame budgets

Desktop target:

- 60 FPS normal target,
- scalable quality rather than catastrophic collapse,
- no simulation correctness tied to frame rate.

Track separately:

- simulation time,
- presentation projection time,
- geometry update time,
- animation time,
- render CPU,
- GPU frame,
- memory,
- draw calls,
- triangles,
- visible entities.

## 23.5 Stress scenes

Maintain deterministic performance scenes:

- dense forest,
- giant stockpile,
- large colony,
- deep excavation,
- flood,
- fire,
- large battle,
- world map with many sites/movements.

---

# 24. Rendering strategy for large repeated populations

Use Three.js instancing/batching where identity can be preserved through lookup maps.

Recommended patterns:

```text
TreeInstancePool
  instanceIndex -> treeEntityId

ItemInstancePool
  instanceIndex -> itemEntityId

StructureBatch
  renderPartId -> structureEntityId

FarAnimalPool
  instanceIndex -> creatureEntityId
```

Selected/near entities may promote from batched representation to richer individual rigs while keeping the same stable ID.

---

# 25. Accessibility

The 3D layer must preserve and improve access.

Include:

- remappable controls,
- reduced motion,
- camera shake off,
- color-blind-safe overlay modes,
- scalable UI,
- readable text,
- keyboard navigation for major UI,
- subtitles/captions for meaningful audio cues,
- high-contrast selection,
- pause-anytime single-player controls,
- alternatives to color-only state encoding.

---

# 26. Testing strategy

This phase requires more than unit tests.

## 26.1 Contract tests

Prove:

- renderer cannot mutate simulation through snapshots,
- stable IDs survive save/load,
- create/update/remove patches reconcile correctly,
- command intents round-trip correctly,
- interpolation never feeds back,
- origin rebasing preserves world mapping.

## 26.2 Existing suite

Existing simulation tests remain mandatory and unchanged unless a legitimate integration issue requires a tested fix.

Any renderer task that breaks headless simulation is failed.

## 26.3 Visual regression

Fixed deterministic scenes and cameras.

Capture:

- Pond Test start,
- active logging,
- active hauling,
- dam construction,
- full pond,
- flood,
- winter,
- night,
- workshop,
- large colony,
- excavation/cutaway,
- world view,
- Chronicle event location,
- Wayfarer route.

## 26.4 Visual critic

For each major renderer subsystem, use an independent visual critic agent.

The critic receives:

- current screenshots/video,
- reference screenshots,
- no explanation of which is ours when blind comparison is possible.

It scores:

- material quality,
- lighting,
- composition,
- readability,
- animation,
- scale,
- obvious artifacts,
- performance tradeoffs,
- "game prototype" tells.

A subsystem does not close because it technically renders.

## 26.5 Simulation truth audit

For each visual gate, randomly sample visible objects and verify:

- rendered stable ID exists,
- rendered position corresponds to authoritative state,
- material corresponds to source data,
- water cells correspond to simulated water,
- carried items correspond to ownership/position,
- construction stage corresponds to state,
- weather corresponds to simulation.

---

# 27. Visual reference set

Use references for qualities, not copying.

## Dwarf Fortress (Steam)
Reference for:
- information density,
- depth,
- inspectability,
- layered underground play,
- systemic legibility.

## Timberborn
Reference for:
- beaver settlement readability,
- dams,
- water as central visual system,
- readable industry.

## Going Medieval / Manor Lords / similar high-quality strategy worlds
Reference for:
- terrain scale,
- settlement materiality,
- camera readability,
- environmental cohesion.

## High-end nature references
Reference for:
- water,
- riverbanks,
- forests,
- mud,
- snow,
- weather,
- geological exposure.

The final identity should still be unmistakably Damn Beavers.

---

# 28. Implementation phases

Use a dedicated ledger such as `THREEJS_TASKS.md`.

Each task must pass:

1. implementation,
2. tests,
3. deterministic render capture where visual,
4. independent critic,
5. fixes/regressions,
6. evidence entry.

---

## R0 — Presentation Contract & Renderer Constitution

**Goal:** make it impossible to accidentally turn Three.js into authoritative game state.

Tasks:

- R0-01 create `threejs_layer.md` / renderer laws in repo.
- R0-02 audit browser compatibility of simulation imports.
- R0-03 create `src/presentation/contracts`.
- R0-04 implement immutable render projection.
- R0-05 implement stable ID render registry.
- R0-06 implement command adapter.
- R0-07 implement inspection/query adapter.
- R0-08 implement `SimBridge`.
- R0-09 implement local/worker topology chosen from audit.
- R0-10 enforce import-boundary lint/test.
- R0-11 add deterministic render-test mode.
- R0-12 add renderer bootstrap and blank world scene.

**Gate:** Three.js displays a frame derived from a real saved/headless world; clicking a projected entity returns its stable simulation ID; renderer mutation cannot alter simulation state.

---

## R1 — The 3D Pond Test / First Honest Playable Frame

**Goal:** reproduce the original Pond Test in real 3D before expanding.

Tasks:

- R1-01 camera and controls.
- R1-02 cell-to-world coordinate mapping.
- R1-03 first terrain chunk renderer.
- R1-04 basic water surface from authoritative depth.
- R1-05 basic tree instances.
- R1-06 basic beaver visuals.
- R1-07 log/item visuals.
- R1-08 dam/structure visuals.
- R1-09 picking.
- R1-10 tree designation command.
- R1-11 dam blueprint command.
- R1-12 time controls.
- R1-13 selection inspector.
- R1-14 save/load rehydration.
- R1-15 Pond Test end-to-end visual capture.

**Gate:** a player can perform the real Pond Test entirely through the 3D client with no simulation shortcut.

---

## R2 — Terrain, Strata, Excavation & Streaming

Tasks:

- R2-01 chunk manager.
- R2-02 exposed-face/greedy mesher.
- R2-03 multi-material strata.
- R2-04 digging updates.
- R2-05 cliffs/ramps/stairs.
- R2-06 underground/cave visibility.
- R2-07 slice/cutaway controls.
- R2-08 chunk worker meshing.
- R2-09 terrain LOD.
- R2-10 floating origin.
- R2-11 terrain material polish.
- R2-12 terrain critic/perf gate.

**Gate:** arbitrarily excavated multi-level terrain remains readable, correct, and performant.

---

## R3 — Hydrology Visual System

Tasks:

- R3-01 water surface topology.
- R3-02 smooth height interpolation.
- R3-03 depth coloration.
- R3-04 flow-aligned surface detail.
- R3-05 foam/rapids from real gradients.
- R3-06 shoreline wetness.
- R3-07 falls/transitions.
- R3-08 ice.
- R3-09 contamination/composition.
- R3-10 underwater rendering.
- R3-11 hydrology debug overlay.
- R3-12 dam/flood visual truth gate.

**Gate:** a blind critic can visually understand how the hydraulic state changed and truth audit confirms the frame matches simulation.

---

## R4 — Vegetation, Ecology & Environmental Change

Tasks:

- R4-01 tree instance system.
- R4-02 plant/groundcover system.
- R4-03 age/species variation.
- R4-04 health/stress visual states.
- R4-05 wetland/flood response.
- R4-06 seasonal state.
- R4-07 cutting/falling transition.
- R4-08 fire/burn states.
- R4-09 regrowth.
- R4-10 ecology overlays.
- R4-11 LOD/performance.
- R4-12 multi-season cascade gate.

**Gate:** a dam-induced multi-season ecological cascade is visible in 3D without invented outcomes.

---

## R5 — Beavers, Animals & Animation

Tasks:

- R5-01 production rig pipeline.
- R5-02 stable-ID visual controllers.
- R5-03 locomotion graph.
- R5-04 swim graph.
- R5-05 work animations.
- R5-06 haul/carry attachment.
- R5-07 sleep/eat/drink/social.
- R5-08 injury/death.
- R5-09 combat.
- R5-10 animal variants.
- R5-11 IK/contact polish.
- R5-12 crowd LOD.
- R5-13 follow/inspect camera.
- R5-14 creature critic gate.

**Gate:** following one beaver through a full working day visually tells the same story as its authoritative job/activity/history.

---

## R6 — Structures, Industry, Items & Infrastructure

Tasks:

- R6-01 construction stage renderer.
- R6-02 lodge/building kit.
- R6-03 bridges/dams.
- R6-04 workshops.
- R6-05 stockpiles.
- R6-06 physical item pools.
- R6-07 containers/liquids.
- R6-08 mechanical power.
- R6-09 roads/paths.
- R6-10 farms/zones.
- R6-11 damage/collapse visual states.
- R6-12 industry critic gate.

**Gate:** resources can be visually traced from source -> haul -> stockpile/workshop -> construction/product.

---

## R7 — Player Control Surface, UI & Causality

Tasks:

- R7-01 production picking system.
- R7-02 area/volume designations.
- R7-03 construction palette.
- R7-04 labor/job UI.
- R7-05 zones/stockpiles.
- R7-06 entity inspector.
- R7-07 cell inspector.
- R7-08 causal "Why?" UI.
- R7-09 path/accessibility explanation.
- R7-10 alerts.
- R7-11 save/load/settings.
- R7-12 keyboard/accessibility.
- R7-13 UI critic gate.

**Gate:** the simulation can be seriously played from the 3D layer without falling back to developer commands.

---

## R8 — Lighting, Weather, Atmosphere & Sensory World

Tasks:

- R8-01 sun/time-of-day.
- R8-02 sky/environment.
- R8-03 shadows.
- R8-04 rain.
- R8-05 snow.
- R8-06 fog/mist.
- R8-07 wetness.
- R8-08 fire/smoke.
- R8-09 spatial ambient audio.
- R8-10 simulated acoustics integration.
- R8-11 scent overlay.
- R8-12 restrained post-processing.
- R8-13 day/night/weather critic gate.

**Gate:** weather and time materially change the world presentation while still matching simulation facts and maintaining gameplay readability.

---

## R9 — Chronicle, Wayfarer & Multi-scale World

Tasks:

- R9-01 region/world renderer.
- R9-02 site representations.
- R9-03 rivers/travel network.
- R9-04 territories/polities.
- R9-05 trade/migration/armies.
- R9-06 scale transition.
- R9-07 stable entity continuity across scales.
- R9-08 Chronicle timeline.
- R9-09 spatial event jumping.
- R9-10 historical overlays.
- R9-11 Wayfarer route UI.
- R9-12 local/world transition gate.

**Gate:** select an entity/site/event at world scale, descend to local scale, and retain identity/history/inspection continuity.

---

## R10 — Performance, Scalability & Platform Hardening

Tasks:

- R10-01 renderer telemetry.
- R10-02 instancing audit.
- R10-03 batching audit.
- R10-04 culling.
- R10-05 LOD.
- R10-06 update throttling.
- R10-07 geometry-worker optimization.
- R10-08 texture/memory budget.
- R10-09 large-colony stress.
- R10-10 large-flood stress.
- R10-11 battle stress.
- R10-12 WebGL fallback test.
- R10-13 quality auto-scaling.
- R10-14 memory leak soak.

**Gate:** target scenes remain playable for long sessions without simulation/render desynchronization, runaway memory, or frame-rate-dependent game behavior.

---

## R11 — AAA Readability / Final 3D World Gate

This is the renderer equivalent of the DF parity gate.

Tasks:

- R11-01 canonical screenshot suite.
- R11-02 canonical video suite.
- R11-03 blind visual comparisons.
- R11-04 material polish pass.
- R11-05 animation polish pass.
- R11-06 environment composition pass.
- R11-07 UI density/readability pass.
- R11-08 interaction friction pass.
- R11-09 simulation truth audit.
- R11-10 full save/load visual reconciliation.
- R11-11 accessibility review.
- R11-12 final performance review.
- R11-13 harsh independent critic.
- R11-14 fix until critic no longer identifies prototype-grade systems.

**Final gate sentence:**

> From world scale down to one working beaver, the player can see, inspect, command, and understand the same authoritative systemic world that passes the headless Damn Beavers simulation gates; every important visible thing has persistent identity, every important action goes through real simulation commands, every major visual state can be traced to simulated causes, and the 3D presentation is beautiful and performant enough that the renderer no longer feels like a visualization prototype but like the intended game.

---

# 29. The first implementation target

Do **not** start by polishing the title screen, generating 200 assets, or implementing the world map.

Start with:

# "One Pond in Three Dimensions"

One real seed. One real live simulation.

The player must be able to:

1. load the watershed,
2. orbit the 3D terrain,
3. see the real stream,
4. inspect a real cell,
5. inspect a real beaver,
6. designate a real tree,
7. watch ordinary AI choose the job,
8. watch the tree become physical logs,
9. watch a log be carried,
10. place a real dam order,
11. watch materials be delivered,
12. watch the dam become real,
13. watch water rise because the hydrology says it rises,
14. watch pathing adapt,
15. inspect the causal chain,
16. save,
17. reload,
18. see the same authoritative world reconstructed.

Only after that gate passes should the renderer fan outward.

---

# 30. Definition of done

The Three.js layer is not done when:

- a terrain mesh loads,
- water looks pretty,
- a beaver model walks,
- the UI has buttons,
- the world map exists,
- or screenshots look good.

It is done when the **entire existing simulation becomes a coherent explorable 3D instrument**:

- beautiful enough to invite attention,
- legible enough to manage,
- exact enough to trust,
- deep enough to inspect,
- performant enough to inhabit,
- and faithful enough that no gameplay system has been replaced by presentation tricks.
