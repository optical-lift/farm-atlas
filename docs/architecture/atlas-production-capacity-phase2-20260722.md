# Atlas Production Spine — Phase 2 Capacity Planning

Date: 2026-07-22

Branch: `agent/atlas-production-spine-phase2`

Stacked on: `agent/atlas-production-spine-phase1`

## Purpose

Phase 1 gave each Spring 2027 snapdragon succession a durable production-lot identity and connected the two known Potomac cohorts to a physical 1,000-seed inventory lot.

Phase 2 answers the next planning question:

> Can Elm physically support the planned cohort during the dates when it needs trays, lit shelves, and prepared field space?

The new model deliberately separates:

1. physical capacity that is confirmed,
2. measurements or planning assumptions that are still unknown,
3. dated capacity required by each production lot,
4. reservations against real capacity pools,
5. readiness and overbooking audits.

It does not infer unknown tray density, light coverage, viable-plant rates, spacing, or bed assignments.

## New internal records

### `capacity_pools`

Represents physical or derived capacity available to the farm.

Initial Elm pools:

- 75 cafeteria trays — confirmed
- 20 rack shelf positions — confirmed
- lit shelf positions — unconfirmed
- Field Row 9 — 30 bed-feet confirmed
- Field Row 10 — 30 bed-feet confirmed

A pool can be backed by one resource, one growing object, or a derived system calculation.

### `capacity_measurements`

Stores numeric facts used by the planner, such as blocks per tray, trays per shelf, light coverage, occupancy duration, spacing, and preparation lead time.

No live measurement records were inserted in Phase 2 because those facts have not been physically confirmed.

### `capacity_questions`

Stores unresolved facts without disguising them as zeroes or defaults.

The Spring 2027 pilot has thirteen open questions:

- Rocket Succession 1 seed quantity
- Madame Butterfly Succession 2 seed quantity
- snapdragon seeds per 3/4-inch block
- 3/4-inch blocks per cafeteria tray
- cafeteria trays per rack shelf
- functional grow-light sets
- shelf positions covered per grow-light set
- lit-shelf occupancy duration
- pre-germination planning viability percentage
- rows per 3-foot bed
- in-row spacing
- bed-preparation lead time
- bed assignments by succession

### `production_capacity_requirements`

Each production lot receives six requirements:

- seed inventory
- soil blocks
- trays
- rack shelf positions
- lit shelf positions
- field bed-feet

Requirements carry required dates, occupancy windows, preparation deadlines, units, and calculation status.

### `capacity_requirement_questions`

Connects each blocked requirement to the exact missing facts preventing calculation or reservation.

### `production_capacity_reservations`

Reserves a quantity from one capacity pool for one production lot and dated window.

Reservations enforce:

- one farm boundary,
- one production lot,
- the correct requirement,
- matching units,
- valid start and end dates.

No live reservations exist yet because the relevant measurements and placements remain unresolved.

## Calculation functions

### `refresh_grow_room_capacity_pools_v1`

Calculates confirmed lit shelf positions from:

- functional grow-light set count,
- shelf positions covered per set,
- total physical rack shelf positions.

The result is bounded by the real shelf count.

### `refresh_snapdragon_capacity_requirements_v1`

For each Spring 2027 snapdragon production lot, the function can derive:

- soil blocks from planned seed quantity and seeds per block,
- trays from blocks and blocks per tray,
- shelf positions from trays and trays per shelf,
- dated shelf occupancy from the sow date and occupancy duration,
- expected viable seedlings from the planning viability percentage,
- bed-feet from viable seedlings, spacing, and rows per bed,
- preparation deadline from transplant date and lead time.

The function leaves a requirement blocked when any required fact is missing.

## Audit views

### `production_capacity_readiness_v1`

Shows for each production lot:

- requirement count,
- calculated or confirmed requirements,
- blocked requirements,
- open questions,
- reservations,
- readiness state.

Readiness states are:

- `blocked_by_missing_facts`
- `calculated_not_reserved`
- `capacity_reserved`

### `capacity_pool_daily_load_v1`

Expands dated reservations into daily demand and reports:

- reserved quantity,
- remaining capacity,
- unknown capacity,
- overbooking.

## Live Spring 2027 baseline

The live database contains:

- 5 capacity pools
- 13 open questions
- 24 production-lot requirements
- 2 confirmed requirements: the two known 500-seed Potomac allocations
- 22 blocked requirements
- 0 capacity measurements
- 0 reservations
- unconfirmed lit shelf capacity

This is the correct observation-mode state.

## Disposable calculation proof

A rollback-only test inserted clearly marked hypothetical measurements:

- 1 seed per block
- 200 blocks per tray
- 2 trays per shelf
- 2 functional light sets
- 5 shelf positions per light set
- 56 lit-shelf days
- 80% planning viability
- 4 rows per 3-foot bed
- 6-inch in-row spacing
- 7-day bed-preparation lead

Under those disposable assumptions, each 500-seed Potomac lot calculated to:

- 500 soil blocks
- 3 trays
- 2 shelf positions
- 50 bed-feet

Succession 3 calculated:

- lit shelf window ending 2027-04-18
- bed preparation due 2027-04-12

Succession 4 calculated:

- lit shelf window ending 2027-05-09
- bed preparation due 2027-05-03

The hypothetical light configuration produced 10 lit shelf positions. A disposable two-position reservation left eight positions available on the first occupied day.

The transaction rolled back. None of those assumptions, calculations, or reservations remain in production.

## Security

All new tables and views remain internal during observe mode.

- `authenticated` cannot read them.
- `anon` cannot read them.
- only `service_role` can read or mutate them.
- ordinary users cannot execute the refresh functions.

No current Atlas route, worker task flow, or app screen changed.

## Next phase

The next build should create an Owner-facing way to answer the thirteen questions and convert approved answers into measured capacity facts.

Once those facts are entered, Atlas can:

1. calculate the real January grow-room load,
2. reveal light or shelf deficits,
3. reserve actual shelf windows,
4. calculate required bed-feet,
5. assign bed segments,
6. generate winter preparation work early enough to protect transplant dates.
