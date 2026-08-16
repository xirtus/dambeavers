# DAMN_BEAVERS_MASTER_ROADMAP

> **Project:** Damn Beavers  
> **Genre:** systemic beaver-civilization simulator  
> **North Star:** Dwarf Fortress-scale emergence through universal simulation components, adapted around beaver ecology, hydrology, engineering, society, and deep history.  
> **Primary rule:** every completed phase must leave behind a playable game.

---

## 0. Purpose of this roadmap

The systems checklist describes **what the game eventually contains**.

The parity checklist describes **what depth and interaction density Damn Beavers must eventually match**.

This roadmap describes **what gets built first, what depends on what, and how we know it actually works**.

It exists to prevent hundreds of desirable systems from becoming an undirected coding project.

The project should move through concentric rings:

```text
ONE WATERSHED
    ↓
LIVING COLONY
    ↓
INDUSTRIAL LODGE
    ↓
LIVING ECOSYSTEM
    ↓
SOCIETY & HISTORY
    ↓
WORLD SIMULATION
    ↓
WAR, POLITICS & CIVILIZATION
    ↓
CHRONICLE
    ↓
WAYFARER
    ↓
DF PARITY AUDIT
    ↓
SYSTEMS DF DOESN'T HAVE
```

The original parity work can be treated as an **ARMOK-style universal simulation inventory** spanning world, matter, environment, anatomy, medicine, cognition, society, economy, construction, combat, ecology, history, and civilizations. This roadmap reorganizes those systems by dependency rather than category.

---

# 1. Architectural laws

These rules are more important than any individual feature.

## LAW 1 — Systems, not event scripts

Never encode a result when the result can emerge from interacting properties.

Bad:

```text
DamFloodEvent
BeaverGetsDrunk
TreeFallsOnBeaver
ColonyFamine
BridgeCollapse
```

Good:

```text
water
pressure
flow
permeability
structural strength
damage
gravity

liquid composition
ingestion
metabolism
intoxication
motor control

mass
support
momentum
collision
body tissues
injury

food stocks
nutrition
harvest yield
population
accessibility
weather
```

Events are **records of outcomes**, not the mechanism producing them.

---

## LAW 2 — One authoritative simulation

Rendering, UI, animation, audio, Chronicle, and AI explanation systems observe the simulation.

They do not secretly maintain alternate versions of reality.

---

## LAW 3 — Stable identity

Every persistent important thing receives a stable ID.

At minimum:

- creatures
- beavers
- plants
- trees
- items
- constructions
- buildings
- rooms/areas
- water bodies
- settlements
- organizations
- families
- historical figures
- sites
- civilizations
- battles
- major events

IDs survive save/load.

---

## LAW 4 — State changes produce inspectable causes

Important changes must be explainable.

Instead of:

```text
Beaver #17 died.
```

the game should be capable of reconstructing:

```text
Beaver #17 drowned
→ after entering Cell (82, 41, -2)
→ because the only dry route to Stockpile #3 became submerged
→ because Pond #2 rose 1.4 m
→ because Dam #6 reduced downstream discharge
→ after three additional logs reduced its effective permeability.
```

---

## LAW 5 — Jobs are requests, not puppet strings

The player issues intentions:

```text
cut these trees
build here
haul this
store these materials
fish here
forbid this area
```

Agents decide how to satisfy them through the normal job, pathfinding, inventory, skill, and need systems.

---

## LAW 6 — Same primitives at every scale

The mechanics used in the tutorial watershed should remain valid when simulating an empire.

A dam built in year 1 and a continental canal built in year 800 should ultimately be made from the same concepts:

- materials
- geometry
- labor
- ownership
- flow
- wear
- maintenance
- failure

---

## LAW 7 — Simulation truth before presentation polish

A visually crude but causally correct system is preferable to an impressive scripted fake.

Presentation can be iterated after the system passes its acceptance test.

---

## LAW 8 — Determinism where practical

Given:

- identical world seed
- identical simulation version
- identical initial state
- identical player orders
- identical RNG stream

the simulation should reproduce the same authoritative outcome.

This is essential for debugging emergence.

---

# 2. Dependency notation

Each feature has:

- **ID** — stable roadmap identifier.
- **Depends on** — features that must exist first.
- **Acceptance test** — objective proof the feature works.

Status should eventually use:

```text
NOT_STARTED
FOUNDATION
PLAYABLE
ROBUST
PARITY
EXCEEDED
```

No feature is considered complete because code exists.

It is complete because its acceptance test passes.

---

# 3. The critical dependency tree

```text
P0-01 Simulation clock
P0-02 Stable entity IDs
P0-03 Component/state model
P0-04 Deterministic RNG
P0-05 Spatial world representation
P0-06 Save schema
        │
        ├─────────────┐
        ↓             ↓
P0-07 Materials   P0-08 Event log
        │             │
        ↓             │
P0-09 Terrain         │
        │             │
        ├───────┐     │
        ↓       ↓     │
P0-10 Plants  P1-02 Water
                │
                ↓
          P1-03 Hydrology
                │
                ├───────────────┐
                ↓               ↓
          P1-04 Navigation   P1-11 Dam physics
                │               │
                ↓               ↓
          P1-05 Beavers      water-level change
                │               │
                ↓               ↓
          P1-06 Needs      accessibility change
                │               │
                ↓               │
          P1-07 Jobs ←───────────┘
                │
        ┌───────┴─────────┐
        ↓                 ↓
 P1-08 Tree cutting   P1-09 Hauling
        │                 │
        └──────┬──────────┘
               ↓
         P1-10 Construction
               │
               ↓
         emergent dam behavior
               │
        ┌──────┴───────────────┐
        ↓                      ↓
 P1-12 Ecology response   P1-13 Survival
        │                      │
        └──────────┬───────────┘
                   ↓
            P1-14 Save/reload
                   │
                   ↓
            P1-15 Explanation
                   │
                   ↓
          MILESTONE 0 COMPLETE
```

---

# PHASE 0 — ENGINE FOUNDATION

## Goal

Create the smallest authoritative simulation kernel capable of supporting the entire project without prematurely building gameplay.

Phase 0 is not the public vertical slice.

It is the foundation required for **Milestone 0: Seven beavers arrive beside a stream.**

---

### P0-01 — Simulation clock

**Depends on:** none

Implement:

- tick counter
- simulation time
- pause
- speed multipliers
- scheduled updates
- fixed authoritative timestep or equivalent deterministic scheduling

**Acceptance test:** pause freezes authoritative state; running the same deterministic test for 100,000 ticks at different render frame rates yields identical simulation state.

---

### P0-02 — Stable entity identity

**Depends on:** P0-01

Implement globally unique persistent IDs for simulation entities.

**Acceptance test:** create 10,000 entities, save, reload, destroy 5,000, create 5,000 more, and verify no surviving entity changes identity and no ID collision occurs.

---

### P0-03 — Universal component/state model

**Depends on:** P0-02

Support data-oriented composition for entities rather than giant inheritance trees.

Example component families:

- Transform
- Physical
- Material
- Creature
- Needs
- Inventory
- SkillSet
- Structure
- Plant
- Liquid
- Ownership
- HistoricalIdentity

**Acceptance test:** a log, beaver, tree, wall, fish, and corpse can coexist in the same world while sharing only the components appropriate to them.

---

### P0-04 — Seeded random streams

**Depends on:** P0-01

Randomness must be seedable and partitionable by subsystem where practical.

**Acceptance test:** two headless runs with the same seed and commands produce bit-for-bit identical test snapshots.

---

### P0-05 — Spatial world representation

**Depends on:** P0-03

Represent a three-dimensional playable world with:

- x/y/z position
- terrain cells or equivalent spatial volumes
- surfaces
- occupancy
- vertical adjacency
- spatial queries

**Acceptance test:** entities can exist above, below, inside, and adjacent to terrain volumes and can be queried correctly.

---

### P0-06 — Versioned persistence schema

**Depends on:** P0-02, P0-03, P0-05

Implement save serialization with explicit versioning.

**Acceptance test:** a test world containing terrain, entities, inventories, references, and events serializes and reloads with all references intact.

---

### P0-07 — Material definition system

**Depends on:** P0-03

Materials define properties rather than only names.

Initial properties:

- density
- hardness
- strength
- friction
- permeability
- buoyancy
- thermal properties
- biological/organic flag
- decay resistance

Initial materials:

- water
- air
- soil
- clay
- sand
- stone
- wood
- bark
- leaves
- plant matter

**Acceptance test:** changing a material definition alters physical/systemic behavior without changing code specific to that material.

---

### P0-08 — Event and causality log

**Depends on:** P0-01, P0-02

Record structured state-changing events with:

- timestamp
- subject IDs
- object IDs
- location
- event type
- direct cause
- optional parent cause/event

**Acceptance test:** a test chain of five dependent events can be traversed backward from outcome to originating action.

---

### P0-09 — Terrain and strata

**Depends on:** P0-05, P0-07

Implement:

- surface elevation
- soil
- rock
- banks
- slopes
- excavatable/alterable terrain representation

**Acceptance test:** a generated watershed contains a continuous valley, banks, soil depth, and underlying rock with spatially queryable material layers.

---

### P0-10 — Plants and trees as physical entities

**Depends on:** P0-02, P0-03, P0-07, P0-09

Trees must possess:

- species
- position
- age
- size
- wood material
- health
- root/soil relation
- harvestable mass

**Acceptance test:** two trees of different size/species generate different physical quantities of wood based on entity state rather than a fixed loot table.

---

### P0-11 — Headless simulation runner

**Depends on:** P0-01 through P0-10

Run simulation tests without renderer/UI.

**Acceptance test:** CI can load a seed, inject commands, simulate N ticks, and assert world state.

---

### P0-12 — Debug inspection layer

**Depends on:** P0-03, P0-05, P0-08

Expose overlays for:

- entity IDs
- pathability
- terrain elevation
- water
- flow vectors
- jobs
- needs
- structural state
- event chains

**Acceptance test:** a developer can click a simulation entity and inspect raw authoritative state without attaching a debugger.

---

## PHASE 0 GATE

Phase 0 passes when a headless deterministic world with terrain, materials, trees, entity IDs, saving, and structured events can be created, advanced, inspected, saved, and reloaded.

**Playable state:** developer sandbox.

---

# PHASE 1 — ONE WATERSHED

## Goal

Build the nucleus of Damn Beavers.

> **Milestone 0: Seven beavers arrive beside a stream.**

They can cut trees, move logs, eat, sleep, swim, and build a dam.

The dam obstructs simulated water.

Water backs up.

The changed water physically changes accessible terrain.

The beavers react through normal AI/jobs.

Save and reload preserve the exact situation.

No required outcome may be implemented as a scripted sequence.

---

### P1-01 — Watershed map generator

**Depends on:** P0-09, P0-10

Generate one small map containing:

- stream source/input
- channel
- banks
- floodplain
- elevation gradient
- soil/rock
- trees
- dry ground
- prospective pond area

**Acceptance test:** 100 seeds all generate at least one traversable bank and a connected downhill stream path across the map.

---

### P1-02 — Water volume

**Depends on:** P0-05, P0-07, P1-01

Water must have local quantity/depth and occupy world space.

**Acceptance test:** adding a known water volume to a closed basin produces the expected water depth within tolerance.

---

### P1-03 — Flow, drainage, and hydraulic obstruction

**Depends on:** P1-02

Implement enough hydrology for:

- downhill flow
- lateral spread
- accumulation
- drainage
- inflow/outflow
- obstruction
- permeability
- overtopping

**Acceptance test:** narrowing a channel reduces discharge and raises upstream water level without invoking a flood-specific event.

---

### P1-04 — Unified terrestrial/aquatic navigation

**Depends on:** P0-05, P1-02, P1-03

Navigation cost must account for:

- dry walkable ground
- slope
- shallow water
- deep water
- swimming
- blocked cells
- changing water levels

**Acceptance test:** when a ford becomes too deep, a walking-only test agent loses the route while a swimming-capable beaver finds an aquatic route.

---

### P1-05 — Beaver creature model

**Depends on:** P0-03, P1-04

Initial beaver components:

- body
- locomotion
- swimming
- inventory
- skills
- needs
- relationships
- current task
- health
- identity/name

Spawn exactly seven starting beavers for Milestone 0.

**Acceptance test:** seven persistent individuals can move independently and retain distinct IDs/state.

---

### P1-06 — Basic needs

**Depends on:** P1-05, P0-01

Implement:

- hunger
- thirst
- fatigue
- thermal comfort baseline

Needs change continuously with time/activity.

**Acceptance test:** an idle beaver eventually seeks food, water, and sleep without scripted scheduling.

---

### P1-07 — Job/order architecture

**Depends on:** P1-05, P1-06

Separate:

```text
player designation
→ available work
→ job generation
→ agent eligibility
→ job selection
→ reservation
→ execution
→ completion/failure/requeue
```

**Acceptance test:** deleting the currently assigned worker does not delete the underlying player order; another eligible beaver can take it.

---

### P1-08 — Tree cutting

**Depends on:** P0-10, P1-07

Implement:

- designate tree
- path to work position
- tool/body capability check
- work progress
- skill influence
- tree removal/fall abstraction
- physical logs generated from tree mass

**Acceptance test:** marking one tree causes an available beaver to choose the job, travel there, cut it, and produce persistent log entities.

---

### P1-09 — Physical items and hauling

**Depends on:** P0-07, P1-07, P1-08

Logs must be actual items with:

- mass
- material
- location
- holder/container relation
- reservation state
- movement/hauling cost

**Acceptance test:** a log remains where it falls until an agent physically moves it; save/reload while it is being hauled preserves ownership/reservation/location correctly.

---

### P1-10 — Construction jobs

**Depends on:** P1-07, P1-09

Initial constructions:

- wall
- lodge segment
- bridge
- dam segment

Construction must require:

- site
- design/order
- required material
- delivered item
- labor
- completion state

**Acceptance test:** cancelling construction before assembly leaves delivered physical materials in the world.

---

### P1-11 — Dam structure and hydraulic interaction

**Depends on:** P1-03, P1-10, P0-07

Dam segments derive hydraulic behavior from:

- geometry
- material
- permeability
- occupied cross-section
- structural integrity

**Acceptance test:** adding dam material progressively reduces channel discharge and raises upstream depth; removing a segment increases discharge again.

---

### P1-12 — Accessibility recomputation from water state

**Depends on:** P1-04, P1-11

Pathfinding reacts to hydrological state, not hand-authored map flags.

**Acceptance test:** a previously valid ground route disappears when pond depth exceeds walk threshold and reappears when water recedes.

---

### P1-13 — Basic food and drink

**Depends on:** P1-06, P1-07, P1-09

Initial foods can be simple:

- bark/cambium
- edible vegetation
- stored food item
- accessible water

**Acceptance test:** a hungry beaver acquires an edible item or reaches a valid food source, consumes it, and changes its nutritional state.

---

### P1-14 — Sleep and shelter preference

**Depends on:** P1-06, P1-10

Beavers can sleep wherever necessary but prefer safer/appropriate rest locations.

**Acceptance test:** exhausted beavers interrupt lower-priority work and sleep; providing a completed lodge changes chosen sleep location.

---

### P1-15 — Basic temperature exposure

**Depends on:** P0-01, P1-05

Track ambient/water exposure enough for future survival systems.

**Acceptance test:** a beaver in cold water changes thermal state faster than one on mild dry ground.

---

### P1-16 — Basic injury and death

**Depends on:** P1-05, P1-06, P1-15

Initial causes:

- drowning
- starvation
- severe exposure
- simple trauma

Death creates:

- corpse/body state
- historical event
- relationship consequence hook

**Acceptance test:** a beaver unable to surface can die through respiratory state depletion; no `DrowningEvent` is allowed to directly kill it.

---

### P1-17 — Minimal ecology response

**Depends on:** P0-10, P1-03

Implement:

- plant moisture preference
- flooding tolerance
- tree growth/regrowth baseline
- wetland vegetation state
- simple fish/wetland animal presence

**Acceptance test:** persistently flooded dry vegetation declines while suitable wetland vegetation gains viability.

---

### P1-18 — Basic weather and day/night

**Depends on:** P0-01, P1-01

Implement:

- day/night clock
- ambient temperature
- precipitation input
- simple weather state

**Acceptance test:** rainfall measurably adds water to the watershed through the hydrology system.

---

### P1-19 — Relationships baseline

**Depends on:** P1-05

Store:

- kin relation
- familiarity
- affinity
- household/social group hooks

No deep psychology yet.

**Acceptance test:** the seven starting beavers can have distinct persistent relationship graphs that survive save/load.

---

### P1-20 — Minimal game UI

**Depends on:** P0-12, P1-07

Required:

- pause
- speed controls
- camera navigation
- select/inspect beaver
- inspect object
- inspect tile/water
- designate tree cutting
- designate construction
- alerts

**Acceptance test:** Milestone 0 can be completed without debug console commands.

---

### P1-21 — Save/reload full watershed state

**Depends on:** P0-06, P1-01 through P1-20

Preserve:

- terrain
- water
- flow-relevant state
- seven beavers
- needs
- jobs
- reservations
- inventories
- constructions
- plants
- events
- time/weather
- relationships

**Acceptance test:** save during an active dam build with a log in transit, reload, and continue to the same final deterministic state.

---

### P1-22 — Causal explanation query

**Depends on:** P0-08, P1-11, P1-12, P1-16

Initial player-facing question:

```text
Why did this happen?
```

Support at least:

- why a beaver cannot reach something
- why a job is stalled
- why water rose
- why a creature died
- why a plant died

**Acceptance test:** after an emergent flooding death, the game can return a causal chain containing the dam obstruction, water-level increase, accessibility change, agent action, and death mechanism.

---

## MILESTONE 0 — SEVEN BEAVERS ARRIVE BESIDE A STREAM

The milestone is complete only if the following can happen in an ordinary unscripted play session:

```text
1. A map generates with a stream and seven beavers.
2. Player marks trees for cutting.
3. Beavers autonomously choose cutting jobs.
4. Trees become physical logs.
5. Beavers haul logs.
6. Player orders a dam.
7. Materials are physically delivered.
8. Dam geometry obstructs simulated flow.
9. Upstream water level rises.
10. Terrain accessibility changes.
11. Existing routes change.
12. Beaver AI reacts using ordinary navigation/jobs.
13. Flooding alters at least one ecological state.
14. A creature/object can be stranded, displaced, injured, or drowned accidentally.
15. The game can explain the causal chain.
16. The game is saved in the middle of this state.
17. Reload reproduces it correctly.
```

### Phase 1 hard prohibition

None of the milestone's causal sequence may depend on:

- scripted dam cutscenes
- bespoke `FloodEvent` logic
- teleporting logs
- invisible construction resources
- hardcoded path blocking near dams
- scripted beaver reactions
- manually swapped "dry map" / "flooded map" states

**Playable state:** a small but real Damn Beavers.

---

# PHASE 2 — LIVING COLONY

## Goal

Turn seven workers into a self-sustaining settlement.

---

### P2-01 — Stockpiles and storage rules

**Depends on:** P1-09, P1-07

**Acceptance test:** material categories can be allowed/forbidden and hauling jobs arise automatically from storage policy.

### P2-02 — Work priorities and labor preferences

**Depends on:** P1-07, P1-05

**Acceptance test:** changing a beaver's allowed labor changes job selection without assigning a specific job directly.

### P2-03 — Skill progression

**Depends on:** P1-05, P1-07

**Acceptance test:** repeated work measurably improves speed/quality according to skill state.

### P2-04 — Personal inventories and equipment

**Depends on:** P1-09, P1-05

**Acceptance test:** tools are physical items; losing access to a required tool prevents or changes work.

### P2-05 — Rooms, zones, and functional spaces

**Depends on:** P1-10

**Acceptance test:** enclosing/defining a space changes its recognized function based on geometry and contents.

### P2-06 — Beds/nests/lodge occupancy

**Depends on:** P1-14, P2-05

**Acceptance test:** residents claim or prefer sleeping spaces through ordinary ownership/preference logic.

### P2-07 — Food production loop

**Depends on:** P1-13, P1-17, P2-01

**Acceptance test:** colony can acquire, store, and consume renewable food for at least one simulated year.

### P2-08 — Food spoilage

**Depends on:** P0-07, P2-07

**Acceptance test:** identical food stored under different environmental conditions decays at different rates.

### P2-09 — Waste and refuse

**Depends on:** P1-09, P2-01

**Acceptance test:** consumption/processing can generate physical refuse that requires disposal.

### P2-10 — Sanitation baseline

**Depends on:** P2-09, P1-03

**Acceptance test:** accumulated waste can degrade local environmental quality through a measurable state variable.

### P2-11 — Reproduction and births

**Depends on:** P1-19, P2-06

**Acceptance test:** eligible pair relationships can produce persistent offspring entities with parent references and birth events.

### P2-12 — Childhood and aging

**Depends on:** P2-11, P0-01

**Acceptance test:** newborns progress through age states and capabilities with simulation time.

### P2-13 — Social interaction scheduler

**Depends on:** P1-19, P2-06

**Acceptance test:** idle/social needs generate interactions without hand-authored scenes.

### P2-14 — Basic moods and preferences

**Depends on:** P1-06, P2-13

**Acceptance test:** two beavers exposed to the same event can react differently because of persistent traits/preferences.

### P2-15 — Burial/mourning

**Depends on:** P1-16, P1-19, P2-14

**Acceptance test:** death creates body-handling work and relationship-sensitive social consequences.

### P2-16 — Colony population UI

**Depends on:** P1-20, P2-02, P2-14

**Acceptance test:** player can inspect population, jobs, unmet needs, relationships, and critical blockers from normal UI.

---

## PHASE 2 GATE

A colony can survive, organize labor, store goods, sleep, eat, reproduce, age, grieve, and operate for a full year with limited player intervention.

**Playable state:** colony survival game.

---

# PHASE 3 — INDUSTRIAL LODGE

## Goal

Create production chains, material transformation, engineering, and infrastructure.

---

### P3-01 — Workshop framework

**Depends on:** P2-02, P2-05, P1-09

**Acceptance test:** new workshop definitions can consume inputs and produce outputs without custom job architecture.

### P3-02 — Recipes/process definitions

**Depends on:** P3-01, P0-07

**Acceptance test:** a data-defined recipe can be added without changing workshop execution code.

### P3-03 — Woodworking

**Depends on:** P3-02, P1-08

**Acceptance test:** logs can become planks/components with material identity preserved.

### P3-04 — Stoneworking

**Depends on:** P3-02, P0-09

**Acceptance test:** excavated stone can become construction/component items.

### P3-05 — Clay/mud working

**Depends on:** P3-02, P1-03, P0-07

**Acceptance test:** suitable wet material can be gathered and transformed into construction goods.

### P3-06 — Tools

**Depends on:** P3-03, P3-04, P2-04

**Acceptance test:** tool material/quality changes work efficiency or capability.

### P3-07 — Containers

**Depends on:** P3-03, P1-09

**Acceptance test:** items/liquids can be stored inside physical containers while retaining ownership and location chain.

### P3-08 — Liquid handling

**Depends on:** P3-07, P1-02

**Acceptance test:** liquid transferred between containers conserves quantity and composition.

### P3-09 — Fermentation

**Depends on:** P3-08, P3-02

**Acceptance test:** fermentable liquid changes composition over time based on conditions; intoxication is not yet required.

### P3-10 — Structural support

**Depends on:** P1-10, P0-07

**Acceptance test:** unsupported structures fail according to support/strength rules rather than construction type scripts.

### P3-11 — Structural damage and wear

**Depends on:** P3-10, P1-03

**Acceptance test:** repeated hydraulic/mechanical stress can weaken a structure progressively.

### P3-12 — Gates and controllable waterworks

**Depends on:** P3-10, P1-03

**Acceptance test:** opening/closing a physical gate changes flow through ordinary obstruction geometry.

### P3-13 — Canals and excavation

**Depends on:** P0-09, P1-03, P1-07

**Acceptance test:** excavating terrain creates a new water path that hydrology discovers automatically.

### P3-14 — Bridges and elevated routes

**Depends on:** P3-10, P1-04

**Acceptance test:** a completed bridge creates a valid route above water; structural failure removes it.

### P3-15 — Mechanical power baseline

**Depends on:** P3-10, P1-03

Sources may include water wheels or beaver-appropriate equivalents.

**Acceptance test:** flowing water can provide a measurable power resource derived from flow conditions.

### P3-16 — Machines/transmission

**Depends on:** P3-15

**Acceptance test:** generated power can be transmitted to a workshop/mechanism and ceases when the physical source stops.

### P3-17 — Quality

**Depends on:** P2-03, P3-02

**Acceptance test:** worker skill, material, and process affect item quality through common rules.

### P3-18 — Trade goods production

**Depends on:** P3-01, P3-17

**Acceptance test:** the colony can create non-survival goods with material, quality, maker, and value provenance.

---

## PHASE 3 GATE

The colony can transform raw matter into infrastructure, tools, storage, engineered waterways, mechanical systems, and valuable goods.

**Playable state:** production/engineering simulator.

---

# PHASE 4 — LIVING ECOSYSTEM

## Goal

Make the watershed a living ecological machine rather than scenery.

---

### P4-01 — Seasons

**Depends on:** P0-01, P1-18

**Acceptance test:** seasonal parameters alter temperature, precipitation, plant state, and animal behavior.

### P4-02 — Advanced plant lifecycle

**Depends on:** P1-17, P4-01

**Acceptance test:** germination, growth, maturity, reproduction, stress, and death occur from environmental conditions.

### P4-03 — Forest succession

**Depends on:** P4-02

**Acceptance test:** clear-cut land changes composition over decades without respawning identical trees.

### P4-04 — Wetland succession

**Depends on:** P1-03, P4-02

**Acceptance test:** persistent ponding converts ecological suitability toward wetland species.

### P4-05 — Animal framework

**Depends on:** P1-05, P1-17

**Acceptance test:** multiple animal species share general creature/navigation/needs components rather than species-specific AI controllers.

### P4-06 — Fish ecology

**Depends on:** P4-05, P1-03

**Acceptance test:** fish distribution responds to connected water, depth, temperature, and habitat.

### P4-07 — Predators and prey

**Depends on:** P4-05

**Acceptance test:** predation emerges from hunger, perception, pursuit, combat, and edible-body systems.

### P4-08 — Reproduction/population ecology

**Depends on:** P4-05, P4-01

**Acceptance test:** unmanaged animal populations can rise/fall from food, habitat, predation, and reproduction.

### P4-09 — Soil moisture and fertility

**Depends on:** P1-03, P0-09

**Acceptance test:** flooding/drying changes soil state and plant performance.

### P4-10 — Erosion and sediment

**Depends on:** P1-03, P0-07

**Acceptance test:** high flow moves sediment and can measurably alter channel geometry over time.

### P4-11 — Water temperature

**Depends on:** P1-15, P1-03, P4-01

**Acceptance test:** water bodies change temperature according to environment and influence creature/plant suitability.

### P4-12 — Ice/freezing

**Depends on:** P4-11

**Acceptance test:** water can freeze/thaw and alter flow/navigation through ordinary material-state changes.

### P4-13 — Fire baseline

**Depends on:** P0-07, P4-01

**Acceptance test:** combustible matter can ignite/spread based on temperature/fuel/moisture rather than object category alone.

### P4-14 — Disease/pathogen framework

**Depends on:** P2-10, P4-05

**Acceptance test:** an infectious agent can transmit between valid hosts through a defined transmission route.

### P4-15 — Environmental contamination

**Depends on:** P1-03, P3-08, P4-14

**Acceptance test:** contaminants move through water/material transfer and can expose organisms downstream.

### P4-16 — Ecosystem causality reports

**Depends on:** P0-08, P4-03 through P4-15

**Acceptance test:** the game can explain a population or vegetation shift using recorded environmental causes.

---

## PHASE 4 GATE

Building a dam can cause a multi-season ecological cascade without a "dam ecology" script.

**Playable state:** ecosystem engineering simulator.

---

# PHASE 5 — SOCIETY & HISTORY

## Goal

Turn a colony into a remembered society whose members develop beliefs, families, institutions, conflicts, and culture.

---

### P5-01 — Expanded personality model

**Depends on:** P2-14

**Acceptance test:** persistent traits influence choices across work, social life, danger, possessions, and recreation.

### P5-02 — Memories

**Depends on:** P0-08, P5-01

**Acceptance test:** significant events create memories with valence and persistence affecting later behavior.

### P5-03 — Stress and emotional state

**Depends on:** P5-02

**Acceptance test:** chronic adverse conditions alter behavior through accumulated psychological state.

### P5-04 — Relationships expansion

**Depends on:** P1-19, P5-02

Include:

- parent/child
- siblings
- mates
- friendships
- rivals
- grudges
- mentors
- colleagues

**Acceptance test:** relationship state changes from shared events and interactions.

### P5-05 — Households and families

**Depends on:** P2-11, P5-04

**Acceptance test:** kinship and partnership create persistent household groupings and inheritance hooks.

### P5-06 — Ownership

**Depends on:** P1-09, P5-05

**Acceptance test:** items/rooms can be personally, household, institutional, or communally owned.

### P5-07 — Values and norms

**Depends on:** P5-01, P5-04

**Acceptance test:** two settlements can evaluate the same behavior differently because of generated norms.

### P5-08 — Beliefs, myths, and ritual

**Depends on:** P0-08, P5-07

**Acceptance test:** remembered historical events can become referenced by persistent cultural beliefs/rituals.

### P5-09 — Art and symbolic works

**Depends on:** P3-17, P5-02, P5-08

**Acceptance test:** created art can depict actual people, animals, constructions, or past events by stable ID.

### P5-10 — Language/naming framework

**Depends on:** P0-02

**Acceptance test:** generated personal, site, artifact, and group names persist and can be referenced historically.

### P5-11 — Leadership roles

**Depends on:** P5-07, P5-05

**Acceptance test:** a settlement can assign a leader through an explicit social rule and preserve succession history.

### P5-12 — Rules/law baseline

**Depends on:** P5-11, P5-07

**Acceptance test:** prohibited behavior can be recognized from rule + action facts rather than bespoke crime events.

### P5-13 — Reputation

**Depends on:** P5-02, P5-07

**Acceptance test:** witnessed/known actions change how individuals/groups evaluate an actor.

### P5-14 — Social conflict

**Depends on:** P5-03, P5-04, P5-13

**Acceptance test:** grudges/stress can produce arguments or fights through general decision systems.

### P5-15 — Historical figure promotion

**Depends on:** P0-08, P5-09, P5-11

**Acceptance test:** ordinary entities can become historically significant based on recorded deeds without spawning a separate "historical version."

### P5-16 — Settlement history

**Depends on:** P5-15

**Acceptance test:** founding, births, deaths, offices, constructions, disasters, artworks, and conflicts can be queried chronologically.

---

## PHASE 5 GATE

After several simulated generations, the player can identify families, grudges, heroes, disasters, leaders, artworks, and traditions that arose from actual play.

**Playable state:** social-history simulator.

---

# PHASE 6 — WORLD SIMULATION

## Goal

Move from one loaded watershed to a persistent world capable of supporting many sites and long spans of time.

---

### P6-01 — Regional world representation

**Depends on:** P1-01, P0-05

**Acceptance test:** many local sites can exist inside a larger spatial region with stable coordinates.

### P6-02 — Macro terrain generation

**Depends on:** P6-01

**Acceptance test:** generated elevation forms coherent drainage basins rather than isolated random heightfields.

### P6-03 — Regional hydrology

**Depends on:** P6-02, P1-03

**Acceptance test:** rivers originate, merge, flow downhill, and terminate coherently across the regional map.

### P6-04 — Climate model

**Depends on:** P6-02, P4-01

**Acceptance test:** geography produces spatial variation in temperature/precipitation influencing biomes.

### P6-05 — Biomes

**Depends on:** P6-04, P4-02, P4-05

**Acceptance test:** different regions generate distinct plant/animal communities from climate/environment parameters.

### P6-06 — Site generation

**Depends on:** P6-01, P5-16

**Acceptance test:** settlements/sites can be instantiated with persistent location, population, structures, and history.

### P6-07 — Offscreen simulation LOD

**Depends on:** P6-06

**Acceptance test:** an unloaded site advances plausibly while preserving conservation/accounting invariants selected for simulation.

### P6-08 — Site activation/deactivation

**Depends on:** P6-07, P0-06

**Acceptance test:** zooming into an abstracted site reconstructs a detailed simulation consistent with its macro state.

### P6-09 — Travel network

**Depends on:** P6-01, P6-06

**Acceptance test:** entities/groups can travel between sites with time/cost based on geography.

### P6-10 — Resource geography

**Depends on:** P6-02, P0-07

**Acceptance test:** raw materials occur according to world geology/ecology and constrain settlement economies.

### P6-11 — World wildlife populations

**Depends on:** P6-05, P4-08

**Acceptance test:** regional species populations persist and affect local site encounters.

### P6-12 — World-scale disasters

**Depends on:** P6-03, P6-04, P0-08

**Acceptance test:** drought/flood/fire or similar disturbances arise from world state and propagate consequences into sites.

### P6-13 — Deep-time simulator

**Depends on:** P6-07, P5-16

**Acceptance test:** the world can advance centuries headlessly while preserving valid genealogical, settlement, ecological, and event references.

---

## PHASE 6 GATE

The game can generate and simulate a world containing multiple persistent settlements and ecosystems across centuries.

**Playable state:** world-history generator plus colony game.

---

# PHASE 7 — WAR, POLITICS & CIVILIZATION

## Goal

Allow settlements to become polities, economies, alliances, rivals, armies, and civilizations.

---

### P7-01 — Organizations

**Depends on:** P5-11, P6-06

**Acceptance test:** individuals can belong to persistent groups with roles and shared assets.

### P7-02 — Settlements as political entities

**Depends on:** P7-01

**Acceptance test:** a settlement has leadership, population, territory claims, resources, and diplomatic identity.

### P7-03 — Trade between sites

**Depends on:** P3-18, P6-09, P7-02

**Acceptance test:** shortages/surpluses create physical inter-site trade flows.

### P7-04 — Markets/value model

**Depends on:** P7-03

**Acceptance test:** relative scarcity changes exchange value without per-item scripted prices.

### P7-05 — Migration

**Depends on:** P6-09, P7-02, P5-03

**Acceptance test:** individuals/households can move because of opportunity, danger, kinship, or displacement.

### P7-06 — Diplomacy

**Depends on:** P7-02, P5-13

**Acceptance test:** group relations change from actual interactions, treaties, harms, aid, and interests.

### P7-07 — Territory

**Depends on:** P7-02, P6-01

**Acceptance test:** overlapping claims can be represented and become a cause of conflict.

### P7-08 — Government forms

**Depends on:** P5-11, P7-01

**Acceptance test:** leadership selection/succession differs between data-defined government structures.

### P7-09 — Law and justice expansion

**Depends on:** P5-12, P7-08

**Acceptance test:** investigation, accusation, judgment, and punishment operate on witnessed/evidenced actions.

### P7-10 — Combat anatomy

**Depends on:** P1-16, P4-05

Implement body parts/tissues, attacks, wounds, pain, bleeding, mobility impairment.

**Acceptance test:** identical attacks to different body regions produce mechanically different consequences.

### P7-11 — Weapons and armor

**Depends on:** P7-10, P3-17

**Acceptance test:** material, geometry, attack, armor, and tissue properties determine injury resolution.

### P7-12 — Medical treatment

**Depends on:** P7-10, P3-06

**Acceptance test:** treatment modifies wound states through physical/biological mechanisms.

### P7-13 — Predatory raids

**Depends on:** P7-10, P6-09

**Acceptance test:** hostile creatures/groups can enter a site for resources or prey using ordinary travel/navigation.

### P7-14 — Military organizations

**Depends on:** P7-01, P7-10

**Acceptance test:** units can train, equip, organize, and receive mission objectives without separate combat-only creature models.

### P7-15 — Battles

**Depends on:** P7-14, P6-09

**Acceptance test:** site-scale battles use ordinary creatures/items/injuries and generate persistent casualties/artifacts/events.

### P7-16 — Wars

**Depends on:** P7-06, P7-15

**Acceptance test:** multiple battles and territorial/political objectives can compose into one historically tracked war.

### P7-17 — Civilization formation

**Depends on:** P7-02, P7-08, P7-16

**Acceptance test:** multiple settlements can form a durable civilization with institutions and shared historical identity.

### P7-18 — Collapse and succession

**Depends on:** P7-17, P5-16

**Acceptance test:** civilizations can fragment, disappear, or be replaced while their sites, artifacts, descendants, and history persist.

---

## PHASE 7 GATE

World generation can produce trade, migration, political organization, raids, battles, wars, territorial change, and civilization rise/fall from shared systems.

**Playable state:** civilization simulator.

---

# PHASE 8 — CHRONICLE

## Goal

Turn the causal history database into a playable way of exploring the world.

Chronicle is not a fake lore generator.

It is a readable interface over simulation truth.

---

### P8-01 — Historical query API

**Depends on:** P0-08, P5-16, P7-18

**Acceptance test:** query people, sites, objects, events, relationships, wars, constructions, and causal links by stable ID.

### P8-02 — Timeline browser

**Depends on:** P8-01

**Acceptance test:** player can browse chronological events from world scale down to one individual.

### P8-03 — Historical figure pages

**Depends on:** P8-01

**Acceptance test:** every displayed claim links to authoritative simulation records.

### P8-04 — Site histories

**Depends on:** P8-01

**Acceptance test:** ownership, population, disasters, constructions, battles, and cultural changes can be reconstructed.

### P8-05 — Artifact histories

**Depends on:** P5-09, P7-15, P8-01

**Acceptance test:** an old object can show maker, owners, locations, use in events, theft, loss, recovery, and current state.

### P8-06 — Genealogy

**Depends on:** P5-05, P8-01

**Acceptance test:** lineage can be traversed across many generations with no duplicated or broken identity references.

### P8-07 — Maps through time

**Depends on:** P6-01, P8-01

**Acceptance test:** player can inspect political/site changes at different historical dates.

### P8-08 — Causal history view

**Depends on:** P1-22, P8-01

**Acceptance test:** major disasters/conflicts can display upstream causal chains where recorded.

### P8-09 — Generated prose summaries

**Depends on:** P8-01

**Acceptance test:** prose never invents a person, motive, event, relationship, or outcome absent from structured history.

### P8-10 — Search and cross-reference

**Depends on:** P8-01

**Acceptance test:** a player can find every historical record involving a selected beaver, artifact, site, or organization.

---

## PHASE 8 GATE

A world simulated for centuries becomes intelligible as a network of inspectable lives, places, objects, causes, and events.

**Playable state:** interactive historical archive.

---

# PHASE 9 — WAYFARER

## Goal

Allow the player to inhabit one creature inside the same simulated world.

No separate adventure-world ruleset.

---

### P9-01 — Direct creature control

**Depends on:** P1-05, P1-04

**Acceptance test:** player control replaces decision selection for one creature while preserving the ordinary movement/body systems.

### P9-02 — Local interaction verbs

**Depends on:** P9-01, P1-09

**Acceptance test:** pickup, drop, use, eat, drink, open, climb, swim, speak, and attack operate on ordinary world entities.

### P9-03 — Conversation

**Depends on:** P5-04, P5-07, P5-13

**Acceptance test:** conversation options/outcomes depend on identity, knowledge, relationship, culture, and situation.

### P9-04 — Personal travel

**Depends on:** P6-09, P9-01

**Acceptance test:** the controlled character can move between the same persistent sites used by world simulation.

### P9-05 — Survival adventure loop

**Depends on:** P1-06, P4-01, P4-05

**Acceptance test:** food, sleep, weather, injury, water, and danger remain the same mechanics as colony mode.

### P9-06 — Personal combat

**Depends on:** P7-10, P7-11

**Acceptance test:** direct-control combat resolves through the same anatomy/material systems as simulated battles.

### P9-07 — Personal reputation and consequences

**Depends on:** P5-13, P7-09

**Acceptance test:** crimes, aid, violence, theft, kinship, and heroism alter persistent social/history state.

### P9-08 — Companions

**Depends on:** P9-03, P5-04

**Acceptance test:** autonomous characters can accompany the player for social/systemic reasons while retaining ordinary AI.

### P9-09 — Quests as world situations

**Depends on:** P8-01, P9-03

**Acceptance test:** objectives reference actual world entities/problems rather than spawning disposable quest copies.

### P9-10 — Return to colony/world mode

**Depends on:** P9-01 through P9-09

**Acceptance test:** changes made during Wayfarer remain true when returning to colony/history views.

---

## PHASE 9 GATE

The player can walk into a historically generated settlement, meet descendants of simulated figures, steal or recover an old artifact, alter relationships, survive a journey, and return to colony mode with those consequences intact.

**Playable state:** adventure mode inside the same world.

---

# PHASE 10 — DWARF FORTRESS PARITY AUDIT

## Goal

Audit Damn Beavers against the full parity checklist by **behavioral depth**, not copied theme, names, UI, lore, or implementation.

This phase is where all remaining parity gaps are closed.

---

## 10.1 Parity domains

Every system from the parity checklist must map into one or more of these domains:

1. World
2. Matter/materials
3. Environment/fluids
4. Creatures/anatomy
5. Health/medicine
6. Cognition/psychology
7. Society/relationships
8. Economy/items
9. Construction/industry
10. Combat/security
11. Ecology
12. History/civilizations

---

### P10-01 — World parity audit

**Depends on:** P6-13

Audit:

- geology
- terrain
- rivers
- climate
- biomes
- sites
- regions
- resources
- disasters
- deep time

**Acceptance test:** every world-domain parity row is marked PASS, ADAPTED, EXCEEDED, or intentionally OUT_OF_SCOPE with written rationale.

---

### P10-02 — Matter parity audit

**Depends on:** P3-18, P4-15

Audit:

- material properties
- temperature
- phase/state
- liquids
- containers
- contamination
- reactions
- decay
- density/mass
- structural behavior

**Acceptance test:** all checklist interactions have a universal mechanistic implementation or documented beaver-world analogue.

---

### P10-03 — Creature/anatomy parity audit

**Depends on:** P7-12

Audit:

- body parts
- tissues
- movement
- senses
- needs
- metabolism
- wounds
- pain
- blood/fluids
- disability
- death
- corpses

**Acceptance test:** representative multi-system injury scenarios resolve without special-case death scripts.

---

### P10-04 — Cognition parity audit

**Depends on:** P5-03

Audit:

- traits
- preferences
- memories
- stress
- emotions
- needs
- goals
- decisions
- learning
- knowledge

**Acceptance test:** long-lived individuals develop measurably divergent behavior from different histories.

---

### P10-05 — Society parity audit

**Depends on:** P7-09

Audit:

- family
- friendship
- rivalry
- leadership
- norms
- law
- reputation
- organizations
- culture
- belief

**Acceptance test:** social consequences can be traced to persistent relationships, institutions, knowledge, and events.

---

### P10-06 — Economy parity audit

**Depends on:** P7-04

Audit:

- items
- ownership
- stockpiles
- workshops
- skills
- quality
- value
- trade
- logistics
- scarcity

**Acceptance test:** a resource shortage can propagate through production, trade, labor, consumption, prices/value, and migration.

---

### P10-07 — Construction parity audit

**Depends on:** P3-16

Audit:

- terrain modification
- buildings
- rooms
- bridges
- supports
- gates
- canals
- mechanisms
- power
- structural failure

**Acceptance test:** a complex hydraulic/industrial facility can be built entirely through reusable components.

---

### P10-08 — Combat/medicine parity audit

**Depends on:** P7-16

Audit:

- attacks
- weapons
- armor
- body interaction
- injury
- incapacitation
- treatment
- recovery
- permanent disability
- battlefield history

**Acceptance test:** combat outcomes depend materially on bodies, equipment, skill, location, and treatment.

---

### P10-09 — Ecology parity audit

**Depends on:** P4-16

Audit:

- plants
- animals
- food webs
- reproduction
- habitat
- seasons
- succession
- disease
- extinction/local depletion
- environmental feedback

**Acceptance test:** player engineering can cause beneficial and harmful ecosystem changes through ordinary environmental systems.

---

### P10-10 — History/civilization parity audit

**Depends on:** P8-10, P7-18

Audit:

- historical figures
- sites
- artifacts
- offices
- conflicts
- migrations
- civilization
- cultural memory
- succession
- legends/records

**Acceptance test:** a 1,000-year world produces coherent inspectable chains linking present entities to past events.

---

### P10-11 — Emergent-interaction torture suite

**Depends on:** P10-01 through P10-10

Build automated/systemic scenarios designed to discover unexpected interactions.

Examples:

- hydraulic structure fails during freezing conditions
- flood isolates food stockpile
- starvation shifts labor availability
- abandoned infrastructure deteriorates
- predator enters new wetland habitat
- death changes family mood/productivity
- labor shortage delays repairs
- further failure changes river course
- settlement migrates
- later culture mythologizes the disaster

**Acceptance test:** at least 100 multi-system scenario tests run in CI and no test depends on a scripted outcome event.

---

## PHASE 10 GATE

The parity matrix has no unexplained red rows.

Damn Beavers need not look like Dwarf Fortress.

It must demonstrate comparable **systemic density, causal interoperability, persistence, and emergent possibility**.

**Playable state:** feature-parity civilization simulation.

---

# PHASE 11 — SYSTEMS DWARF FORTRESS DOESN'T HAVE

## Goal

Stop being a clone in mechanics as well as theme.

Use the simulation foundation to push beyond the reference point.

---

### P11-01 — High-fidelity watershed engineering

**Depends on:** P4-10, P6-03

Features:

- changing channels
- pond chains
- sediment deposition
- seepage
- bank saturation
- watershed-scale engineering

**Acceptance test:** a multi-dam complex can alter downstream hydrograph, sediment pattern, wetland area, and settlement access over decades.

---

### P11-02 — Ecological engineering model

**Depends on:** P4-16

**Acceptance test:** beaver construction can produce habitat mosaics with measurable knock-on effects across multiple species.

---

### P11-03 — Fluid composition

**Depends on:** P3-08, P4-15

Liquids become mixtures rather than names.

Potential components:

- water
- alcohol
- nutrients
- silt
- salt
- toxins
- pathogens
- organic matter

**Acceptance test:** mixing two liquid volumes conserves components and downstream systems respond to resulting composition.

---

### P11-04 — Metabolism and intoxication

**Depends on:** P11-03, P1-13, P7-10

**Acceptance test:** consuming fermented liquid changes blood/body chemistry and motor/cognitive performance through metabolism rather than `BeaverGetsDrunk`.

---

### P11-05 — Dynamic river morphology

**Depends on:** P4-10, P11-01

**Acceptance test:** long-term erosion/deposition can shift a channel enough to invalidate old infrastructure.

---

### P11-06 — Knowledge propagation

**Depends on:** P5-02, P9-03

Track who knows what and how they learned it.

**Acceptance test:** an unwitnessed event is not globally known; knowledge spreads through observation, conversation, records, or evidence.

---

### P11-07 — Rumor, distortion, and folklore

**Depends on:** P11-06, P5-08

**Acceptance test:** retold information can diverge from authoritative history while Chronicle preserves both actual event and believed version.

---

### P11-08 — Cultural evolution

**Depends on:** P5-07, P11-07, P6-13

**Acceptance test:** norms, symbols, practices, and narratives drift measurably across separated populations over centuries.

---

### P11-09 — Technological knowledge as culture

**Depends on:** P3-16, P11-06

**Acceptance test:** a settlement cannot construct a technology it has never discovered or learned, even if the player knows the recipe.

---

### P11-10 — Invention

**Depends on:** P11-09, P5-01

**Acceptance test:** new processes/designs can arise from knowledge, experimentation, needs, and available materials rather than fixed global unlock dates.

---

### P11-11 — Infrastructure memory

**Depends on:** P8-04, P11-06

**Acceptance test:** later societies can encounter, misunderstand, reuse, repair, or mythologize abandoned constructions from older civilizations.

---

### P11-12 — Simulation-backed natural-language explanation

**Depends on:** P1-22, P8-01

**Acceptance test:** generated explanations cite only retrievable authoritative states/events and can expose the underlying causal graph.

---

### P11-13 — Counterfactual replay/debugging

**Depends on:** P0-04, P0-08, P11-12

**Acceptance test:** developers can fork a saved deterministic state, alter one decision/input, and compare causal outcomes.

---

### P11-14 — Multi-scale continuous simulation

**Depends on:** P6-07, P6-08

**Acceptance test:** local detailed simulation and world abstraction transition without duplicating or losing important entities/events.

---

### P11-15 — Environmental acoustics and signals

**Depends on:** P0-05, P4-05

Support sound/signal propagation for warnings, animal behavior, social coordination, danger, and machinery.

**Acceptance test:** a signal's reach depends on source, distance, obstruction, and environment instead of global awareness.

---

### P11-16 — Scent/chemical traces

**Depends on:** P4-15, P4-05

**Acceptance test:** a creature can locate or avoid something using a transported environmental trace rather than omniscient AI.

---

### P11-17 — Engineering design knowledge

**Depends on:** P11-09, P3-10

**Acceptance test:** structures can embody design concepts and builders can copy, modify, improve, or forget them.

---

### P11-18 — Cultural landscape transformation

**Depends on:** P11-05, P11-08, P11-11

**Acceptance test:** centuries of settlements leave physical and ecological signatures visible to later inhabitants.

---

### P11-19 — Millennia-scale archaeology

**Depends on:** P8-05, P11-11, P11-18

**Acceptance test:** artifacts, ruins, sediment, burials, and altered landscapes can preserve partial evidence after original records/knowledge disappear.

---

### P11-20 — Emergence benchmark suite

**Depends on:** all prior phases

The final benchmark is not a list of scripted scenarios to reproduce exactly.

It is a library of initial conditions testing whether rich causal stories can occur.

Required benchmark families:

- hydraulic disaster
- ecological cascade
- industrial accident
- family tragedy
- political crisis
- migration
- war
- technological diffusion
- historical misremembering
- rediscovery of ruins
- intoxication/contamination accident
- infrastructure collapse
- animal-driven catastrophe
- long-term climate/ecology shift

**Acceptance test:** each benchmark produces coherent, inspectable causal histories from universal systems across many seeds, including outcomes the developers did not explicitly author.

---

## PHASE 11 GATE

Damn Beavers is no longer defined by whether it matches Dwarf Fortress.

It has become its own deep simulation platform centered on hydrology, ecology, engineering, social memory, and causal history.

**Playable state:** the intended final game.

---

# 4. Cross-phase mandatory infrastructure

These are not separate content phases. They must mature continuously.

---

## A. Testing

Every system requires:

1. unit tests for invariants
2. headless simulation tests
3. save/load tests
4. deterministic replay tests where applicable
5. cross-system interaction tests
6. regression seeds for discovered emergent bugs

A bug that creates an interesting outcome should generally become a regression test before being fixed.

---

## B. Performance

Optimization order:

```text
correctness
→ observability
→ profiling
→ data layout
→ incremental updates
→ simulation LOD
→ parallelism
→ GPU/compute specialization only where justified
```

Never sacrifice causal truth to hide a performance problem unless the approximation is explicit and invariant-preserving.

---

## C. Save compatibility

Persistent IDs and event history make save integrity unusually important.

Every release capable of creating player saves should define:

- save version
- migration path
- validation
- broken-reference detection
- recovery policy

---

## D. Explanation/debugging

Every major subsystem should answer:

```text
What is happening?
Why is it happening?
What is preventing this?
What changed?
What caused that change?
Which entities participated?
```

The player-facing explanation system and developer debugger should share the same underlying causal data.

---

## E. Mod/data architecture

Definitions that can reasonably be data should be data:

- species
- materials
- items
- workshops
- recipes
- needs
- traits
- jobs
- constructions
- laws
- government forms
- cultural values

But data-driven does not mean scripted-outcome-driven.

---

# 5. AI coding team execution protocol

No agent receives the instruction:

> "Implement Phase 4."

Tasks should be issued at feature-ID granularity.

Example:

```text
Implement P1-11 — Dam structure and hydraulic interaction.

Prerequisites already passing:
P1-03
P1-10
P0-07

Constraints:
- no flood event scripts
- obstruction must emerge from geometry/material/permeability
- must preserve deterministic replay
- must expose debug state

Required output:
1. implementation
2. unit tests
3. headless acceptance scenario
4. save/load regression
5. debug visualization
6. documentation
7. proof that P1-11 acceptance test passes
```

---

## Definition of Done for every feature

A feature is not DONE until:

- [ ] prerequisites pass
- [ ] authoritative simulation implementation exists
- [ ] no prohibited bespoke outcome script was introduced
- [ ] unit/invariant tests pass
- [ ] headless acceptance test passes
- [ ] save/load behavior passes when relevant
- [ ] deterministic replay passes when relevant
- [ ] debug/inspection surface exists
- [ ] player UI exists when required by the current phase
- [ ] events/causal state are recorded when relevant
- [ ] performance budget is measured
- [ ] roadmap/parity matrix status is updated

---

# 6. Scope discipline

Until Milestone 0 passes, do **not** prioritize:

- giant world generation
- hundreds of species
- elaborate combat
- politics
- trade caravans
- advanced crafting trees
- procedural mythology
- adventure mode
- cinematic presentation
- giant cities
- multiplayer
- thousands of item types

The correct question before Milestone 0 is always:

> Does this make the seven-beavers watershed more causally complete?

If not, it waits.

---

# 7. Milestone ladder

```text
M0  Seven beavers beside a stream
    ↓
M1  Self-sustaining lodge
    ↓
M2  Engineered colony economy
    ↓
M3  Multi-season living ecosystem
    ↓
M4  Multi-generation society
    ↓
M5  Multi-site persistent world
    ↓
M6  Civilizations, trade and war
    ↓
M7  Chronicle
    ↓
M8  Wayfarer
    ↓
M9  Full DF parity audit passed
    ↓
M10 Damn Beavers exceeds its reference point
```

Every milestone should be shippable internally as a game.

---

# 8. Immediate implementation queue

The first coding queue is deliberately boring.

```text
01. P0-01 Simulation clock
02. P0-02 Stable entity identity
03. P0-03 Universal component/state model
04. P0-04 Seeded random streams
05. P0-05 Spatial world representation
06. P0-07 Material definition system
07. P0-09 Terrain and strata
08. P0-06 Versioned persistence schema
09. P0-08 Event and causality log
10. P0-10 Plants and trees
11. P0-11 Headless simulation runner
12. P0-12 Debug inspection layer
13. P1-01 Watershed map generator
14. P1-02 Water volume
15. P1-03 Flow/drainage/hydraulic obstruction
16. P1-04 Unified terrestrial/aquatic navigation
17. P1-05 Beaver creature model
18. P1-06 Basic needs
19. P1-07 Job/order architecture
20. P1-08 Tree cutting
21. P1-09 Physical items and hauling
22. P1-10 Construction jobs
23. P1-11 Dam hydraulic interaction
24. P1-12 Accessibility recomputation
25. P1-13 Food and drink
26. P1-14 Sleep
27. P1-15 Temperature exposure
28. P1-16 Injury/death
29. P1-17 Ecology response
30. P1-18 Weather/day-night
31. P1-19 Relationships baseline
32. P1-20 Minimal UI
33. P1-21 Full watershed persistence
34. P1-22 Causal explanation query
35. MILESTONE 0 ACCEPTANCE RUN
```

Nothing later in the roadmap is allowed to jump this queue merely because it is more exciting.

---

# 9. The first canonical emergence test

This should become a permanent automated/regression scenario.

## THE POND TEST

Initial state:

- seven beavers
- flowing stream
- dry bank route
- trees
- food
- planned dam site
- one low-lying ecological patch
- one object/creature whose accessibility depends on the low route

Player commands:

```text
designate trees
designate dam
```

No other scripted instructions.

Expected classes of consequence:

```text
tree becomes logs
→ logs are hauled
→ dam gains physical material
→ hydraulic resistance increases
→ upstream depth increases
→ low route becomes submerged
→ path costs/connectivity change
→ agent choices change
→ vegetation moisture changes
→ aquatic habitat changes
→ something may become inaccessible, displaced, injured, or killed
→ event history records the actual outcome
→ explanation system reconstructs why
```

The exact victim, timing, route, labor assignment, and ecological consequence are allowed to vary.

That variability is the point.

---

# 10. Final project criterion

Damn Beavers succeeds when the player can tell stories the developers never explicitly wrote, and the simulator can still answer:

> **Exactly why did that happen?**

The answer should ultimately resolve to ordinary properties of the world:

```text
matter
energy
water
terrain
bodies
needs
knowledge
relationships
labor
ownership
structures
ecology
institutions
history
```

—not a hidden story script.

That is the nucleus from which the entire game should grow.
