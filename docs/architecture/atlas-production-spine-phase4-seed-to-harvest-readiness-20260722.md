# Atlas Production Spine Phase 4 — Seed to Field

Status: implemented in Supabase, review branch only
Date: 2026-07-22

## Scope

Phase 4 carries one production lot from reserved seed through an exact field placement without changing the existing Atlas worker interface.

The durable chain is:

`seed allocation → sowing → tray batch → germination → seedling care → readiness → bed gate → transplant placement → establishment check`

Phase 4 stops at the establishment-check handoff. Counted field survival, field care, and harvest readiness belong to Phase 5.

## Canonical records

- `production_tray_batches` represents the physical tray cohort.
- `seed_allocation_consumptions` records exact reserved seed consumed.
- `production_stage_observations` preserves germination outcomes.
- `production_readiness_observations` preserves counted transplant readiness.
- `production_transplant_gates` separates seedling readiness from bed readiness.
- `production_transplant_placements` records exact plants placed into each assigned bed.

Tasks remain projections of state. A generic task completion cannot invent seed counts, tray counts, surviving seedlings, prepared bed space, or transplanted plants.

## Commands

- `record_production_sowing_v1`
- `record_production_germination_v1`
- `record_production_seedling_care_v1`
- `record_production_readiness_v1`
- `refresh_production_transplant_gate_v1`
- `record_production_transplant_v1`

Each command is idempotent, uses canonical task transitions, stays inside one farm, and is internal-only during observation mode.

## Required gates

A transplant cannot open until:

1. The tray cohort has a counted readiness observation.
2. Required bed-feet are calculated.
3. Every destination is an active measured bed assignment.
4. Bed-preparation work is complete.
5. The exact per-bed plant distribution reconciles to the surviving seedling count and measured planting density.

## Proven rollback path

The disposable Potomac proof demonstrated:

- exact seed consumption from a 500-seed reservation;
- a counted tray cohort;
- not-yet and ready biological observations;
- recalculated bed demand from living seedlings;
- a blocked transplant while one bed remained unprepared;
- exact placement of 180 plants into each of two 30-foot beds;
- one planting claim, two field crop cycles, two object histories, and one establishment-check task;
- adoption of existing canonical crop-cycle behavior rather than creation of a competing registry.

All proof data rolled back. The Spring 2027 Snapdragon pilot remains planned and untouched.

## Security

The new tables and commands are sealed from anonymous and ordinary authenticated roles. Service-role access is limited to the internal engine until a membership-scoped interaction contract is built.

## Out of scope

Phase 4 does not decide or record:

- establishment losses;
- watering, weeding, pinching, support, or fertility policy;
- harvest timing;
- marketable stem estimates;
- actual harvest quantities;
- postharvest inventory or sales.

Those belong to the next stacked phase.
