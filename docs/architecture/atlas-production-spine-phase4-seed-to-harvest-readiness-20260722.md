# Atlas Production Spine Phase 4

Date: 2026-07-22  
Branch: `agent/atlas-production-spine-phase4`  
Stacked on: Phase 3 Owner production-readiness planning

## Purpose

Phase 4 makes one physical crop cohort traceable from reserved seed through the point where a field crop is permitted to enter harvest watch.

The durable path is:

`seed allocation → actual sowing → tray batch → germination observation → seedling care → transplant readiness → prepared-bed gate → per-bed transplant → field stand → establishment → required care → harvest readiness`

Tasks remain projections of the current valid action. They are not the crop identity.

## Canonical physical records

### Grow-room cohort

- `production_tray_batches`
- `seed_allocation_consumptions`
- `production_stage_observations`
- `production_readiness_observations`

These records preserve actual seed use, tray occupancy, viable seedlings, and biological observations.

### Field cohort

- `production_transplant_placements`
- `production_field_stands`
- `production_field_observations`
- `production_field_care_state`

`production_field_stands.current_plants` is the authoritative living-plant count for each production lot and bed. Current care state mirrors that stand; it cannot independently create or restore plants.

### Care and harvest policy

- `production_care_policies`
- `production_harvest_rules`
- `production_harvest_gates`

Care policy distinguishes:

- required
- monitored
- not required
- due or needs attention
- satisfied

Atlas therefore does not assume every crop needs the same pinching, support, fertility, watering, or weeding sequence.

## Atomic production commands

### Sowing

`record_production_sowing_v1`

Requires actual seed and tray quantities plus dated capacity reservations. It consumes the exact seed allocation, creates the tray batch and crop cycle, completes the sowing task canonically, and opens a counted germination observation.

### Germination

`record_production_germination_v1`

Supports `not_yet`, `germinated`, and `failed`. It cannot report more seedlings than seeds sown.

### Seedling care

`record_production_seedling_care_v1`

Records the surviving cohort and current tray count, then opens the transplant-readiness observation.

### Transplant readiness

`record_production_readiness_v1`

Supports `not_ready`, `ready`, and `failed`. A ready count recalculates actual bed demand from surviving seedlings and measured field density.

### Transplant

`record_production_transplant_v1`

Requires a ready gate, active bed assignments, and an exact plant count for each destination bed. It creates planting claims, object contents, field crop cycles, object events, transplant placements, and the next establishment check.

### Establishment

`record_production_establishment_v1`

Supports `not_yet`, `established`, and `failed`. Every active field stand must be counted. Counts may fall but cannot rise above the prior physical cohort.

### Field care

`record_production_field_care_v1`

Supports water, weed, and pinch work. Every bed linked to the cohort task must be confirmed. The command updates field stands, care state, crop cycles, object state, field logs, production events, and task transitions atomically.

### Owner harvest rules

`set_production_harvest_rules_v1`

Records whether pinching is required and establishes the harvest-watch window. If pinching is required, Atlas creates a cohort-specific pinch task. If it is not required, the policy is explicitly marked not required.

## Harvest-readiness gate

The gate cannot open while any of these are unresolved:

1. A transplanted bed has not been counted as established.
2. No living plants remain.
3. The Owner has not confirmed pinching and the harvest-watch window.
4. A required care policy remains due or needs attention.

Only after all conditions pass does Atlas create the harvest-readiness task for the exact production lot and its active field stands.

## Concurrent draft consolidation

Two field-care implementations were created during the same work window. Both were empty and unused.

Migration `20260722044631_atlas_consolidate_production_field_care_sources.sql` resolves that safely:

- `production_field_stands` becomes the physical count source.
- `production_field_care_state` becomes a current condition projection tied to a stand.
- `production_care_policies` becomes the harvest prerequisite layer.
- The alternate harvest-readiness gate table is removed.
- Competing establishment command overloads are removed before the canonical command is defined.

Historical migration versions remain represented in the repository. Superseded command-only migrations are explicit stubs; later canonical migrations define the final replayable behavior.

## Generic maintenance compatibility

Production cohort weed cards are excluded from the generic single-active-weeding deduper. A production weed task has additional biological and economic effects, so it cannot be silently replaced by a generic zone-maintenance card.

Ordinary zone weeding continues to deduplicate normally.

## Rollback proof

A disposable two-bed Potomac Ivory scenario proved:

- 360 plants transplanted.
- 345 plants established.
- FR1 required water and weeding.
- Owner confirmed pinching and a harvest window.
- Water and later care captured additional losses.
- Final field-stand total: 342 plants.
- Final care-state total: 342 plants.
- Production-lot total: 342 plants.
- Watering policy: satisfied.
- Weeding policy: satisfied.
- Pinching policy: satisfied.
- Owner rule task: completed through one canonical transition.
- Harvest-readiness task: opened on the confirmed watch date.

The entire scenario rolled back. No Potomac production lot, task, allocation, or physical cohort was changed by the proof.

## Security

All new production tables and lineage views are internal. Anonymous and ordinary authenticated roles cannot select them or invoke production commands. Service-role operations are the only direct command surface during this observation phase.

No Anna-facing route or current task interaction was changed in this phase.

## Deployment

A Phase 4 preview deployment was created before the field-care slice began, satisfying the requested deployment gate. Final exact-head validation must still pass after the complete repository mirror, tests, and documentation are committed.
