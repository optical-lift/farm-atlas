# Production → Obligation/Release → Clock Primitive Audit

Status: Pass 2 existing-primitive audit for the Atlas Production Scheduler ↔ Farm Clock integration.

Audit date: 2026-08-15.

This document implements Pass 2 of the Production → Obligation/Release → Clock constitution. It classifies existing Atlas machinery before any scheduler schema expansion.

Classification vocabulary:

- **KEEP** — semantics already match the governing authority.
- **EXTEND** — the abstraction is valid but lacks capability or adoption required by the integration contract.
- **DEPRECATE** — the primitive or behavior encodes an authority split that the integration is replacing.
- **REMOVE LATER** — retain only for compatibility until verified call sites and historical data no longer require it.

The governing rule remains:

`Production truth → Work obligation → Release/legal window → Clock placement → Execution/result`

A downstream layer may place or present upstream truth. It may not rewrite upstream truth merely to make human scheduling fit.

## Executive result

Atlas does **not** need a second scheduler ontology.

The live system already contains the major required primitives:

- persistent production plans, successions, lots, crop cycles, spatial crop placement, production capacity requirements/reservations, and bed assignments;
- durable planned work occurrences, release policies, task release events, queues, prerequisites, readiness/resource gates, and executable tasks;
- task duration/load profiles, member capacity settings, unavailability, fixed day reservations, Worker Day projections, Clock placements, placement events, proposal/commit RPCs, cues, and day dispositions;
- sky-state/rule infrastructure;
- serial weed/rhythm infrastructure;
- propagation/tray state and follow-up occurrence infrastructure;
- Harvest execution/output ledgers that preserve physical output and downstream commercial truth.

The main integration work is therefore **joining and narrowing authority**, not inventing replacements.

The four highest-leverage gaps found in Pass 2 are:

1. the new Production Plan / Lot spine exists but is only partially adopted by live production work;
2. durable work occurrences do not yet carry the complete canonical temporal obligation contract;
3. human capacity is split between minute-based Clock capacity and older effort-unit budgeting, and the current capacity helper is not yet a complete day-aware capacity service;
4. Clock placement stores `task_id` but not the occurrence/release identity that was authoritative when the placement was made, so historical provenance can become ambiguous when one durable task identity is legitimately reused.

## 1. Production authority

| Existing primitive | Classification | Governing role / audit finding |
|---|---|---|
| `atlas.production_plans` | **KEEP** | Canonical seasonal/crop production intent. Owns plan windows, succession policy, missed-strategy behavior, final biological sow date, and intended uses. |
| `atlas.production_successions` | **KEEP** | Canonical succession-level production timing. Already carries planned, late, skip, projected germination/harvest/clear, crop-cycle and sow-task linkage. |
| `atlas.production_lots` | **EXTEND** | Correct persistent production identity below plans, but current adoption is incomplete. Live audit found four production plans and four production lots, while the current lots are Spring 2027 snapdragon pilot lots with no `production_plan_id`; existing 2026 production plans have no canonical lots yet. |
| `atlas.production_lot_crop_cycles` | **EXTEND** | Correct bridge from persistent production identity to observed field/crop lifecycle truth, but currently has zero live rows. Must become the normal bridge rather than inventing another lot↔cycle relation. |
| `atlas.crop_cycles` | **KEEP** | Canonical observed crop lifecycle/field truth. Carries actual sow/plant/harvest/clear dates and projected lifecycle windows. It is not a substitute for Production Plan/Lot identity. |
| `atlas.production_lot_tasks` | **KEEP** | Useful reverse provenance/index from production lot to executable task, but it must remain derived/supporting truth. It must not become the authority that creates work or bypass `planned_work_occurrences`. |
| `atlas.crop_placements` + `atlas.crop_placement_cells` | **KEEP** | Canonical actual spatial occupancy/geometry. These describe where a crop is or was physically placed, not protected future reservations. |
| `atlas.production_bed_assignments` | **EXTEND** | Best existing primitive for nonfungible future spatial assignment. It already records production lot, object, quantity, planned transplant date and expected release date. Extend it for explicit occupancy window, compatibility/exclusivity, confidence and supersession where those cannot already be derived. Do not create a parallel bed-reservation table first. |
| `atlas.capacity_pools` | **KEEP** | Canonical physical/fungible capacity pool vocabulary. This is farm-resource capacity, not worker-time capacity. |
| `atlas.production_capacity_requirements` | **KEEP** | Canonical production requirement against a capacity kind and time window. |
| `atlas.production_capacity_reservations` | **KEEP** | Canonical reserved physical/fungible production capacity. Already links lot → requirement → capacity pool. |
| `atlas.production_tray_batches` + `atlas.production_tray_batch_locations` | **KEEP** | Canonical physical propagation/tray state for production lots, including quantity, germination state, action-required state and current location. |
| `atlas.production_transplant_placements` | **KEEP** | Canonical actual transplant result connecting lot/tray/gate/bed assignment to crop-cycle/planting truth. |

### Production adoption finding

The schema is ahead of the live data migration.

At audit time:

- `production_plans`: 4 rows;
- `production_lots`: 4 rows;
- `production_lot_crop_cycles`: 0 rows;
- `production_lot_tasks`: 0 rows.

Meanwhile, the existing Work Reservoir already contains many production/crop-derived planned occurrences. The correct migration direction is to **attach the existing production/crop truth to the persistent Production Lot spine**, not to replace the occurrence/release machinery.

## 2. Obligation and release authority

| Existing primitive | Classification | Governing role / audit finding |
|---|---|---|
| `atlas.work_definitions` | **KEEP** | Canonical reusable work definition. |
| `atlas.planned_work_occurrences` | **EXTEND** | This is the correct durable obligation identity. It already owns source identity, planned due date, not-before date, state, release policy, released task, lane, commitment kind and effort. Extend it to the full temporal obligation contract rather than adding a second obligation table. |
| `atlas.work_release_policies` | **KEEP** | Correct reusable release/gate policy abstraction. Extend policy vocabulary only where the canonical obligation contract needs additional gate semantics. |
| `atlas.task_release_events` | **KEEP** | Immutable occurrence → released-task evidence. This is a primary provenance ledger and should remain so. |
| `atlas.task_release_queue_items` | **EXTEND** | Correct serial/queue release primitive. It now has `planned_occurrence_id`; occurrence-backed queue items should consistently preserve that link. |
| `atlas.task_prerequisites` | **KEEP** | Correct executable-task dependency primitive. Do not duplicate it for ordinary released-task sequencing. |
| `atlas.task_dependency_clocks` | **KEEP** | Correct timed dependency clock primitive. |
| `atlas.task_external_readiness_gates` | **KEEP** | Correct external readiness gate primitive. |
| `atlas.task_crop_availability_gates` | **KEEP** | Correct crop-availability gate primitive. |
| `atlas.task_resource_requirements` | **KEEP** | Correct executable resource-readiness primitive. |
| `atlas.work_gate_evaluations` | **KEEP** | Correct release/gate evaluation evidence. |
| `atlas.tasks` | **KEEP** | Executable work object only. A task is downstream of durable obligation truth, not the source of the production requirement. |

### Temporal-contract gap

`planned_work_occurrences` currently has `planned_due_date` and `not_before_date`, plus lane/commitment semantics. That is not yet the complete required contract.

Pass 3+ should extend the existing occurrence/release model so canonical obligation timing can express, without relying on task prose or metadata guessing:

- earliest lawful date;
- preferred start;
- preferred end;
- latest lawful date;
- hard finish deadline;
- temporal flexibility;
- biological/event prerequisite;
- resource readiness;
- weather policy;
- consequence if missed.

Do not solve this by widening `tasks.due_date` into another production scheduler.

## 3. Provenance seam

### Existing provenance is stronger than it first appears

Atlas already preserves several useful links:

- `planned_work_occurrences.released_task_id → tasks.id`;
- `tasks.planned_occurrence_id → planned_work_occurrences.id`;
- `task_release_events.occurrence_id + task_id`;
- `task_release_queue_items.planned_occurrence_id`;
- occurrence `source_kind/source_id`;
- occurrence `relation_payload`, which can preserve crop-cycle, object, production-lot-task and resource relationships;
- production succession occurrence sources can trace `source_id → production_successions → production_plan`;
- task/crop-cycle and harvest task-link tables preserve execution/result relationships.

### One task may legitimately serve more than one occurrence over time

Live audit found at least one task identity intentionally reused across two rhythm occurrences: the Field Rows Back Half mowing recovery task.

The first occurrence represented an earlier rhythm serving. A later physical-truth correction created a second occurrence while preserving the same task identity, and the task's `planned_occurrence_id` was updated to the current occurrence.

That proves this invariant:

> `task_id` is not sufficient as an immutable historical occurrence snapshot.

### Clock provenance classification

`atlas.worker_day_task_placements` is **EXTEND** for provenance.

It currently stores the placed `task_id`, but not the occurrence/release identity that caused that task to be authoritative at the moment of placement.

Because task identity can be reused and `tasks.planned_occurrence_id` can move to a later occurrence, a historical placement that only remembers `task_id` can eventually resolve to the wrong upstream occurrence.

Pass 2 conclusion:

- do **not** create a new placement table;
- extend placement/event provenance so a production-origin placement can preserve the authoritative `planned_occurrence_id` and, where useful, release-event identity at placement time;
- backfill only when the historical occurrence is uniquely provable;
- refuse ambiguous historical backfill rather than guessing.

At audit time Clock placement adoption is still small (`worker_day_task_placements`: 1 live row; placement events: 0), so this seam can be corrected before a large ambiguous history accumulates.

## 4. Farm Clock and human capacity

| Existing primitive | Classification | Governing role / audit finding |
|---|---|---|
| `atlas.task_capacity_profiles` + `atlas.task_capacity_plan_v1` | **KEEP** | Correct per-task execution estimate snapshot: expected active minutes, physical load, obligation class, confidence/source and recovery classification. |
| `atlas.member_capacity_settings` | **KEEP** | Correct minute-based human-capacity policy: regular target, recovery target, maximum planned minutes and heavy-work soft cap. |
| `atlas.member_unavailability` | **EXTEND** | Correct availability primitive, but currently date-granular. The authoritative capacity service will need partial-day/shift availability without creating a competing calendar model. |
| `atlas.day_reservations` | **KEEP** | Correct fixed human-time reservation primitive for meals, appointments, routines and other protected Clock intervals. |
| `atlas.clock_day_capacity_state_v1` | **EXTEND** | Correct seed for server-owned Clock conflict state, but it currently receives only planned paid minutes and compares them to target/maximum. It is not yet the authoritative day-capacity service because it does not itself account for service date, partial availability, reservations, heavy-work limits or committed placement intervals. |
| `atlas.owner_capacity_plan_v1` | **KEEP** | Useful obligation/capacity accounting view over presented work. It is not a substitute for a day-aware availability service. |
| `atlas.member_workload_settings` + `member_day_load_core_v1` effort-unit budget | **DEPRECATE** as human-capacity authority | The older daily-unit budget is a parallel human-capacity language beside minute-based Clock capacity. Preserve only as compatibility/ranking input while release/presentation callers migrate. It must not remain the authority that decides human schedule fit. |
| `tasks.effort_units` / occurrence `effort_units` | **KEEP** as relative/ranking compatibility signal | Do not treat effort units as the canonical labor estimator once minute/load estimates exist. |
| `atlas.worker_day_task_placements` | **EXTEND** | Correct Clock placement table. Already carries service date, day window, sort order, `planned_start_at` and `planned_duration_minutes`. Extend provenance/legal-window validation, not ontology. |
| `atlas.worker_day_task_placement_events` | **EXTEND** | Correct append-only placement-change evidence, but adoption is currently empty and should begin preserving occurrence/release provenance as placements become authoritative. |
| `atlas.task_day_dispositions` | **KEEP** | Correct explicit worker-day deferral/return/carryover evidence. A disposition may alter Clock handling, not upstream obligation truth. |
| `atlas.day_plan_snapshots` | **KEEP** as derived snapshot | Useful prepared/candidate/planned snapshot and carryover evidence. It is rebuildable downstream state and must never become the source of whether an obligation exists. |
| `atlas.worker_day_states` | **KEEP** | Worker-day support/routing state; not schedule truth. |
| `atlas.worker_day_cues` | **KEEP** | Human cue/checkpoint layer anchored to day/task; not production obligation or placement authority. |

## 5. Worker Day projection and proposal/commit machinery

### KEEP

The following abstractions are valid and should remain the single path clients consume:

- `presented_work_selection_rows_v1` / `presented_work_rows_v1` — bounded Work Reservoir presentation;
- `owner_capacity_plan_v1` — obligation/capacity accounting;
- `owner_worker_day_plan_choreographed_v1` and self/owner wrappers — shared role-consistent Worker Day projection;
- `worker_day_choreography_api_v1` — placed task/cue choreography;
- `owner_build_worker_day_schedule_v2` — Owner proposal-to-schedule path;
- `owner_commit_worker_clock_plan_api_v2` — committed Clock change path;
- `owner_set_worker_day_task_time_api_v1` / duration API — explicit Clock placement controls.

### EXTEND

The proposal/commit path must validate against the same authoritative legal-window and day-capacity service before it is considered a lawful Clock commit.

Current `owner_build_worker_day_schedule_v2` can intentionally approve work beyond the normal paid target. That may be valid Owner authority, but target overage and **maximum/conflict** are different concepts. The commit path must not treat an Owner click as permission to violate an upstream hard/legal window or silently exceed a hard human maximum.

### DEPRECATE / REMOVE LATER

Older v1/v2 duplicate wrapper generations should be retired only after call-site verification proves current clients use the newer contract. Do not remove RPCs solely because their names are older.

## 6. Current projection split found during audit

Pass 2 found a concrete live example showing why selection and Clock placement must converge on one authority chain.

For Anna on 2026-08-15:

- the canonical presented-work selector includes `Water Outdoor Planters` as valid recovery work;
- the base Worker Day assembler omits it because its carry-forward path only follows a narrower previous-day handoff;
- the base Worker Day assembler includes an overdue mowing recovery in `realWork` even though the canonical selector marks that item as over-capacity;
- the base plan reports 495 committed paid minutes against a 420-minute target;
- the newer Clock capacity helper distinguishes target warning from maximum conflict, but that conflict truth is not the primitive used to choose the base plan's real-work set.

This is not evidence that another scheduler is needed. It is evidence that current projection functions still contain overlapping selection policies.

Classification:

- canonical Work Reservoir selection: **KEEP**;
- special/narrow selection and carryover logic inside the base Worker Day assembler: **DEPRECATE** as an independent scheduling authority;
- Clock conflict enrichment: **EXTEND** until it is day-aware and is consumed by proposal/commit consistently.

## 7. Weed and rhythm

| Existing primitive/behavior | Classification | Finding |
|---|---|---|
| `atlas.weed_cards`, `weed_passes`, `weed_sessions` | **KEEP** | Domain truth for weed work and actual passes/sessions. |
| `task_release_queue_items` queue `anna_weeding_rotation` | **KEEP** | Correct serial-release queue. Queue position/state is obligation/release truth, not Clock placement. |
| weed `planned_work_occurrences` | **KEEP** | Correct durable obligation identity. |
| direct automatic Weed Card injection in `owner_worker_day_plan_v1` | **DEPRECATE** | This computes a virtual Clock slot beside the normal occurrence → task → placement path. Keep compatibility until the general placement pipeline can consume the released queue work, then remove the special scheduler branch. |
| rhythm states/rules and their planned occurrences | **KEEP** | Correct durable rhythm/biological cadence truth. |
| direct automatic mowing-slot simulation in `owner_worker_day_plan_v1` | **DEPRECATE** | Same reason as weed injection: it is a special Clock scheduler inside the Worker Day assembler. Clock should place released rhythm work rather than synthesize a parallel virtual task stream. |

The queue/rhythm domain models are not the problem. The problem is bypassing the common release→placement contract when rendering the day.

## 8. Propagation continuation

| Existing primitive | Classification | Finding |
|---|---|---|
| `production_tray_batches` | **KEEP** | Physical tray/seedling state, quantity, stage, action-required flag and destination truth. |
| `production_tray_batch_locations` | **KEEP** | Actual grow-room/tray occupancy history. |
| `production_transplant_gates` | **KEEP** | Readiness gate before transplant execution. |
| `production_transplant_placements` | **KEEP** | Actual transplant result. |
| `propagation_events` | **KEEP** | Actual propagation lineage/event evidence; not Clock authority. |
| occurrence sources such as `propagation_followup` and `propagation_split` | **KEEP** | Correct durable follow-up obligations. Continue converging these onto Production Lot identity instead of creating new continuation-task tables. |

## 9. Weather and sky gates

| Existing primitive | Classification | Finding |
|---|---|---|
| `sky_state_samples`, `sky_windows`, `sky_operation_rules`, `operation_sky_policy_library` | **KEEP** | Mature sky condition/rule infrastructure. |
| `task_sky_fitness_v2`, `task_sky_deferral_policy_v2`, `task_sky_presentation_gate_v1` | **KEEP** | Correct task-level condition/presentation service. Current policy already distinguishes moveable/floating work from non-floating commitments rather than letting sky erase hard work. |
| dedicated canonical weather-forecast/condition service | **EXTEND / gap** | No equivalent persistent weather service was identified in the audited Atlas scheduling primitives. Weather-sensitive Clock choreography should be added by extending the condition/placement contract, not by overloading sky truth or task prose. |

Sky and weather remain different inputs even if both affect placement.

## 10. Harvest execution/output linkage

The current Harvest truth chain is a valid downstream execution/result domain and should be reused.

**KEEP**:

- `production_harvest_lots`;
- `production_harvest_lot_tasks`;
- `production_harvest_stand_entries`;
- `production_harvest_container_assignments`;
- `flower_harvest_batches`;
- `flower_harvest_bucket_observations`;
- `flower_preparation_batches` / inputs;
- `flower_ready_inventory_lots` and commercial fulfillment ledgers.

These tables answer what physically happened and what harvest became. They do not replace the upstream harvest obligation.

**EXTEND** the integration seam so a harvest task placed in Clock can trace backward to its occurrence/Production Lot and its completion can trace forward to physical harvest/output evidence.

Do not create another Harvest scheduler.

## 11. Existing primitive → governing architecture map

### Production

- `production_plans`
- `production_successions`
- `production_lots`
- `production_lot_crop_cycles`
- `crop_cycles`
- `crop_placements` / cells
- `production_bed_assignments`
- `capacity_pools`
- `production_capacity_requirements`
- `production_capacity_reservations`
- tray/transplant/field/harvest production state

### Obligation / Release

- `work_definitions`
- `planned_work_occurrences`
- `work_release_policies`
- `work_gate_evaluations`
- `task_release_events`
- `task_release_queue_items`
- prerequisites/dependency clocks/readiness gates/resource requirements
- executable `tasks`

### Farm Clock / human-time placement

- `task_capacity_profiles` / `task_capacity_plan_v1`
- `member_capacity_settings`
- `member_unavailability`
- `day_reservations`
- `worker_day_task_placements`
- `worker_day_task_placement_events`
- `task_day_dispositions`
- Worker Day projections and proposal/commit RPCs
- `worker_day_cues` and day-state support

### Execution / resulting field truth

- task outcomes/transitions
- crop observations and crop-cycle lifecycle state
- propagation/tray/transplant actuals
- harvest lot / bucket / preparation / Ready / fulfillment actuals
- production events and reforecast inputs

## 12. What Pass 2 explicitly says not to build

Do **not** add, yet:

- another scheduler queue;
- another worker placement table;
- another human-capacity model;
- another production capacity model;
- another release table;
- another weed scheduler;
- another mowing scheduler;
- another harvest scheduler;
- a generic `production_task` table that bypasses occurrences;
- a direct Clock mutation path that edits Production dates to make overload disappear.

## 13. Recommended next pass

Pass 3 should be a **contract-gap pass**, not a broad schema build.

In order:

1. freeze the canonical provenance chain at placement time (`Production/Lifecycle source → occurrence → release → task → placement`), extending existing placement/event records rather than replacing them;
2. define the complete temporal obligation fields on the existing occurrence/release layer;
3. define one authoritative day-aware worker-capacity contract that consumes member availability, partial shifts, day reservations, target/max minutes, heavy-work caps and committed placements;
4. make proposal/commit validate against that contract and return explicit conflict rather than silently rewriting upstream truth;
5. migrate special Worker Day weed/mowing injection toward the common released-task → Clock-placement path;
6. only then begin long-range Production labor feasibility and solver behavior.

That order preserves the constitution: remember the farm obligation first, then determine whether human time can lawfully hold it.
