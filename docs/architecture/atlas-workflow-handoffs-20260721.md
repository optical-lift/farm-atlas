# Atlas Unified Farm-Work Handoffs

## Why this layer exists

Atlas previously used `parent_task_id` for two different relationships:

1. a true checklist step that may be attested complete when its parent work block is completed; and
2. a future farm action that becomes possible only after earlier work or a biological condition is recorded.

Those meanings cannot share the same completion behavior. The lemon-basil propagation task exposed the failure: recording that cuttings were placed in water also closed the future transplant task, even though roots had not formed and no planting occurred.

The workflow layer separates **completion coupling** from **operational sequencing**.

## Live migrations

- `20260721214054_atlas_unified_workflow_handoffs`
- `20260721214203_atlas_migrate_task_handoffs_and_repair_lemon_basil`
- `20260721214529_atlas_add_workflow_coverage_audit`

## Event layer

`atlas.workflow_events` receives append-only operational events from six Atlas systems:

- task outcomes
- object activity
- maintenance history
- crop-cycle state and lifecycle changes
- production-succession changes
- field logs and their action types

Each emitter creates an idempotent event key and sends the event through `atlas.apply_workflow_event_v1`.

## Handoff layer

`atlas.workflow_handoffs` describes what downstream work becomes available after an event.

Supported effects are intentionally limited to:

- `open_task`
- `schedule_task`
- `record_only`

A handoff cannot mark its target task complete. It opens or schedules the next work through the canonical task-transition engine, preserving transition history, outcome records, task visibility, and idempotency.

Biological conditions are never inferred merely from elapsed work. For example:

- placing cuttings in water schedules a root-readiness check;
- completing the root-readiness check schedules transplanting;
- starting seeds schedules a transplant-readiness check;
- confirming rooted, sturdy, hardened seedlings schedules plant-out.

## Relationship guard

`atlas.guard_downstream_task_not_checklist_child_v1` rejects a downstream, readiness-gated, cascade, or delayed-followup task that attempts to use `parent_task_id`.

`parent_task_id` therefore remains reserved for actual checklist membership. Sequential work uses a workflow handoff.

The delayed-followup generator was also corrected so newly generated future work is not attached as a checklist child.

## Repaired and connected farm chains

### Lemon basil

- `Take lemon basil cuttings to root in water`
- `Confirm lemon basil cuttings are rooted enough to plant` — due July 28, 2026
- `Plant rooted lemon basil cuttings in Field Rows 2 and 3 beside celosia` — remains blocked until readiness is confirmed, then schedules for August 3

The invalid completion remains in the audit history, followed by explicit corrective reopen and blocked transitions. No history was deleted.

### Grow-room basil

- `Check whether grow-room basil is ready to transplant`
- `Transplant Grow-Room Basil into Field Row 8 Edges`

Completing the readiness check now marks the source ready and opens the transplant task.

### Bed clearing to sowing

- Clear Field Row 9 → sow pollenless sunflowers in Field Row 9
- Clear Field Row 10 → sow pollenless sunflowers in Field Row 10

### 2027 seed and transplant chains

- purchase Chantilly White seed → start seed → readiness check → plant out
- purchase Crane White ornamental kale seed → start seed → readiness check → plant out

## Specialized engines retained

The generic handoff layer does not replace working domain engines. The coverage audit recognizes these as specialized sequencing systems:

- germination workflow
- germination-to-harvest or transplant-readiness windows
- triggered grow-room sequences
- crop-cycle milestones
- production calendar and succession tasks
- retroactive crop-profile workflows
- recurring tasks
- delayed followups
- maintenance dependencies and completion bridge

These systems can now also emit events consumed by future generic handoffs.

## Coverage audit

`atlas.workflow_task_coverage_v1` classifies active sequential work as:

- `generic_handoff_target`
- `generic_handoff_source`
- `specialized_engine`
- `delayed_followup_engine`
- `uncovered`

It also flags any downstream work that still incorrectly uses `parent_task_id`.

Release check:

```sql
select count(*)
from atlas.workflow_task_coverage_v1
where coverage = 'uncovered'
   or invalid_parent_link;
```

Expected result: `0`.

The initial live audit returned:

- 11 generic handoff targets
- 1 generic handoff source-only readiness task
- 89 tasks managed by specialized engines
- 0 uncovered active sequential tasks
- 0 invalid downstream parent links

## Verification

A disposable source task, blocked target, handoff, and event were created in the live database.

The event:

- opened the blocked target;
- scheduled the intended date;
- created exactly one canonical task transition;
- created exactly one outcome event; and
- marked the handoff satisfied with state `applied`.

All disposable tasks, events, handoffs, transitions, and outcomes were deleted in the same verification operation. A cleanup query confirmed zero test rows remained.

## Boundary

This architecture guarantees that **modeled** sequential work can communicate across Atlas and makes unmodeled active chains visible through the coverage audit. It cannot infer an unknown farm relationship or an unrecorded biological fact. New chains must be represented by a handoff or one of the recognized specialized engines, and readiness-dependent work must wait for an explicit observation or completed readiness task.
