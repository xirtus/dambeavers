# The prompt

This is the autonomous build prompt for **Damn Beavers**.

```text
I want you to build Damn Beavers: a beautiful 3D beaver-civilization simulator with the systemic depth, emergent interactions, persistence, history, and surprising causal complexity that make Dwarf Fortress extraordinary, but with an original beaver ecology, hydrology, engineering, culture, terminology, art direction, and world.

Read AGENTS.md, DAMN_BEAVERS_MASTER_ROADMAP.md, docs/ARCHITECTURE_CONTRACT.md, docs/M0_ONE_WATERSHED.md, TASKS.md, and the systems/parity checklists. Treat the roadmap dependency order and TASKS.md as authoritative. Do not try to build the whole game at once.

Fan out sub-agents for architecture, simulation correctness, hydrology, pathfinding, persistence, tests, performance, UI, and visual quality. Work one unblocked feature ID at a time. /loop on each feature until its objective acceptance test passes, save/reload and deterministic replay pass where relevant, and a separate harsh critic sub-agent cannot find a fake, brittle special case, missing causal interaction, or serious quality problem.

The absolute architectural rule is: systems, not scripted outcomes. Do not implement DamFloodEvent; implement water + flow + obstruction + permeability + structure. Do not teleport resources or script beaver reactions. The renderer observes the authoritative simulation; it does not own reality. Every important persistent entity gets a stable ID and important outcomes must be explainable through a causal/event chain.

The first target is Milestone 0: Seven beavers arrive beside a stream. They can cut trees, create and haul physical logs, eat, drink, sleep, swim, and build a dam through the ordinary jobs system. The dam actually obstructs simulated water. Water backs up. The changed water level changes real path accessibility. Beaver AI responds normally. Ecology responds to the changed water. Something can be stranded, displaced, injured, drowned, or otherwise affected accidentally. Save in the middle, reload, and everything is still true. The game must be able to explain exactly why the resulting chain happened.

Make the tiny One Watershed slice visually exceptional as well as mechanically real. Have a separate visual critic inspect the game repeatedly for terrain, water, beavers, animation, camera, UI, readability, atmosphere, performance, and overall polish. Do not let visual effects fake simulation state.

Begin at P0-01 and continue through the dependency tree. Stop expansion at each phase gate until the entire gate passes. Do not add later-phase features early. For every completed feature update TASKS.md with evidence.

Don't stop because a feature merely works once. /loop until it is robust, inspectable, tested, persistent where required, performant enough for the current milestone, and genuinely impressive. Fan out sub-agents and ultracode.
```
