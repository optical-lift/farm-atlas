# Production → Obligation/Release → Clock Constitution

Status: Pass 1 architecture contract for the Atlas Clock scheduler.

This document freezes authority boundaries before scheduler behavior expands. It is not a proposal for duplicate scheduler schema. Existing Atlas structures are assigned to the authority they already represent.

## Governing flow

Atlas scheduling follows one direction of authority:

`Production truth → Work obligation → Release/legal window → Clock placement → Execution/result`

A downstream layer may interpret or place upstream truth. It may not rewrite upstream truth to make its own job easier.

If a real obligation cannot fit inside its lawful execution window under available human capacity, Atlas must preserve the obligation and surface an explicit scheduling conflict. Capacity pressure is never permission to erase, postpone, invent, or rewrite production truth.

## 1. Production authority: what the farm is actually trying to produce

Production owns agricultural truth: the plan, crop/lot lifecycle, farm-resource commitments, and the dates or constraints that arise from producing the crop.

Current canonical structures include:

- `atlas.production_plans`
- `atlas.production_lots`
- `atlas.production_capacity_reservations`

Production answers questions such as:

- What are we producing?
- Which lot or succession exists?
- What lifecycle state and production dates belong to that lot?
- Which farm resource or production capacity has been reserved for it?

Clock does **not** own these facts. Clock may consume them as scheduling inputs, but human overload may not be resolved by changing or deleting production truth.

### Production-capacity warning

`atlas.production_capacity_reservations` describes farm/production resource capacity. That is a different domain from human work capacity. The shared word _capacity_ does not make them interchangeable.

## 2. Obligation and release authority: what work must happen and when it is lawful to do it

The obligation/release layer converts upstream farm truth into durable work that Atlas must remember, then governs when that work becomes eligible for execution.

Current canonical structures include:

- `atlas.planned_work_occurrences`
- `atlas.work_release_policies`
- `atlas.task_release_queue_items`

This layer owns:

- the existence of a real work obligation;
- release eligibility;
- legal or operational execution windows;
- the queue state by which eligible work becomes available for placement/execution.

A capacity decision may change what is shown first or where work is placed. It may not decide that a real obligation never existed.

This preserves the existing Work Reservoir law: capacity may control presentation, but never whether Atlas remembers real work.

## 3. Clock authority: where eligible human work fits

Clock owns human time placement and the human-capacity inputs required to make that placement responsibly.

Current canonical structures include:

- `atlas.worker_day_task_placements`
- `atlas.worker_day_task_placement_events`
- `atlas.member_capacity_settings`
- `atlas.member_workload_settings`
- `atlas.task_capacity_profiles`

`atlas.worker_day_task_placements` already carries human schedule facts such as `planned_start_at` and `planned_duration_minutes`. That makes it a Clock placement structure, not a Production source of truth.

Clock answers questions such as:

- Which eligible obligation should this worker do today?
- At what human time should it be placed?
- How much time/capacity does it consume?
- Can all legally due work fit?
- What needs to move within its lawful window?
- Where is the schedule impossible without an explicit decision upstream?

Clock does not manufacture agricultural obligations, redefine crop lifecycle truth, or silently discard released work.

## 4. Non-negotiable invariants

### Invariant A — Upstream truth outranks downstream convenience

Production truth cannot be rewritten merely because the human schedule is full. Obligation truth cannot be erased merely because Clock cannot place it.

### Invariant B — Remember first, place second

A real obligation remains durable even when it is not yet visible in today's bounded worker view. Capacity controls placement and presentation, not existence.

### Invariant C — Placement obeys the legal window

Clock may place or re-place work only inside the execution window granted by the obligation/release layer. A future solver may optimize within that window; it may not silently widen the window.

### Invariant D — Impossible fit becomes conflict

When available human capacity cannot satisfy a real obligation inside its lawful window, Atlas must emit an explicit scheduling conflict/exception state. It must not solve overload by mutating production facts, suppressing the obligation, or pretending the task is optional.

### Invariant E — Clock state is derived and rebuildable

Clock placement is downstream scheduling state. Rebuilding or changing a placement must not require changing the Production or Obligation source facts that justified the work.

### Invariant F — Farm capacity and human capacity stay distinct

Production-resource capacity belongs to Production. Worker time, workload, and task-effort capacity belong to Clock. Any future capacity solver must name which domain it is solving.

### Invariant G — No duplicate scheduler ontology

Before introducing a new scheduler table, queue, placement record, capacity model, or release concept, Atlas must first prove that the existing canonical structures above cannot represent the required responsibility. New schema must extend an authority boundary, not create a competing copy of it.

### Invariant H — Downstream code cannot repair overload by direct upstream mutation

No Clock write path may directly update or delete Production or Obligation truth as an overload-resolution mechanism. A legitimate upstream plan change must occur through the upstream authority that owns that fact and remain auditable as such.

## 5. Conflict is a first-class result, not a scheduler failure

The Clock scheduler is not required to make every set of inputs fit. It is required to tell the truth about whether they fit.

A valid scheduler result may therefore be:

1. all eligible work placed lawfully;
2. some work intentionally unplaced because it remains outside the current presentation horizon while still durable upstream; or
3. an explicit conflict because legal obligations exceed available human capacity or otherwise cannot be placed without changing an upstream decision.

The third result is required whenever the only alternative would be to lie about Production, Obligation, Release, or capacity.

## 6. Pass 1 boundary

Pass 1 is complete when:

- this ownership constitution is present in the repository;
- architecture regression tests require the Production → Obligation/Release → Clock boundary and conflict rule to remain explicit;
- existing live Atlas schema has been mapped into these authorities instead of duplicated; and
- no scheduler behavior is added that outruns this contract.

Later passes may add or refine candidate generation, conflict representation, placement/solver behavior, Clock UI, and capacity policies. Those implementations are governed by this document.