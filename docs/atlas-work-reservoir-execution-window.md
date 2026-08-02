# Atlas Work Reservoir + Execution Window

Status: implemented in the `atlas` Supabase schema and surfaced through object-first Work Card authoring.

## Governing rule

Capacity may control what Atlas presents next. It may never control whether Atlas remembers an obligation or whether a hard-date obligation notifies the assigned person.

## Canonical layers

1. **Work Reservoir** — planned occurrences, object work, projects, crop cycles, and persistent rhythms. No ordinary farm-work ceiling.
2. **Committed Window** — hard-date work entering the execution system before its due day so notifications and tomorrow preflight can be prepared.
3. **Ready Work** — work whose time, dependency, place, crop, material, and state gates are satisfied.
4. **Presented Work** — the intentionally small person/day set shown in Work, Living Day, and lockscreen moments.

## Release lanes

- `required` — hard-date, safety, delivery, event, and explicitly required work. Always releases when its gate is ready.
- `process_continuation` — dependency and biological-process follow-through. Always releases when the prerequisite or state gate is ready.
- `rhythm` — persistent maintenance and care systems. One current serving is exposed rather than replaying missed copies.
- `discretionary` — improvements and floating work. This is the only lane held by a person/day workload budget.

## Workload units

- Light: `0.5`
- Standard: `1`
- Heavy: `2`

Default daily presentation budgets:

- Owner: 12 units, permissive
- Manager: 8 units
- Farm hand: 6 units

These are presentation budgets, not hour estimates and not database capacity limits.

## Hidden safety brake

`farm_task_release_settings.maximum_active_safety_tasks` defaults to `5000`. It exists only to stop malformed recurrence or release bugs. It is not displayed as a farm workload policy.

## Main database contracts

- `tasks.work_lane`, `tasks.commitment_kind`, `tasks.effort_units`
- `planned_work_occurrences.work_lane`, `commitment_kind`, `effort_units`
- `object_work_items.date_commitment`, `work_lane`, `effort_units`, `bring_into_work_now`
- `member_workload_settings`
- `work_reservoir_retractions`
- `member_day_load_v1`
- `object_work_context_v2`
- `create_object_work_v2`
- `release_eligible_work_v1`
- `work_occurrence_gate_satisfied_v1`

## Authoring contract

The ordinary Work Card composer asks:

- **Must happen that day** — committed and prepared before the due day; overload never suppresses its appearance or notification.
- **Can float around that day** — remembered in the reservoir and admitted when discretionary presentation capacity exists.

`Bring into Work now` remains an explicit Owner/manager exception.

## Existing Elm migration

The migration was deliberately conservative:

- Nine untouched future legacy cards were archived as execution instances and returned to their existing planned occurrences.
- Every retraction has an audit snapshot in `work_reservoir_retractions`.
- Touched, blocked, rescheduled, dependency-linked, and Owner-intervened work remained active.
- Six stale open chicken-care copies were archived.
- Chicken care now permits one active rhythm serving at a time.
- Missed historical rhythm occurrences are cancelled rather than replayed into today.

## Acceptance rules

- Creating planned work succeeds even when the farm contains hundreds of future obligations.
- Required, dependency, and rhythm work are not suppressed by discretionary workload budgets.
- Floating discretionary work waits without being forgotten.
- A hard-date task receives a notification plan when materialized.
- Farm-day load is calculated by assignee and date, including active and reservoir obligations.
- The old `150 top-level cards` number is retained only as deprecated historical metadata and is not consulted by the release engine.
