# Atlas Production Spine Phase 3 — Owner Readiness Path

Date: 2026-07-22

## Purpose

Phase 3 turns the internal Spring 2027 capacity model into an Owner-operable planning path without exposing sealed production tables or creating a second task system.

The path is:

`Owner answer → measured/confirmed planning fact → requirement recalculation → dated grow-room reservation → structured bed assignment → canonical bed-preparation task`

The pilot remains limited to the Spring 2027 Snapdragon Program.

## Owner interface

The Owner dashboard links to `/owner/production-readiness`.

The page shows:

- the 13 unresolved planning questions;
- whether each answer is measured, confirmed, or estimated;
- confirmed tray, shelf, light, and bed capacity;
- all four Spring 2027 Snapdragon production lots;
- seed, block, tray, shelf, light, and bed requirements;
- dated grow-room reservations;
- bed assignments and linked preparation tasks;
- overbooked or unknown capacity dates.

The page begins with all 13 questions open. No seed counts, grow-light coverage, planting density, viability, or bed destinations are inferred.

## Security boundary

The web route uses the authenticated Atlas server client and requires an active Owner membership.

Reads and writes occur only through membership-scoped SECURITY DEFINER functions:

- `owner_production_capacity_snapshot_v1`
- `owner_answer_capacity_question_v1`
- `owner_assign_production_bed_v1`
- `owner_release_production_bed_v1`
- `owner_recalculate_production_capacity_v1`

The route also requires a same-origin request with `x-atlas-intent: production-capacity-v1` for mutations.

The browser and API route never receive the service-role key and never read the internal capacity tables directly.

Internal capacity tables, assignment tables, calculation functions, and synchronization functions remain revoked from `anon` and ordinary `authenticated` access.

## Measurement behavior

Each numeric planning answer carries confidence:

- `measured` — physically measured in Elm's setup;
- `confirmed` — a confirmed count or Owner decision;
- `estimated` — a planning assumption that remains visibly an estimate.

A functional grow-light count of zero is valid measured data. Zero does not mean missing.

Rocket and Madame Butterfly seed quantities update their production lots and create append-only production-lot events. Other answers update the current capacity measurement used by the planner.

Every answer recalculates all dependent requirements.

## Dated grow-room reservations

Tray, rack-shelf, and lit-shelf requirements receive the same occupancy window.

When the required quantity or window changes, obsolete automatic reservations are released before the current reservation is written. This prevents old and new windows from being counted at the same time.

The daily load view continues to compare dated reservations against confirmed physical capacity and reports unknown or overbooked dates.

## Bed assignments

Bed capacity continues to come from `growing_objects.length_ft`.

A bed assignment records:

- the production lot;
- the calculated bed-feet requirement;
- the actual growing object;
- assigned bed-feet;
- planned transplant date;
- assignment state.

Assignments can be partial and can span multiple beds. Atlas rejects:

- cross-farm assignments;
- non-bed objects;
- unmeasured beds;
- more feet than the selected bed contains;
- more total assigned feet than the current lot requirement.

The assignment deliberately leaves `expected_release_date` null. Harvest and clear timing are not yet known well enough to invent the bed's release date.

If later density or viability changes reduce a lot's bed requirement below its existing assignments, Atlas reopens the placement question and labels the lot over-assigned rather than silently accepting the mismatch.

## Winter preparation work

Once a bed requirement, preparation lead time, and bed assignment exist, Atlas creates one canonical preparation task per assignment.

The task:

- is linked to the exact growing object;
- is linked to the production lot;
- is due by the calculated preparation deadline;
- explains the transplant date and required bed-feet;
- is assigned to Anna through her active membership when available;
- appears through the existing worker task system.

Releasing a bed assignment closes the preparation task through `record_task_transition_v1_internal(..., 'changed_plan', ...)`, preserving transition and outcome history.

## Rollback validation

The Owner mutation functions were tested under Lex's real authenticated Owner claim inside rollback transactions.

The first test proved:

- four planning answers recalculated Potomac Succession 3 to 50 bed-feet;
- a 30-foot partial assignment was accepted;
- one linked preparation task was created;
- the snapshot immediately returned the assignment and task.

The reconciliation test proved:

- changing a 56-day grow-room duration to 40 days left six current automatic reservations and released the six obsolete windows;
- there was exactly one active reservation per requirement/pool pair;
- releasing a bed archived its task through the canonical changed-plan transition;
- changing viability after assigning 50 bed-feet reduced the requirement to 25 feet;
- the bed-placement question reopened with `1 over-assigned after recalculation`.

Every disposable answer, measurement, assignment, reservation, and task was rolled back.

## Live baseline after validation

The live Spring 2027 pilot still has:

- 13 open questions;
- 0 measurements;
- 0 bed assignments;
- 0 generated bed-preparation tasks;
- 0 active automatic capacity reservations.

The Owner must enter the real facts before Atlas schedules January capacity or winter bed work.

## Deferred work

Phase 3 does not yet:

- model individual tray identities;
- model shelves as separate physical objects;
- create bed release dates;
- establish harvest or clear windows;
- plan the rest of the January crop portfolio;
- create harvest lots, products, or sales.

Those remain later production-spine phases after the Snapdragon readiness path is accepted.
