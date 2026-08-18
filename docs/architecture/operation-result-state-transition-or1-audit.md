# Operation → Result → State Transition — OR1 Primitive Audit

Status: active architecture guard for OR1
Governing vocabulary: `REQUIRES`, `USES`, `CONSUMES`, `PRODUCES`, `MEASURES`, `CHANGES`, `TRIGGERS`, `TRAVELS_WITH`.

## Governing decision

Atlas already contains most of the shared operation/result membrane as differentiated domain machinery. OR1 therefore does **not** authorize a universal completion engine, a universal inventory table, or replacement of the seed, Harvest, maintenance, Production, Workflow, or Worker Day contracts.

The implementation direction is:

1. keep canonical domain ledgers and projections;
2. keep task/result evidence as execution witness, not domain truth;
3. extend the shared Worker result/orchestration envelope so it can call domain-specific effect adapters;
4. add a generic resource event/state contract only for resources that do not already have a stronger domain ledger;
5. add a narrow scheduling-affinity primitive for `TRAVELS_WITH` because no canonical one exists;
6. make Clock/Worker Day consume resulting state and gates rather than infer readiness from task completion.

## Primitive disposition map

| Existing primitive | Shared role | Domain owner | Current truth / gap | Disposition |
|---|---|---|---|---|
| `atlas.tasks` | operation carrier | execution | Authorizes/routs work but is not the subject or resulting state. | KEEP |
| `atlas.worker_state_transition_card_v2` | operation authorization + result contract surface | Worker Day | Exposes `done/partial/blocked/condition_differs`; already states that Done requires recorded operation actual + subject reclassification. | KEEP / EXTEND |
| `atlas.worker_record_state_transition_result_v1` | human result / witness envelope | shared execution | Shared worker result path exists, but its effects are still primarily Production/Crop-specific. | EXTEND as orchestration envelope; do not make it a universal domain ledger |
| `atlas.production_operation_actuals` + `atlas.production_operation_actual_crop_cycles` | `MEASURES`, `CHANGES` evidence | Production / Crop | Useful operation-actual evidence and subject linkage; not appropriate as the one storage model for mowing, seed, Harvest, or generic supplies. | KEEP as domain/shared evidence where already valid |
| `atlas.task_prerequisites` | `REQUIRES` — Class A task prerequisite | execution | Correct when one particular prior operation must complete. | KEEP |
| `atlas.task_dependency_clocks` | delayed task prerequisite / temporal consequence | execution | Correct for task-specific delayed dependency. It must not become the general state-trigger system. | KEEP, bounded to task dependency semantics |
| `atlas.task_resource_requirements` | `REQUIRES`, `USES` | resource gating | Already supports `required`, `check_first`, `reserved`, `needed`, quantities/units, and resource linkage. | KEEP / EXTEND |
| `atlas.resources` | generic resource identity + legacy current state | generic resources | Supports `available`, `unknown`, `needs_check`, `needs_repair`, etc., but quantity/status are mutable current fields rather than event-derived truth. No canonical battery push-mower set currently exists at Elm. | KEEP identity; EXTEND with event-derived state |
| `atlas.task_required_resources_available_v1` | state/resource gate | execution/resource | Executability currently reduces generic resource readiness to `resources.status = 'available'`. It cannot represent charge consumption/reset lineage by itself. | EXTEND to consume derived generic resource state |
| `atlas.action_requirement_templates` | `REQUIRES`; legacy follow-up hints | execution | Requirement categories/keys are reusable. `creates_follow_up_task_types` is task-chain oriented and must not become the shared `TRIGGERS` law. | KEEP requirement data; DEPRECATE hard-coded follow-up authority as state-trigger replacement |
| `atlas.task_completion_impact_policies` | completion-effect completeness guard | shared execution | Valuable guard, but current accepted impacts are too coarse. Example: mowing recognizes maintenance/object effects but not reusable-resource charge state; sowing recognizes Crop/Production effects but not canonical seed consumption. | EXTEND accepted effect classes after adapters exist |
| `atlas.task_outcome_events` | human/task result witness | execution | Auditable task outcome evidence; not downstream physical truth. | KEEP |
| `atlas.task_transitions` | task lifecycle witness | execution | Correct task lifecycle evidence with actor/idempotency. Done is not domain state. | KEEP |
| `atlas.workflow_events` | `TRIGGERS` transport/evidence | Workflow | Good event bus for workflow consequences. | KEEP |
| `atlas.workflow_handoffs` | `TRIGGERS` workflow handoff | Workflow | Useful when a workflow consequence really is a handoff. Must not substitute for domain state or generic state-trigger evaluation. | KEEP, bounded |
| `atlas.work_gate_evaluations` | `REQUIRES` gate evaluation evidence | release/Clock | Correct evidence that an occurrence passed/failed gates. | KEEP |
| `atlas.task_release_queue_items` | routing projection | Clock/release | Downstream routing queue, not source reality. | KEEP |
| `atlas.mowing_events` | `MEASURES`, `CHANGES` witness | maintenance/mowing | Immutable/idempotent mowing result evidence already exists. | KEEP |
| `atlas.mowing_area_state` | `CHANGES` projection | maintenance/mowing | Correct mowing-area reclassification including target cut height/equipment group. | KEEP |
| `atlas.record_mowing_result_core_v1` | result adapter candidate | maintenance/mowing | Mature result path records mowing event, updates area/rhythm/task state, and reevaluates rhythm. It currently has no battery/resource effect. | KEEP and adapt into shared membrane |
| `atlas.maintenance_objects`, `atlas.maintenance_history`, `atlas.maintenance_dependencies` | `CHANGES`, task prerequisite where appropriate | maintenance | Existing maintenance identity/history should remain separate from reusable equipment resource state. | KEEP |
| `atlas.seed_lots` | seed identity | seed inventory | Canonical seed-lot truth. | KEEP |
| `atlas.seed_lot_allocations` | `REQUIRES` / claim | seed / Production | Canonical future seed allocation. | KEEP |
| `atlas.seed_allocation_consumptions` | `CONSUMES` | seed inventory | Canonical attributable seed consumption with source task/idempotency. | KEEP |
| `atlas.seed_inventory_events` | `MEASURES`, `CHANGES` | seed inventory | Event-first seed inventory evidence already exists. | KEEP |
| `atlas.seed_inventory_state` | state projection / gate | seed inventory | Preserves verified quantity, status, freshness and low-stock threshold. | KEEP |
| `atlas.seed_lot_task_links` | subject/resource lineage | seed inventory | Canonical seed/task relation. | KEEP |
| `atlas.crop_harvest_events` | `MEASURES`, `PRODUCES`, `CHANGES` | Harvest/Crop | Canonical harvest actual with marketable/seconds/discarded quantity and `more_available`. | KEEP |
| `atlas.crop_harvest_availability` | state projection | Harvest/Crop | Canonical standing harvest availability state. | KEEP |
| `atlas.flower_harvest_batches` + `atlas.flower_harvest_bucket_observations` | `MEASURES`, `PRODUCES` | Harvest | Practical physical-output evidence and lineage. | KEEP |
| `atlas.flower_preparation_batches` | `CHANGES`, `PRODUCES` | Harvest | Preparation transition remains domain-specific. | KEEP |
| `atlas.flower_ready_inventory_lots` | `PRODUCES` Ready inventory | Harvest/commercial | Canonical Ready inventory; physical harvest is not automatically Ready. | KEEP |
| `atlas.planned_work_occurrences.relation_payload` | release-time relation snapshot | release | Already preserves task objects, Crop links, Production links, Harvest links, and resource requirements. It is a snapshot, not canonical scheduling affinity. | KEEP; do not overload as `TRAVELS_WITH` source |
| `atlas.worker_day_selection_overlay_v1` / Farm Clock selectors | consumes state/gates | Worker Day / Clock | Phase 12 already consumes Reality warrant, temporal/destination/resource/capacity gates. | KEEP / later OR7 extension |

## Shared vocabulary ownership

### `REQUIRES`

Use existing task prerequisites when a **specific prior operation** is the governing condition. Use state/resource gates when reality itself is the governing condition. Existing homes: `task_prerequisites`, `task_resource_requirements`, `work_gate_evaluations`, domain readiness projections.

### `USES`

Use `task_resource_requirements` for reusable equipment/tool requirement identity. `USES` must not imply quantity destruction.

### `CONSUMES`

Use the strongest domain ledger available:

- seed → `seed_allocation_consumptions` / seed events;
- Harvest/commercial inventory → Harvest claims/fulfillment domain;
- generic supply or reusable charge/capacity with no stronger domain → new generic resource event contract.

### `PRODUCES`

Use domain output ledgers. Harvested flowers stay Harvest truth. Ready inventory stays Ready-inventory truth. Generic received supply may use generic resource events.

### `MEASURES`

Human result evidence belongs in the domain result adapter with the smallest observation necessary to establish next state. Existing mowing, seed-inventory, Harvest and Production result machinery already demonstrates this pattern.

### `CHANGES`

Write a durable domain event first where practical, then derive/recompute the domain projection. Task status alone never satisfies `CHANGES`.

### `TRIGGERS`

A resulting state may cause continuation, reset, inspection, acquisition, decision, or routing reevaluation. Existing Workflow events/handoffs remain useful transport, but the trigger must originate from resulting state rather than an unconditional task-A-creates-task-B rule.

### `TRAVELS_WITH`

No canonical scheduling-affinity table or function exists in the live Atlas schema. `planned_work_occurrences.relation_payload` is a release snapshot and `task_subject_links` links tasks to subjects, not task-to-task scheduling affinity. A narrow affinity primitive is therefore justified in OR2.

`TRAVELS_WITH` must never mean prerequisite, shared completion, or merged task identity.

## OR1 mower findings

1. Elm has a canonical broken `cub_cadet_lawn_mower` resource, but no canonical battery push-mower / two-battery working-set resource.
2. `record_mowing_result_core_v1` already records immutable/idempotent mowing evidence, updates `mowing_area_state`, updates rhythm state, and closes/blocks/reschedules the task correctly.
3. Mowing completion currently changes **no reusable-resource state**.
4. Generic resource readiness currently relies on mutable `atlas.resources.status`; there is no append-only generic resource event/state projection for `charge_consumed → needs_charge → charging_started → ready_confirmed`.
5. No canonical scheduling-affinity primitive exists for Follow-Me Arches ↔ Curve Garden.
6. `task_completion_impact_policies` for mowing currently accepts maintenance/object impacts but does not recognize reusable-resource consumption/reset effects.
7. The mower solution must therefore extend the existing mowing result path rather than create a second mowing completion engine.

## OR2 additions justified by OR1

Only two new cross-domain primitives are justified before the mower specimen can be complete:

### A. Generic resource event/state contract

For generic supplies and reusable resources **without a stronger domain ledger**. It must be event-first, attributable, idempotent, and preserve unknown.

Minimum event semantics needed by the mower specimen:

- `charge_consumed`;
- `charging_started`;
- `ready_confirmed`;
- optional `counted`, `received`, `consumed`, `damaged`, `discarded` for later OR5 generic supply use.

Minimum provenance: resource, source task/operation when applicable, actor/witness, event time, optional quantity/unit, idempotency key, metadata.

The current-state projection must distinguish at minimum `unknown`, `ready`, `needs_charge`, `charging`, `unavailable` without fabricating readiness.

### B. Scheduling-affinity relation

A narrow task/occurrence relationship whose canonical meaning is `TRAVELS_WITH` / shared execution packet. It must preserve separate task identity and must not satisfy prerequisites or completion.

First acceptance relation:

- Mow Follow-Me Arches
- Mow Curve Garden

They travel together and collectively consume one full battery-set charge.

## OR2 integration rule

The mower completion path should become:

`mowing result witness`
→ existing `mowing_events`
→ existing `mowing_area_state` / rhythm reclassification
→ generic resource effect adapter records one battery-set `charge_consumed`
→ generic resource state becomes `needs_charge`
→ resulting state exposes a small reset continuation
→ reset result records `charging_started`
→ future mower work remains non-executable until readiness is re-established.

Mowing remains complete even when the battery reset remains unresolved.

## OR1 exit decision

OR1 is complete when this audit and its repository guard are present. No production DDL is required for OR1 itself.

Proceed next to OR2 by implementing the mower specimen through the two justified missing primitives while reusing the existing mowing event/state/result machinery.
