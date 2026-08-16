# M0_ONE_WATERSHED.md

# Milestone 0 — Seven Beavers Arrive Beside a Stream

## Purpose

This is the first complete playable nucleus of **Damn Beavers**.

It is intentionally tiny.

Do not expand the scope until this milestone is exceptional.

---

# Player fantasy

A small band of seven beavers arrives at an untouched stream valley.

The player does not control them like RTS units.

The player marks intentions:

- cut trees
- move materials
- build structures
- build a dam

The beavers interpret those intentions through their ordinary needs, skills, jobs, inventories, navigation, swimming, relationships, and available resources.

The watershed responds physically.

The colony responds systemically.

---

# Required starting state

A generated watershed contains:

- one flowing stream
- banks
- a low floodplain
- soil and rock
- slopes
- dry paths
- trees
- basic vegetation
- enough food for initial survival
- seven individually persistent beavers
- at least one location suitable for a lodge
- at least one viable dam site
- one low route whose accessibility can change when water rises

The exact map must be generated from a seed rather than handcrafted solely for this test.

---

# The seven beavers

Each starting beaver must have at minimum:

- stable ID
- generated/display name
- world position
- locomotion state
- swimming capability
- hunger
- thirst
- fatigue
- basic temperature/exposure state
- health/alive state
- inventory
- skill set
- work eligibility
- current job
- persistent relationships baseline

The seven must not be clones in identity even if their early simulation parameters are simple.

---

# Required player actions

Milestone 0 must be playable using normal UI.

The player can:

- pause/unpause
- change simulation speed
- move/zoom the camera
- inspect a beaver
- inspect a tree/log/construction
- inspect terrain/water
- designate trees for cutting
- designate construction
- order a dam
- see basic alerts
- save
- load

No developer console may be required to complete the milestone.

---

# Canonical work chain

The first critical chain is:

```text
player marks tree
→ designation becomes available work
→ eligible beaver evaluates jobs
→ beaver selects/reserves cutting job
→ beaver finds a route
→ beaver travels to a valid work position
→ beaver performs cutting work
→ tree state changes
→ physical logs are created from tree material/mass
→ logs remain where they physically are
→ hauling work becomes available
→ another or same beaver claims haul
→ beaver travels to log
→ log becomes carried/dragged physical inventory
→ beaver moves it to destination
→ log is delivered
```

Every arrow must represent an inspectable ordinary system.

---

# Construction chain

```text
player designates dam footprint
→ construction jobs are created
→ required materials are determined
→ physical logs are reserved
→ logs are hauled to site
→ labor is performed
→ construction geometry/state changes
→ hydraulic obstruction changes because geometry/material changed
```

Cancellation before completion must leave sensible physical consequences.

Materials may not vanish into a hidden construction counter.

---

# Hydrology contract

The stream must be simulated well enough to exhibit:

- local water quantity/depth
- downhill flow
- lateral spread
- inflow
- outflow
- accumulation
- drainage
- obstruction
- permeability
- overtopping or bypass where geometry permits

The dam must affect flow because it physically changes the channel's resistance/available cross-section/permeability.

Do not implement a `dam complete → increase pond` rule.

---

# Navigation contract

Pathfinding must consume current authoritative world state.

Path costs or accessibility should reflect at minimum:

- terrain
- slope
- occupancy
- shallow water
- deep water
- swimming ability

When the pond rises:

- some dry cells become wet,
- some routes become more expensive,
- some routes become impossible for walkers,
- swimming beavers may still traverse them,
- jobs may become unreachable,
- agents may choose alternative routes or work.

Do not manually notify pathfinding that "the dam flooded the road."

It should discover changed traversability from world state.

---

# Survival contract

At minimum beavers can:

- eat
- drink
- sleep
- swim
- become hungry
- become thirsty
- become exhausted
- experience basic thermal exposure
- drown
- starve
- die from a minimal set of systemic causes

Needs must produce ordinary AI pressure.

A beaver should be capable of abandoning low-priority work to meet an urgent need.

---

# Ecology contract

This is not yet a complete ecosystem.

Milestone 0 only needs enough ecology to prove feedback.

At minimum:

- trees/plants possess persistent state
- trees can regrow or begin a regrowth lifecycle
- vegetation has a moisture/flooding suitability
- a minimal fish or wetland-animal population/presence can exist
- changed water level modifies at least one ecological condition

A dam-created pond must not simply swap an art prefab from "grass" to "wetland."

The environmental state must change first.

---

# Weather and time

Milestone 0 includes:

- simulation clock
- day/night
- basic ambient temperature
- simple weather state
- precipitation capable of becoming real hydrological input

Rain should add water to the same hydrology system used by the stream and dam.

---

# Persistence contract

The game must save and reload:

- seed/world identity
- time
- weather
- terrain state
- water state required for continuation
- beavers
- needs
- health
- positions
- inventories
- jobs
- reservations
- physical logs/items
- constructions
- plants
- relationships
- event/causal history

Canonical persistence test:

> Save while a beaver is carrying a log to an incomplete dam while upstream water is already rising. Reload. Continue. The world must remain logically and deterministically coherent.

---

# Causal explanation contract

The milestone must support a primitive:

> **Why did this happen?**

It may initially be developer-oriented, but it must use structured authoritative state/events.

Minimum queries:

- Why can't this beaver reach that?
- Why is this job stalled?
- Why did this water level rise?
- Why did this plant decline?
- Why did this creature die?

Example acceptable chain:

```text
Beaver B-0007 died from oxygen deprivation
← remained submerged for 48.2 simulated seconds
← entered deep-water cell C(82,41,-2)
← attempted route to Stockpile S-0003
← former dry route had become submerged
← Pond W-0002 rose 1.37 m
← discharge through channel section fell
← Dam D-0006 added three log segments
← player designated construction at tick 18420
```

The explanation does not need literary prose yet.

The chain needs to be true.

---

# THE POND TEST

This is the canonical Milestone 0 integration test and should become a permanent regression scenario.

## Initial conditions

- deterministic seed
- seven beavers
- stream with measurable inflow/outflow
- several harvestable trees
- dry route through low ground
- prospective pond basin
- one ecological patch sensitive to flooding
- one object/creature/work destination whose accessibility depends on the low route

## Player command stream

Only:

```text
designate trees
designate dam
```

plus ordinary camera/UI/save actions.

No scripted command tells any specific beaver what to do.

## Expected classes of outcome

```text
trees are cut
→ physical logs appear
→ hauling jobs appear
→ agents move logs
→ dam acquires real material
→ flow resistance increases
→ upstream water depth increases
→ low terrain becomes submerged
→ path network changes
→ agent choices change
→ ecological suitability changes
→ an object, creature, job, or route may be stranded/displaced/harmed
→ event history records what actually occurred
→ explanation system reconstructs why
```

The exact worker, route, victim, timing, and ecological side effect are allowed to vary.

Variation is desirable.

---

# Acceptance checklist

Milestone 0 is COMPLETE only when:

- [ ] deterministic watershed generation works
- [ ] seven persistent beavers spawn
- [ ] beavers can walk
- [ ] beavers can swim
- [ ] beavers can eat
- [ ] beavers can drink
- [ ] beavers can sleep
- [ ] beavers can autonomously select jobs
- [ ] tree designation creates cutting work
- [ ] tree cutting creates physical log entities
- [ ] logs can be physically hauled
- [ ] dam construction consumes delivered physical materials
- [ ] dam geometry obstructs simulated water
- [ ] upstream water level rises as an emergent hydraulic result
- [ ] changed water level changes navigation/pathability
- [ ] beavers react through normal AI/jobs
- [ ] changed water affects at least one ecological state
- [ ] drowning/death can occur through ordinary survival mechanics
- [ ] all major entities have stable IDs
- [ ] important outcomes enter the event/causality log
- [ ] "Why?" queries can reconstruct representative causal chains
- [ ] save during active work succeeds
- [ ] reload restores authoritative state
- [ ] continued simulation after reload is coherent
- [ ] normal player UI can perform the scenario
- [ ] no milestone prohibition has been violated

---

# Explicitly out of scope for M0

Do not delay M0 for:

- deep personalities
- detailed families/reproduction
- advanced medicine
- combat
- predators
- metallurgy
- giant workshop trees
- migration
- trade
- government
- law
- religion
- procedural mythology
- civilization simulation
- global world generation
- Chronicle UI
- Wayfarer mode
- hundreds of animals/plants
- photoreal cinematic presentation

---

# M0 quality question

At the gate, do not ask:

> "Does it have enough features?"

Ask:

> **"Is this tiny watershed already capable of surprising us for reasons we can inspect and explain?"**

If yes, the project has a nucleus worth expanding.
