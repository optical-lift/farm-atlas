# Atlas Production Spine — Phase 1

Date: 2026-07-22  
Branch: `agent/atlas-production-spine-phase1`  
Stacked base: `agent/atlas-work-handoffs`

## Purpose

Phase 1 gives production work a durable identity that survives beyond any one task card.

The pilot proves this initial route:

`production program → seed lot → seed allocation → production lot → sowing task → future crop cycle`

Later phases will extend the same identity through capacity reservations, bed assignments, care, harvest lots, product assembly, sales, attributed value, and season learning.

This phase does not create tray counts, bed reservations, harvest quantities, or sales records. Unknown facts remain unknown.

## New production records

### `production_programs`

Records the farm promise or production commitment that justifies the crop work.

The pilot program is:

- `Spring 2027 Snapdragon Program`
- season year `2027`
- four planned successions
- intended for cut flowers, bouquets, florists, and business delivery
- output and revenue targets remain unset

### `seed_lots`

Represents one physical inventory source rather than a crop-profile note.

The confirmed pilot lot is:

- Johnny's Potomac Ivory F1
- 1,000 seeds
- source type `existing_inventory`
- supplier known
- purchase date unknown
- purchase cost unknown

### `production_lots`

Represents one physical crop cohort intended to move through the farm together.

The pilot contains:

1. Rocket Snapdragons · Succession 1
2. Madame Butterfly Snapdragons · Succession 2
3. Potomac Ivory Snapdragons · Succession 3
4. Potomac Ivory Snapdragons · Succession 4

Rocket and Madame Butterfly retain null planned seed quantities. Atlas does not infer those counts from a tray, label, or crop profile.

### `seed_lot_allocations`

Connects physical seed inventory to crop cohorts.

The 1,000 confirmed Potomac seeds are reserved as:

- 500 seeds → Succession 3
- 500 seeds → Succession 4

The database rejects an allocation that would exceed the seed lot's received inventory.

### `production_lot_tasks`

Connects existing work cards to the durable crop cohort.

Each of the four Spring 2027 sowing cards is linked to its matching production lot by the task's stable `task_key`.

### `production_lot_crop_cycles`

Provides the future biological link. It is intentionally empty for the four pilot lots because none has been sown and no biological cohort should be claimed yet.

### `production_lot_events`

Provides append-only quantity and stage history.

Initial events record:

- each production lot was planned
- 500 Potomac seeds were allocated to Succession 3
- 500 Potomac seeds were allocated to Succession 4

Events cannot be edited or deleted. Corrections must be represented by a later correcting event.

## Internal views

### `seed_lot_inventory_v1`

Shows received, reserved, consumed, released, and available quantities without storing a second mutable remaining-count field.

### `production_lot_lineage_v1`

Shows one row per production lot with:

- program identity
- crop profile
- planned quantity and dates
- seed sources
- linked tasks
- linked crop cycles
- append-only events

### `production_program_summary_v1`

Surfaces current completeness:

- production-lot count
- lots with unknown seed demand
- known planned seed demand
- allocated seed quantity
- seed gaps
- missing task links
- missing crop-cycle links

## Live pilot result

The live Spring 2027 Snapdragon program currently reports:

- 4 production lots
- 2 lots with unknown seed demand
- 1,000 known planned seeds
- 1,000 allocated seeds
- 0 known seed gaps
- 0 missing sowing-task links
- 4 crop-cycle links still absent by design

The Potomac seed inventory reports:

- 1,000 received
- 1,000 reserved
- 0 consumed
- 0 available
- not overallocated
- cost unknown

## Safety boundaries

- All new tables have row-level security enabled.
- No table or view is readable by `authenticated` or `anon` during observe mode.
- The service role can manage mutable planning records.
- The service role can insert and read production events but cannot update or delete them.
- Trigger functions are not executable by public, anonymous, or authenticated roles.
- Cross-farm task, crop-cycle, object, and seed links are rejected.
- Seed-lot and production-lot crop profiles must match when both are known.

## Acceptance proof

The full schema and pilot migration were first executed inside a rollback transaction. The transaction asserted:

- one production program
- four production lots
- four task links
- one seed lot
- two seed allocations
- zero unallocated Potomac seeds
- two explicitly unknown seed-demand lots
- 1,000 known planned seeds

After the live migration, separate probes confirmed:

- a 501-seed allocation cannot replace either 500-seed reservation
- production events cannot be mutated
- anonymous and authenticated roles cannot read the internal spine

## Next phase

Phase 2 should add capacity definitions and reservations without changing these identities:

- blocks per tray
- trays per shelf
- light coverage per shelf
- date-bounded tray and shelf occupancy
- expected viable plants
- bed-foot demand
- bed reservation and preparation deadline

No capacity value should be inferred from existing resource labels alone. Each missing conversion remains an Owner question until measured.