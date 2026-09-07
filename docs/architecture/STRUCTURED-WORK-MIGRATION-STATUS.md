# Structured Work Migration — Execution Status

Governing plan: `docs/architecture/STRUCTURED-WORK-MIGRATION-V1.md`

This file is the compact cross-pass status ledger. The governing architecture remains in the migration plan and corpus audit; this file records what has actually become real.

## Current position

- Release: **A — Semantic Foundation**
- Completed through: **A2 — Define Work Grammar V1 contracts and governed vocabularies**
- Next authorized step: **A3 — Map existing database rails to the grammar**
- Canonical schema changes made so far: **none**

## A1 — complete

A1 established the following boundaries:

1. The only inventoried application-level prose-first operational writers are explicitly quarantined as compatibility debt:
   - `manual-task-v1` → `app/api/atlas/manual-task/route.ts` → `create_manual_task_v1`
   - `project-task-v1` → `app/api/atlas/projects/[projectId]/tasks/route.ts` → `owner_operator_create_project_task_v1` / `create_project_task_v1`
2. New structured-work code has one reserved application entry boundary: `beginStructuredWorkAuthoring` in `lib/atlas/structured-work-authoring.ts`.
3. The Worker Day employee payload has been reduced to the default exposure floor. It no longer fetches or serializes `work_items.instructions`, source-work prose, or projection detail prose. The task drawer receives only task identity needed for the interaction (`id`, rendered title, completion state).
4. `tests/structured-work-a1-freeze.test.mjs` enforces the quarantine, prose-only rejection, and employee title-only boundary.

### A1 production

A1 safety behavior was released through deployment `dpl_Fe2JrsUrexquZeHsYWYUEeWcN65o`, which reached READY and serves `atlas.elmfarm.co`. Vercel validation reported 2,330 tests passed and 0 failed, and the production build completed. The Vercel release gate was restored to `deploymentEnabled: false` afterward.

## A2 — complete

A2 established the ten-box Work Grammar as application contracts without changing the canonical database schema.

Implemented:

1. `lib/atlas/work-grammar-v1-core.js` — runtime governed vocabulary and validator.
2. `lib/atlas/work-grammar-v1.ts` — TypeScript contracts for:
   - Work Act
   - Referent
   - Claim
   - Relation
   - Specification
   - Temporal Contract
   - Constraint
   - Requirement / Gate
   - Composition
   - Result Contract
3. `lib/atlas/structured-work-authoring.ts` — the single new-work application boundary is now bound to `WorkGrammarV1Package` validation.
4. The validator rejects prose/presentation escape hatches such as `title`, `instructions`, `note`, `detail`, `display_*`, `execution_*`, and scripts inside canonical semantic packages.
5. Domain `operation` remains an open governed semantic key rather than turning the 173 legacy task types into a new fixed ontology.
6. Referents require canonical identity pairs (`kind`, `id`) rather than copied display nouns.
7. Claim modality is independent from adjudication state.
8. Constraint, Requirement, and Gate are distinct contracts.
9. Composition is distinct from durable Work identity.
10. Result Contract describes typed evidence/effects rather than assuming generic `Done`.

### A2 commits

- `9a4989b90985e4668d19063ec03606429dad865a` — Work Grammar V1 runtime validator and vocabularies
- `e71070a80ea744931ad4ae4bf792234e54dd18d3` — Work Grammar V1 TypeScript contracts
- `f5fbf5934fca2595118a4bbc2ec8cef06d375644` — bind structured authoring boundary to Work Grammar V1
- `db3bd70426d4783235ebd0f154ec58034c48e963` — retain A1 invariants through A2 boundary
- `f8ea5b1c83f4d6edbe6fddbcc36040e25331e262` — A2 grammar distinction tests

### A2 validation

For A2 head `f8ea5b1c83f4d6edbe6fddbcc36040e25331e262`:

- architecture job: passed
- full test suite: passed
- Next.js production build: passed
- live source-custody job: failed at the same pre-existing `Prove live Atlas source custody` step documented before A1

A2 changes no production-facing behavior and therefore was not separately released to production. The safety behavior that mattered immediately was already released in A1.

## Known unrelated CI baseline

The live source-custody job is failing at `Prove live Atlas source custody`. This failure predates the Structured Work implementation: the governing-plan commit `6057970930579cbc248d501030022bee2833a2b1` had the same failure while its application tests/build passed. Do not attribute that live external custody issue to A1/A2 and do not silently mark it repaired.

## A3 entry condition

A3 is inspection and mapping only. It may inspect production schema and data, but it must make **no DDL and no canonical data mutation**. Every existing structured-work rail must receive one declared semantic responsibility, overlaps must be documented, and missing canonical capabilities must be isolated for A4/A5 rather than solved by creating a parallel task store.
