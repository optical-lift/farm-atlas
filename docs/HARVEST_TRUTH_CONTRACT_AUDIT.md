# Harvest Truth Contract — Existing Primitive Audit

**Status:** Governing implementation audit — Pass 1  
**Date:** 2026-08-15  
**Branch:** `agent/harvest-truth-contract-pass1`  
**Scope:** Existing Atlas Harvest primitives, their current live use, and their disposition under the Principal Operating System direction.

## 1. Governing position

Harvest is the current first development milestone.

The completion target is not a prettier Harvest screen. Atlas must establish a stable truth chain that downstream production, sales, fulfillment, management, and later Principal systems can consume:

`crop / field truth → lawful harvest work → worker execution → physical harvest actual → preparation → finished saleable inventory → customer claim / order → fulfillment → actual commercial result → production evidence`

Harvest does not own worker time. Worker Day / farm Clock owns placement of lawful work.

Harvest does not own Principal priority. A delegated farm fact reaches the Principal only through the future escalation contract when ownership judgment, authority, capital, or consequence has actually earned the floor.

## 2. Pass 1 invariants

1. Tasks are execution objects, not crop or inventory truth.
2. Harvest Horizon is forecast/readiness evidence, not harvested inventory.
3. A worker reports physical reality. The worker is not required to produce accounting precision that the physical process does not naturally provide.
4. Flower harvest does not require a stem-count stage unless the sold product itself requires a stem count.
5. Demand and supply may exist independently.
6. Forecast inventory is never rendered as finished inventory.
7. Prospecting inventory is not sold inventory.
8. Harvest never schedules itself.
9. An unfinished or uncertain delegated task does not become Principal work merely because it exists.
10. Append-only physical observations and idempotent write paths are preserved.

## 3. Live-state audit

Direct production-database inspection on 2026-08-15 found:

- `atlas.crop_harvest_availability`: **81 rows**
- `atlas.crop_harvest_events`: **4 rows**
- `atlas.production_harvest_lots`: **0 rows**
- `atlas.production_harvest_stand_entries`: **0 rows**
- `atlas.postharvest_containers`: **0 rows**
- `atlas.postharvest_container_events`: **0 rows**

All four existing `crop_harvest_events` are `watch / declining` observations from 2026-08-03. None is a recorded cut. The active live system is therefore the Harvest Horizon / Harvest Watch state path, not the deeper stem-count production/postharvest ledger.

The availability rows are overwhelmingly taskless forecast/watch state. This is useful evidence that Atlas already knows how to preserve crop harvest windows without creating months of future tasks.

## 4. Current code path

### Harvest Horizon

Current files:

- `app/harvest/page.tsx`
- `app/api/atlas/harvest-horizon/route.ts`

Current function:

- read active crop-cycle harvest windows;
- combine calculated forecast, field observation, harvest availability, and harvest-event evidence;
- group crop waves into now / coming windows;
- let a human record quick field sightings;
- keep forecast evidence separate from executable work.

This is directionally correct.

### Harvest Watch

Current files:

- `app/task-focus/[taskId]/HarvestWatchFocusPage.tsx`
- `app/api/atlas/harvest-watch/route.ts`

Current database path:

- `record_harvest_watch_observation_for_member_v1`
- `owner_operator_record_harvest_watch_observation_v1`
- `record_harvest_watch_observation_core_v1`
- `atlas.crop_harvest_events`
- `atlas.crop_harvest_availability`
- `ensure_crop_harvest_task_v1`

Current worker observations are useful: `not_ready`, `beginning`, `harvestable`, `declining`, `finished`, and `problem_or_uncertain`.

Quantity is optional at watch time. That is compatible with the new contract.

### Harvest Cut

Current files:

- `app/task-focus/[taskId]/HarvestCutFocusPage.tsx`
- `app/api/atlas/harvest-cut/route.ts`

Current database path:

- `record_crop_harvest_cut_for_member_v1`
- `owner_operator_record_crop_harvest_cut_v1`
- `record_crop_harvest_cut_core_v1`

This path is where the obsolete assumption lives. The worker UI is explicitly named **Harvest + Count** and requires:

- marketable quantity;
- seconds quantity;
- discarded quantity;
- unit;
- whether more remains.

The UI defaults to stems. `ensure_crop_harvest_task_v1` also creates a task titled `Harvest + count` and instructs the worker to record marketable, second-quality, and discarded quantity.

That is not the canonical Elm flower-harvest interaction going forward.

## 5. Primitive disposition map

### KEEP

#### `atlas.crop_harvest_availability`

**Role:** crop-cycle harvest readiness / current availability state.

Why keep:

- it is already live and populated;
- it carries watch versus harvestable/declining/finished state;
- it preserves current watch/harvest task and occurrence identity;
- it supports taskless forecast state.

It must not become finished-product inventory.

#### `atlas.crop_harvest_events`

**Role:** append-only crop harvest observation/event ledger.

Why keep:

- append-only mutation protection already exists;
- idempotency already exists;
- watch observations already use it successfully;
- crop-cycle biological state needs an attributable event history regardless of product inventory.

The existing marketable/seconds/discarded columns are legacy precision fields. They must not force the canonical flower-harvest worker interaction.

#### Harvest Horizon

**Role:** forecast/readiness projection.

Keep `app/harvest/page.tsx` and `/api/atlas/harvest-horizon` as the basis for the future **In the field** portion of Harvest.

The current stem forecasts are forecasts only. They may remain as evidence where genuinely supported, but they may never be displayed as actual finished inventory.

#### Harvest Watch

**Role:** physical readiness observation that decides whether actual harvest work should release.

Keep the observation states, taskless horizon behavior, future recheck behavior, crop-cycle linkage, append-only event, and release membrane.

#### Planned work / release machinery

Keep `planned_work_occurrences`, release policies, task/crop-cycle relationships, and lawful conversion from `harvestable` observation into executable work.

Production truth decides that harvest is required. Worker Day / Clock decides when the released work fits.

### EXTEND

#### Harvest tab

The tab must become a projection across the full commercial realization chain rather than a forecast-only page.

Preserve Harvest Horizon as the first section, then add progressively:

`In the field → Harvested → Prepare → Ready → Sold / Available → Going out → Fulfilled`

#### Physical flower output

Add a canonical bucket-scale layer above individual crop/task events.

The governing objects for Pass 2 are:

- `flower_harvest_batches`
- `flower_harvest_bucket_observations`

A batch represents one real harvest session/date. Bucket observations record crop-specific physical output using bucket-equivalent quantity. The batch may aggregate several crop cycles/tasks.

This layer owns **what physically came out of the farm**, not sales decisions.

#### Crop harvest cut transition

The crop-cycle state transition after a real cut remains useful:

- first harvest date;
- last harvest date;
- more remains versus finished;
- next watch when more remains.

But the transition must be decoupled from mandatory worker entry of marketable / seconds / discarded counts.

A flower harvest can advance the crop cycle from a bucket-scale observation while legacy precision fields remain null unless a later specialized process genuinely records them.

#### Management exception handoff

`problem_or_uncertain` is legitimate operational evidence. The current implementation, however, may reassign the worker task itself to an Owner membership.

Replace that behavior with a contained management exception record. Preserve the worker task / crop truth. A future Principal escalation is a separate object containing the ownership decision or consequence, not a reassigned copy of the worker's task.

### DEPRECATE AS CANONICAL FLOW

#### `Harvest + Count` worker interaction

Deprecate the requirement that ordinary Elm flower harvest must record marketable, seconds, and discarded quantities.

The natural worker question becomes:

> What came out of the field?

For flower harvest, initial controls should favor bucket-equivalent observations such as quarter, half, three-quarter, one, and one-plus bucket, plus whether more remains.

#### Stem-oriented production harvest ledger as the primary Elm path

The following structures are not deleted in Pass 1:

- `atlas.production_harvest_lots`
- `atlas.production_harvest_stand_entries`
- `atlas.production_harvest_container_assignments`
- `atlas.postharvest_containers`
- `atlas.postharvest_container_events`
- `atlas.production_field_to_harvest_readiness_v1`

They encode a much more precise stem-oriented production/postharvest model and currently contain no live operational records.

They are **not** the foundation for the new Elm bucket-scale Harvest path. Preserve them during migration because future counted wholesale crops or other production systems may still justify a precision ledger.

### REMOVE LATER

Nothing is removed in Pass 1.

After the bucket-scale path has real production evidence, run a second usage/dependency audit. Only then remove structures that have no surviving specialized use.

## 6. Principal-architecture conflict discovered in the audit

`record_harvest_watch_observation_core_v1` currently handles `problem_or_uncertain` by creating a task-problem handoff and, on some paths, assigning the original task to the Owner membership with `visibility_scope='assigned_worker'`.

That reflects the retired assumption that Owner is the highest-level farm worker.

New invariant:

> Delegated operational truth remains in the operating system. Ownership receives a translated escalation only when a threshold requires Principal authority, judgment, approval, or capital.

Harvest Pass 2 must not deepen the current reassignment behavior.

## 7. Pass 2 — smallest implementation slice

Pass 2 should establish **Physical Output Truth** without attempting sales, finished products, or Principal UI yet.

### Schema target

Create durable bucket-scale harvest batch objects with provenance:

#### `flower_harvest_batches`

Minimum contract:

- `id`
- `farm_id`
- `harvest_date`
- `status`
- `worker_membership_id` nullable when not attributable
- `source_kind`
- `source_id` nullable
- `idempotency_key`
- `metadata`
- timestamps

#### `flower_harvest_bucket_observations`

Minimum contract:

- `id`
- `batch_id`
- `farm_id`
- `crop_cycle_id` nullable only where physical crop identity cannot yet be resolved
- `task_id` nullable
- `crop_profile_id` nullable
- `bucket_equivalent`
- `note`
- `idempotency_key`
- `created_by_user_id`
- `metadata`
- `created_at`

Observations should be append-only.

### Write contract

Create one authenticated worker-safe write path that:

1. verifies farm/task/crop-cycle scope;
2. records or reuses the harvest batch idempotently;
3. appends the bucket observation;
4. records the crop biological cut event / transition without requiring stem-quality counts;
5. marks the execution task done through the canonical transition machinery;
6. updates harvest availability;
7. re-enrolls Harvest Watch when more remains;
8. leaves preparation, inventory, sales, and fulfillment untouched.

### Worker UI target

Replace `Harvest + Count` with a bounded physical report:

**What came out of the field?**

- crop / growing area already supplied by the task;
- bucket-equivalent amount;
- more remains: yes / no;
- optional physical note.

No product decision. No sales decision. No arbitrary stem count.

## 8. Pass 2 acceptance specimen

A real Elm harvest must be representable as one batch containing multiple crop observations, for example:

- Zinnias — 1 bucket
- Celosia — 0.5 bucket
- Rudbeckia — 0.5 bucket
- Filler / foliage — 1.5 buckets

Acceptance requires:

- each physical observation is durable and attributable;
- completing one crop harvest does not erase the batch;
- crop-cycle state still advances correctly;
- additional harvest can be re-watched when more remains;
- Harvest can show actual bucket output separately from forecast;
- no finished product inventory is invented;
- no Principal work item is generated merely because a worker task is incomplete or uncertain.

## 9. What Pass 1 intentionally does not do

This pass makes no live schema change.

It does not build:

- products;
- finished inventory;
- buyer claims;
- standing orders;
- delivery routing;
- Principal Clock candidates;
- Principal escalation tables.

Those follow only after physical Harvest truth is stable.

## 10. Immediate sequence after this audit

1. **Pass 2 — Physical Output Truth**: bucket-scale batches and observations; new worker harvest result contract.
2. **Pass 3 — Preparation + Finished Inventory**: actual Posy / Bouquet / Lobby Arrangement / counted bundle output.
3. **Pass 4 — Demand / Customer Claims**: demand independent of supply.
4. **Pass 5 — Fulfillment**: pickup/delivery truth and legitimate Worker Day obligations.
5. **Pass 6 — Reconciliation**: production → harvest → preparation → sale → fulfillment → actual result.

Only after Pass 6 is Harvest stable enough to declare the first Principal Operating System milestone complete.
