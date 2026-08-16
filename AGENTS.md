# AGENTS.md — Damn Beavers Coding Constitution

## Mission

Build **Damn Beavers**, a 3D systemic beaver-civilization simulator with Dwarf Fortress-class depth of interaction, but with its own beaver ecology, hydrology, engineering, culture, history, art direction, terminology, and world.

The immediate target is not "the whole game."

The immediate target is:

> **Milestone 0 — Seven beavers arrive beside a stream.**

Read these before substantial implementation:

1. `DAMN_BEAVERS_MASTER_ROADMAP.md`
2. `docs/M0_ONE_WATERSHED.md`
3. `docs/ARCHITECTURE_CONTRACT.md`
4. `TASKS.md`
5. the full Damn Beavers systems checklist
6. the DF-parity checklist

The giant checklists are reference inventories.  
The **roadmap and task ledger determine implementation order**.

---

# 1. Non-negotiable laws

## 1.1 Systems, not scripted outcomes

Never implement a named story outcome when ordinary simulation components can produce it.

Do not create logic such as:

```text
DamFloodEvent
BeaverGetsDrunk
TreeCrushesBeaverEvent
ColonyFamineEvent
BridgeCollapseEvent
```

Implement the underlying causes:

```text
water + pressure + flow + obstruction + permeability
liquid composition + ingestion + metabolism + motor control
mass + support + gravity + collision + anatomy
food + nutrition + access + population + weather
material strength + load + damage + support
```

Events may **record** what happened. Events must not secretly make it happen.

---

## 1.2 The simulation is authoritative

The renderer, animation system, UI, audio, particles, and Chronicle observe simulation state.

They do not own simulation truth.

A mesh is not a tree.  
A shader is not water.  
An animation is not work.  
A particle is not an item.  
A UI icon is not inventory.

The simulation must continue to make sense headlessly.

---

## 1.3 Stable persistent identity

Every important persistent entity receives a stable ID.

At minimum this eventually includes:

- beavers
- creatures
- plants and important trees
- items
- constructions
- buildings
- sites
- water bodies where represented persistently
- organizations
- families
- historical figures
- artifacts
- civilizations
- major events

IDs survive save/load.

Never use render-object identity or transient array position as persistent identity.

---

## 1.4 Causality must be inspectable

Important state changes should leave enough structured information to answer:

```text
What happened?
Why?
What caused that?
What blocked this?
Who/what participated?
Where and when?
```

The developer debugger and future player-facing "Why?" system should share the same authoritative causal data.

---

## 1.5 Jobs are intentions, not puppeteering

Player designations create work.

Normal flow:

```text
designation
→ available work
→ job
→ eligibility
→ agent choice
→ reservation
→ navigation
→ execution
→ completion / failure / requeue
```

Never teleport an agent or item to satisfy an order.

---

## 1.6 Physical resources are physical

If a construction needs three logs:

- three log entities must exist,
- workers must obtain them,
- they must move through the world,
- they must be delivered/reserved,
- and cancellation must leave the appropriate materials somewhere.

Do not use invisible integer resources for physical construction unless the roadmap explicitly calls for an abstract resource at that simulation scale.

---

## 1.7 Hydrology changes navigation through reality

A flooded route becomes inaccessible because water depth, locomotion capability, slope, current, or structure state changes pathability/cost.

Never write:

```text
if damBuilt:
    blockLowRoad()
```

---

## 1.8 Determinism where practical

Given the same:

- version
- seed
- starting save
- command stream
- RNG stream

a headless authoritative run should reproduce the same state.

Rendering nondeterminism is irrelevant; authoritative simulation nondeterminism is a bug unless documented and intentionally accepted.

---

## 1.9 Persistence is part of every system

Do not bolt saving on at the end.

When adding persistent state, immediately consider:

- serialization
- versioning
- stable references
- migration
- reload continuation
- deterministic replay

---

## 1.10 Do not implement future phases early

Current implementation order comes from `TASKS.md`.

A later feature may be referenced for interface design, but do not build it until its dependencies are satisfied.

Before Milestone 0, do not wander into:

- politics
- world empires
- huge crafting trees
- procedural religion
- warfare
- trade caravans
- adventure mode
- hundreds of species
- cinematic story content

unless strictly necessary to satisfy an earlier dependency.

---

# 2. Quality bar

Damn Beavers must be exceptional in **two dimensions simultaneously**.

## Simulation quality

A feature must survive hostile review for:

- correctness
- generality
- causal interoperability
- deterministic behavior where required
- save/reload integrity
- performance
- observability
- absence of special-case outcome scripts

## Presentation quality

Anything player-visible should also receive a visual/usability review for:

- readability
- animation clarity
- camera behavior
- strong environmental art direction
- water legibility
- terrain legibility
- UI clarity
- coherent scale
- responsive feel
- absence of obvious debug/prototype ugliness in milestone builds

Do not use visual polish to conceal missing simulation.

---

# 3. Required agent workflow

For each feature ID:

1. Read the feature and dependencies in `DAMN_BEAVERS_MASTER_ROADMAP.md`.
2. Verify prerequisites already pass.
3. Inspect existing implementation before designing a replacement.
4. State the invariant(s) the feature must preserve.
5. Implement the smallest universal mechanism that satisfies the feature.
6. Add or update tests.
7. Add debug observability.
8. Exercise the acceptance test.
9. Exercise save/load if persistent state changed.
10. Exercise deterministic replay if authoritative state changed.
11. Run relevant regression tests.
12. Have an independent critic pass inspect the result.
13. Fix the critic's substantive findings.
14. Update `TASKS.md`.
15. Continue only to the next unblocked task.

Do not mark a task DONE merely because code compiles.

---

# 4. Sub-agent policy

Fan out sub-agents when useful, especially for:

- architecture review
- simulation correctness
- hydrology
- pathfinding
- persistence
- testing
- performance
- UI/UX
- visual review
- adversarial "find the fake/special case" inspection

Sub-agents should not independently invent incompatible architectures.

One authoritative implementation plan wins.

A reviewer should be encouraged to reject work.

A useful critic asks:

> "Could this behavior have occurred from the universal components, or did we smuggle the desired story into the code?"

---

# 5. Definition of Done

A feature is DONE only when applicable items pass:

- [ ] prerequisites pass
- [ ] implementation exists in the authoritative simulation
- [ ] no bespoke desired-outcome script was introduced
- [ ] invariants are documented in code/tests
- [ ] unit tests pass
- [ ] headless acceptance test passes
- [ ] integration/regression tests pass
- [ ] deterministic replay passes
- [ ] save/load passes
- [ ] debug inspection exists
- [ ] player-facing representation exists if required this phase
- [ ] causal/event information is recorded if relevant
- [ ] performance has been measured where relevant
- [ ] independent critic pass completed
- [ ] `TASKS.md` status updated

---

# 6. Milestone 0 prohibition list

Milestone 0 may not be achieved with:

- scripted flood sequences
- hardcoded dry/flooded map swaps
- teleporting materials
- fake water that does not affect pathing
- animation-only tree cutting
- pre-scripted beaver reactions
- dam-specific path blocking
- save files that reconstruct approximate rather than authoritative state
- manually authored ecological consequences
- "because the scenario says so" tests

The Pond Test must arise from normal systems.

---

# 7. Scope question

When uncertain whether to add something before Milestone 0, ask:

> **Does this make the Seven-Beavers watershed more causally complete, more testable, more inspectable, or more playable?**

If not, defer it.

---

# 8. Stop conditions

Stop advancing to a later phase when:

- a phase gate fails,
- a prerequisite is fake or incomplete,
- save/reload diverges,
- deterministic tests diverge unexpectedly,
- a result only works through special-case scenario code,
- the system cannot explain a major state change,
- critical simulation state exists only in the renderer/UI.

Fix the foundation first.

---

# 9. North Star

The game succeeds when players tell stories nobody explicitly authored and the simulator can answer:

> **Exactly why did that happen?**

with a chain grounded in ordinary world properties rather than a hidden script.
