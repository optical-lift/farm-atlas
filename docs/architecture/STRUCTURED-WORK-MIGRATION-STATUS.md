# Structured Work Migration — Execution Status

Governing plan: `docs/architecture/STRUCTURED-WORK-MIGRATION-V1.md`

This file is the compact cross-pass status ledger. The governing architecture remains in the migration plan and corpus audit; this file records what has actually become real.

## Current position

- Release: **A — Semantic Foundation**
- Completed through: **A1 — Freeze new prose-only operational semantics**
- Next authorized step: **A2 — Define Work Grammar V1 contracts and governed vocabularies**
- Canonical schema changes made so far: **none**

## A1 — complete

A1 established the following boundaries:

1. The only inventoried application-level prose-first operational writers are explicitly quarantined as compatibility debt:
   - `manual-task-v1` → `app/api/atlas/manual-task/route.ts` → `create_manual_task_v1`
   - `project-task-v1` → `app/api/atlas/projects/[projectId]/tasks/route.ts` → `owner_operator_create_project_task_v1` / `create_project_task_v1`
2. New structured-work code has one reserved application entry boundary: `beginStructuredWorkAuthoring` in `lib/atlas/structured-work-authoring.ts`.
3. Until A2 supplies the governed ten-box types, that boundary rejects authoring inputs that contain only prose/display/instruction fields and requires at least one non-prose semantic component.
4. The Worker Day employee payload has been reduced to the default exposure floor. It no longer fetches or serializes `work_items.instructions`, source-work prose, or projection detail prose. The task drawer receives only task identity needed for the interaction (`id`, rendered title, completion state).
5. `tests/structured-work-a1-freeze.test.mjs` enforces the quarantine, prose-only rejection, and employee title-only boundary.

## A1 commits

- `d349975da8066a1f88fe9fa12abac93a41a6821d` — register legacy prose work writers
- `7d7088583eb90a23dada90215f413e6d66a2b17d` — quarantine manual task writer
- `b56d954b05d8b6ba0cb226c4342fddf275b18bdb` — quarantine project task writer
- `005fe2ab7daf2acc9ec4de76db3a68c625c4d7f5` — inventory compatibility writers
- `285c6581d10cd8ea37e1b3d00393a1b2811e8927` — remove canonical prose from Worker Day delivery
- `9c49ead95f172d6e3ee6e24855b954b42c5cbd7d` — reduce employee drawer event payload
- `3556cfc5f335e490d68c856e9702ce22ba9d6425` — render task drawer title-only
- `69c124585d131baa596e16633eee78ef0e12ce1f` — add A1 semantic authoring gate
- `74ac2f1e5f6f583e448266e981cb403e506bc40b` — establish the single new-work entry boundary
- `64dc3ba2793b1eccff34a04f3306eee34e048bd1` — prove A1 invariants in tests

## Validation

For A1 head `64dc3ba2793b1eccff34a04f3306eee34e048bd1`:

- architecture job: passed
- full test suite: passed
- Next.js production build: passed
- live source-custody job: failed at `Prove live Atlas source custody`

The source-custody failure is a pre-existing baseline condition, not introduced by A1. The governing-plan commit `6057970930579cbc248d501030022bee2833a2b1` had the same live source-custody failure while its tests/build passed. Do not silently treat that external/live custody failure as repaired by this migration.

## A2 entry condition

Proceed to A2 without schema changes in `farm-atlas`. A2 defines the server-side ten-box Work Grammar contracts and governed universal vocabulary. If real production examples cannot fit those contracts without prose carrying operational semantics, stop under the migration plan's grammar-failure rule rather than adding ad hoc boxes during implementation.
