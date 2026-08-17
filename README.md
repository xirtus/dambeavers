# Damn Beavers

A systemic beaver-civilization simulator: Dwarf-Fortress-class depth built from
water, materials, bodies, needs, jobs, and causality rather than scripted outcomes.

Before touching implementation, read in this order:

1. `AGENTS.md` — the non-negotiable coding constitution.
2. `DAMN_BEAVERS_MASTER_ROADMAP.md` — dependency-ordered feature list and laws.
3. `docs/ARCHITECTURE_CONTRACT.md` — layer boundaries, determinism, persistence.
4. `docs/M0_ONE_WATERSHED.md` — the current milestone's full spec.
5. `TASKS.md` — the execution ledger. Only work on unblocked tasks.

Local build manual copies:

- `docs/BUILD_MANUAL.html` — standalone local artifact manual.
- `docs/BUILD_MANUAL.md` — Markdown ledger text.
- `docs/webpage/Damn Beavers.html` — saved Claude artifact page.
- `docs/webpage/Damn Beavers_files/saved_resource.html` — actual artifact frame
  content.
- `docs/Damn Beavers.pdf` — PDF export of the artifact.

## Development

```bash
npm install
npm test          # run the test suite once
npm run test:watch
npm run typecheck
```

## Repository shape

Grows incrementally per `docs/ARCHITECTURE_CONTRACT.md` — directories are created
when a feature needs them, not speculatively.

```text
src/sim/          authoritative simulation (renderer-agnostic)
tests/unit/       local invariants
tests/simulation/ headless acceptance tests for roadmap feature IDs
tools/debug/      developer inspection tooling
```
