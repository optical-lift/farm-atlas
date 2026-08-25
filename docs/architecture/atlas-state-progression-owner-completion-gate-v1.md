# Atlas State Progression — Owner Completion-Gated Release v1

Status: bounded Step 4 implementation under `atlas-state-progression-contract-v1.md`.

## Scope

This step cuts over exactly two existing completion-gated queues:

- `owner_social_content_queue`
- `owner_venue_marketing_queue`

It does not generalize queue effects, alter task execution readiness, or change the meaning of either queue.

## Authority flow

The owner completion-gated path now follows the shared State Progression grammar:

**Evidence → Requirement → Evaluation → Boundary → Effect**

1. `atlas.tasks.status` remains authoritative Evidence for predecessor completion.
2. `atlas.advance_owner_completion_gated_queue_v1()` normalizes `predecessor_task_completed` and evaluates before/after snapshots through `atlas.requirement_set_evaluate_v1(jsonb)`.
3. `atlas.record_requirement_boundary_v1(...)` records the stable `open → satisfied` Boundary under requirement set `owner_completion_gated_predecessor_completion_v1`.
4. `atlas.apply_owner_completion_gated_release_effect_v1(uuid,date)` consumes that exact Boundary and performs the previously coupled queue consequence.
5. `atlas.release_next_task_in_queue_v1(uuid,text,date)` remains lower-level queue/materialization machinery but fails closed for the two owner queues unless the queued successor carries the exact authorizing Boundary chain.

The authorizing Boundary ID is propagated to the completed predecessor queue item, queued/released successor, planned occurrence, task payload, and materialized task. Post-cutover owner release metadata records `boundary_authorized_completion_gated_release_v1`.

## Preserved semantics

This step does not redefine release timing, owner scheduling approval, capacity/materialization behavior, queue order, task truth, or planned-occurrence truth. Those remain owned by their existing domain machinery. State Progression only owns the authorization fact that the predecessor-completion requirement crossed its Boundary.

## Bypass seal

The lower queue helper independently requires, for these two owner queues:

- `release_boundary_event_id`;
- `release_requirement_set_key = owner_completion_gated_predecessor_completion_v1`;
- `release_authorized_from_queue_item_id`;
- the authorizer to be the immediately preceding completed queue item;
- the predecessor's `completion_boundary_event_id` to equal the same Boundary ID; and
- a matching Boundary ledger row that is `closed`, `open → satisfied`, and sourced from the predecessor task.

A direct lower-helper invocation without this provenance fails closed. Correct trigger orchestration is therefore not the only protection against regression.

## What Step 4 does not do

This step adds no table, no new trigger, no public/service RPC, no generic effect router, and no `AFTER INSERT` consumer on the Boundary ledger. It does not cut over Worker Day, Farm Round, Principal, Clock, UI, notifications, Anna work rotations, or any other queue family.

## Verification

Production rollback-only proofs use real owner social and venue queue topology. In each proof a predecessor task transition to `done` creates one explicit `open → satisfied` Boundary, the exact Boundary ID propagates through the release chain, and the successor is released through the bounded Effect. The transactions are rolled back, leaving live operational state and the Boundary ledger unchanged.

The lower release helper separately rejects owner completion-gated release without an authorizing Boundary. The shared task-execution compatibility membrane remains at 1,159 tasks, 1,159 matches, and 0 mismatches.

The governed executable surface becomes 4,369 artifacts: one additional internal Effect consumer. The simplification is an authority-topology change rather than a raw artifact-count reduction: owner predecessor completion no longer doubles as release authority, and no second owner-specific release engine is introduced.
