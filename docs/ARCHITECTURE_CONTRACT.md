# ARCHITECTURE_CONTRACT.md

# Damn Beavers — Architecture Contract

## Purpose

This document defines boundaries that should remain true as Damn Beavers grows from one watershed into a millennia-scale civilization simulation.

The architecture may evolve.

These contracts should not be casually violated.

---

# 1. Fundamental separation

```text
┌──────────────────────────────────────┐
│          PRESENTATION LAYER          │
│                                      │
│ rendering • animation • particles    │
│ camera • audio • UI • input          │
└──────────────────┬───────────────────┘
                   │ commands / observes
                   ↓
┌──────────────────────────────────────┐
│        AUTHORITATIVE SIMULATION      │
│                                      │
│ time • entities • terrain • water    │
│ materials • agents • needs • jobs    │
│ items • structures • ecology         │
│ society • history • RNG              │
└──────────────────┬───────────────────┘
                   │ structured state/events
          ┌────────┴─────────┐
          ↓                  ↓
┌─────────────────┐  ┌────────────────────┐
│ SAVE / MIGRATION│  │ HEADLESS TEST/REPLAY│
└─────────────────┘  └────────────────────┘
```

The authoritative simulation must be capable of running without graphics.

---

# 2. Recommended repository shape

If the repository does not already establish a stronger structure, prefer a separation resembling:

```text
/
├── AGENTS.md
├── TASKS.md
├── DAMN_BEAVERS_MASTER_ROADMAP.md
├── docs/
│   ├── ARCHITECTURE_CONTRACT.md
│   └── M0_ONE_WATERSHED.md
├── src/
│   ├── sim/
│   │   ├── core/
│   │   ├── world/
│   │   ├── materials/
│   │   ├── hydrology/
│   │   ├── navigation/
│   │   ├── agents/
│   │   ├── jobs/
│   │   ├── items/
│   │   ├── construction/
│   │   ├── ecology/
│   │   ├── history/
│   │   └── persistence/
│   ├── presentation/
│   │   ├── rendering/
│   │   ├── animation/
│   │   ├── camera/
│   │   ├── audio/
│   │   └── effects/
│   ├── ui/
│   └── app/
├── tests/
│   ├── unit/
│   ├── simulation/
│   ├── regression/
│   ├── replay/
│   └── fixtures/
└── tools/
    └── debug/
```

Exact directories are less important than dependency direction.

Presentation may depend on simulation interfaces.

Simulation must not depend on Three.js scene objects, DOM UI objects, animation clips, or renderer state.

---

# 3. Technology stance

The game is intended as a beautiful 3D simulation.

A web-capable frontend such as **Three.js/WebGPU** is appropriate for presentation if that is the repository's chosen stack.

However:

> The simulation contract is renderer-agnostic.

Do not make simulation correctness depend on:

- Three.js object transforms
- frame rate
- GPU particle state
- visual water shaders
- DOM state
- animation callbacks

If a different presentation technology is chosen later, authoritative game state should survive.

---

# 4. Authoritative time

Simulation time is not render time.

Required concepts:

```text
tick / step index
simulation time
pause state
speed multiplier
scheduled work
```

Rendering may interpolate between authoritative states.

Changing frame rate must not change simulation results.

At high game speed, the renderer may skip visual frames while simulation advances correctly.

---

# 5. Entity identity

Use stable IDs for persistent entities.

A recommended conceptual shape:

```text
EntityId {
    kind
    generation/version if needed
    stable numeric or UUID-like value
}
```

Requirements:

- serializable
- comparable
- never based on memory address
- never based only on current array index
- never reused while references can still exist
- valid across save/load

History/event records should reference IDs, not presentation objects.

---

# 6. Component/state composition

Prefer composition over a monolithic class hierarchy.

Examples:

```text
Beaver
= Identity
+ Transform
+ CreatureBody
+ Locomotion
+ Swimmer
+ Needs
+ Health
+ Inventory
+ Skills
+ Relationships
+ JobActor

Tree
= Identity
+ Transform
+ Plant
+ MaterialBody
+ Growth
+ Harvestable

Log
= Identity
+ Transform
+ PhysicalItem
+ MaterialBody
+ Haulable

DamSegment
= Identity
+ Transform
+ Structure
+ MaterialBody
+ HydraulicObstruction
```

A later system should be able to discover relevant entities by capability/component rather than giant type switches.

---

# 7. Materials are properties

Avoid code like:

```text
if material == WOOD:
    floats = true
```

Prefer data such as:

```text
density
strength
hardness
permeability
friction
thermal conductivity
ignition behavior
organic content
decay resistance
```

Then derive behavior.

Named materials may still have special composition, but common physics should come from common properties.

---

# 8. Commands versus events

Keep these conceptually distinct.

## Command

An intention requesting state change.

Examples:

```text
DesignateTreeCut
DesignateConstruction
SetStockpileRule
Pause
SetSpeed
```

## Event

A record that something actually happened.

Examples:

```text
TreeCutCompleted
ItemMoved
DamSegmentCompleted
WaterCellDepthChangedThreshold
CreatureDied
```

Events should not become a back door for scripted outcomes.

---

# 9. Causal graph

Where practical, major events should be able to reference:

- direct cause event
- triggering command
- participating entities
- location
- timestamp

Not every low-level water-cell update belongs in permanent history.

Use tiers:

```text
debug trace
simulation event
historical event
```

The explanation layer may combine current-state evidence with recorded events.

---

# 10. Job system contract

Jobs must be generic enough that new work types do not require bespoke AI architecture.

Conceptual pipeline:

```text
Designation / system need
        ↓
Work opportunity
        ↓
Job instance
        ↓
Eligibility filtering
        ↓
Utility / priority evaluation
        ↓
Reservation
        ↓
Path plan
        ↓
Execution state machine
        ↓
Complete / fail / suspend / requeue
```

Reservations are authoritative state.

A job should fail intelligibly when:

- no worker qualifies
- required item unavailable
- route unavailable
- target destroyed
- need becomes urgent
- construction invalidated

---

# 11. Navigation contract

Navigation queries current world state.

At minimum costs should eventually be composable from:

```text
terrain
slope
water depth
current
swimming capability
occupancy
doors/gates
structures
danger
temperature
agent-specific constraints
```

For M0, implement the minimum subset required by the roadmap.

Dynamic world changes invalidate or re-evaluate affected paths.

Avoid recomputing the entire universe when localized invalidation works.

---

# 12. Hydrology contract

M0 hydrology is allowed to be an approximation.

It is not allowed to be fake.

Required invariants include:

- water quantity is tracked meaningfully
- flow moves according to terrain/neighbor state
- inflow/outflow influence volume
- obstruction changes throughput
- accumulation raises depth
- drainage lowers depth
- dams affect flow through ordinary structure/material properties

The implementation may use cells, columns, heightfields, shallow-water approximations, or another practical solver.

The acceptance tests, not the solver's prestige, determine suitability.

Future systems must be able to extend toward:

- pressure
- seepage
- erosion
- sediment
- temperature
- ice
- composition

Do not paint the architecture into a corner where water is merely a binary flooded flag.

---

# 13. Physical items and inventory

Location should form a coherent chain.

An item may be:

- on terrain
- inside a stockpile area
- carried by an agent
- inside a container
- reserved for a job
- delivered to a construction
- incorporated into a structure

Avoid duplicated location truth.

A carried log should not simultaneously exist as a free world item at its previous position.

---

# 14. Construction contract

Construction consists of:

```text
designation / plan
required material specification
physical deliveries
labor progress
constructed entity/state
```

Hydraulic and structural behavior should derive from completed physical state.

Do not wait until Phase 3 to design construction IDs and provenance correctly.

---

# 15. Ecology contract

Ecology consumes the same environmental world state used elsewhere.

Examples:

- moisture comes from hydrology/environment
- temperature comes from environment
- flooding tolerance reads actual inundation
- animal movement uses ordinary navigation
- death uses ordinary health/body mechanisms where feasible

Avoid a parallel "ecology map" whose truth contradicts the playable map.

---

# 16. Persistence contract

Every persistent system defines:

- serialized state
- stable references
- version
- validation
- migration expectations

Save/load is an acceptance criterion, not an end-of-project feature.

A save should contain authoritative state, not merely enough information to visually reconstruct a similar scene.

---

# 17. Deterministic replay

Maintain a headless replay harness capable of:

```text
load seed/save
apply command stream
advance N steps
snapshot authoritative state
compare expected hashes/invariants
```

RNG should be seeded.

Prefer subsystem streams where they reduce accidental cross-system divergence.

Do not use wall-clock time or render frame timing as authoritative randomness.

---

# 18. Testing pyramid

## Unit tests

For local invariants:

- IDs
- material behavior
- serialization
- utility functions
- path cost rules

## Simulation tests

For systems:

- water accumulation
- job selection
- hauling
- construction
- hunger/sleep behavior

## Cross-system tests

For causal chains:

- dam changes water
- water changes paths
- paths change jobs
- flooding changes ecology

## Regression seeds

Every significant emergent bug should be captured as a seed/save/command-stream test where practical.

## Milestone tests

The Pond Test is the M0 gate.

---

# 19. Debug observability

Debug tools are first-class architecture.

Provide ways to inspect:

- entity ID/components
- active jobs
- reservations
- current path/path costs
- water depth
- flow direction/rate
- terrain elevation
- material properties
- needs
- health
- structure state
- causal/event chain

If developers cannot see why the simulation chose something, they cannot build a deep simulator safely.

---

# 20. Performance contract

Do not prematurely destroy correctness for speed.

Preferred sequence:

```text
correct
→ observable
→ profile
→ improve data layout
→ incremental invalidation
→ simulation LOD
→ parallelize
→ specialized compute/GPU where justified
```

Performance work must preserve tested invariants.

The long-term architecture must anticipate:

- thousands of entities
- many active jobs
- dynamic water
- large history
- offscreen simulation
- multiple simulation scales

But M0 should optimize only demonstrated bottlenecks.

---

# 21. Presentation contract

The player should perceive systemic state clearly.

For M0 prioritize:

- beautiful but legible terrain
- excellent water rendering
- readable depth/wetness
- obvious selected/designated objects
- convincing beaver movement
- clear carrying/hauling
- construction progress
- visible pond formation
- camera comfort
- uncluttered inspection UI

Presentation may interpolate and embellish.

It must never contradict authoritative state.

---

# 22. Independence test

A system passes architectural review when this question can be answered "yes":

> Could the headless simulator produce and explain the same important outcome with the renderer completely disabled?

If no, simulation truth has leaked into presentation.

---

# 23. Emergence test

A feature passes systemic review when this question can be answered "yes":

> Could this mechanism participate in a different unforeseen story without adding another bespoke event script?

Examples:

A log should be usable by hauling, construction, obstruction, burning, decay, ownership, trade, injury, or history as future systems arrive.

A dam should be a structure interacting with water—not a story trigger named "dam."

---

# 24. Architecture change protocol

If an agent believes this contract is wrong:

1. do not silently violate it,
2. document the conflict,
3. propose the smallest amendment,
4. explain effects on persistence/determinism/testing,
5. update this file if the project intentionally changes direction.

Architecture is allowed to evolve.

Untracked architectural drift is not.
