# Atlas handoff classification and completion-impact audit

Date: 2026-07-21

## Handoff firing modes

Every generic workflow handoff now declares how it is allowed to fire:

- `automatic`: the source task itself is the complete prerequisite.
- `date_window`: source completion starts a time window before the next task.
- `readiness_confirmed`: the next task waits for an explicit biological or operational readiness check.
- `resource_confirmed`: the next task waits for explicit confirmation that a required resource is physically available.
- `owner_decision`: the next task waits for an Owner decision task.
- `result_dependent`: the next task depends on a recorded result matched through `source_filter`.
- `recurring_condition`: the next task depends on a repeated condition rather than one task completion.

A database trigger rejects invalid combinations. Examples: a date-window handoff must schedule a task using a date or delay, and a readiness-confirmed handoff must originate from a readiness task.

Current live classification:

- 2 automatic
- 5 date-window
- 4 readiness-confirmed
- 2 resource-confirmed
- 0 invalid classifications

The two seed-purchase chains were corrected. Completing a purchase no longer asserts that seed is in hand. Purchase completion schedules an Owner arrival-confirmation task seven days later. Only that explicit confirmation can schedule seed starting.

## Completion-impact policies

The audit separates completion records from real farm-state effects.

Record effects:

- canonical transition
- outcome event
- field log

Farm-state effects:

- object activity
- object state
- maintenance history
- crop cycle
- planting claim
- production succession
- workflow handoff
- generated next task

Each action family declares whether a farm-state effect is required, contextual, or record-only. Examples:

- weeding and mowing require maintenance or object state
- sowing requires a crop cycle, production succession, or planting claim
- planting/transplanting requires a planting claim, crop cycle, or object state
- germination requires crop-cycle movement or next work
- propagation requires a handoff, crop cycle, or next task
- Owner, venue, build, and infrastructure tasks may be record-only

## Live audit result

- 59 pass
- 29 current state gaps
- 12 contextual reviews
- 8 legacy state gaps
- 59 legacy unstructured completions
- 0 unclassified action families

The current gaps are concentrated in:

- 13 transplant completions that recorded task completion but no structured planting/crop state
- 6 mowing completions with recurrence but no maintenance/object state
- 8 sowing or seed-sowing completions without a crop-cycle/production record
- 2 watering completions without object water state

Contextual review is concentrated in pot-up, readiness-check, grow-room, and legacy generic `anna` actions.

These findings are intentionally not auto-backfilled with invented quantities, destinations, or crop states. The views make the gaps queryable so future engine work can repair source relationships and future completions can be verified against the policy.

## Database surfaces

- `atlas.workflow_handoff_classification_v1`
- `atlas.task_completion_impact_policies`
- `atlas.task_completion_impact_audit_v1`
- `atlas.task_completion_impact_summary_v1`

All are internal operational surfaces; no ordinary authenticated or anonymous grants were added.
