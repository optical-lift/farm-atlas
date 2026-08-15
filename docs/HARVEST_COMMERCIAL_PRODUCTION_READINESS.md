# Harvest Commercial Production Readiness — August 15, 2026

**Status:** Pre-production prerequisites completed on branch; Pass 5 + reversals are still NOT live.  
**Branch:** `agent/harvest-truth-contract-pass1`

## Prerequisite 1 — Commercial cutover audit

Completed in `docs/HARVEST_COMMERCIAL_CUTOVER_AUDIT.md`.

The audit found no hidden canonical flower sale/order/fulfillment ledger. Existing sales-like paths are buyer outreach, community event registration/payment, and task instructions/metadata for Friday Flowers, market Sales Data Entry, and Thursday event capture.

Cutover rule:

- buyer outreach remains relationship truth;
- event registration/payment remains program-commerce truth;
- existing tasks remain work/provenance and historical evidence;
- `starting_inventory`, task-local available → claimed → remaining state, `submission_owns_sales_record: true`, estimated sales stored only in task metadata, and task-local total revenue are deprecated as current flower commercial truth;
- structured flower sales must use the Ready-lot commercial ledger;
- incomplete historical task evidence is not silently backfilled into invented canonical sale/revenue history.

## Prerequisite 2 — Append-only reversal and disposition contract

Completed on branch.

Added staged migrations:

- `20260815143200_harvest_flower_commercial_reversals_v1.sql`
- `20260815143250_harvest_flower_fulfillment_required_lane_v1.sql`
- `20260815143300_harvest_flower_commercial_reversals_rpc_registry_v1.sql`

Canonical correction truth:

- unfulfilled sale cancellation appends `flower_sale_order_cancellation_events` and releases the Ready claim by projection;
- spoilage, donation, and write-off append `flower_ready_inventory_disposition_events` and remove otherwise Available inventory by projection;
- original sale/order-line and Ready birth rows remain immutable;
- fulfilled orders cannot use the claim-release cancellation path;
- Farm Hand may cancel only a sale they recorded and may record physical spoilage; donation/write-off require management authority;
- sale v2 takes deterministic `FOR UPDATE` locks on Ready lots and validates availability after locking;
- existing signed-in sale API signatures remain stable while delegating to the cancellation/disposition-aware core.

### Defect found by rollback proof

The first production-shaped proof found that scheduled flower fulfillment inherited the generic planned-work default `discretionary / floating`. That allowed a customer-committed pickup/delivery to be suppressed by discretionary daily capacity on its due date.

This was corrected before production with `20260815143250_harvest_flower_fulfillment_required_lane_v1.sql`:

- flower-sale-derived occurrences are `work_lane = required`;
- `commitment_kind = hard_date`;
- future work still does not release before its promised date because the release horizon remains zero.

## Prerequisite 3 — Rollback-only production-shaped proof

Completed against live `noel-core` without persisting Pass 5 schema or synthetic data.

The harness used PostgreSQL `http_get` inside one transaction to fetch the exact raw migration files from immutable GitHub commit `c017a5207fcabfe99e54c3ea42301d6eb2d361cf`, execute them in order, execute `supabase/tests/harvest_flower_commercial_rollback_proof_v1.sql`, compare RPC registry drift to the pre-migration baseline, and then `ROLLBACK`.

The proof exercised:

1. lawful Harvest → Prepare → Ready fixture lineage;
2. Ready birth of 10 bouquets;
3. scheduled sale claim reducing Available 10 → 6;
4. sequential overclaim rejection after the same Ready-lock/availability boundary used by concurrent callers;
5. cancellation preserving the original sale while restoring Available 6 → 10;
6. spoilage reducing Available 10 → 8 without changing Ready birth quantity;
7. Farm Hand donation rejection;
8. over-disposition rejection;
9. wrong-farm membership rejection;
10. second scheduled sale reducing Available 8 → 3;
11. future fulfillment staying unreleased before its due date;
12. due fulfillment releasing into Worker Day after the required/hard-date correction;
13. actual handoff creating a fulfillment fact and canonically completing the fulfillment task;
14. cancellation-after-fulfillment rejection;
15. authenticated read-only table privileges and scoped write-RPC membrane;
16. zero Harvest-commercial RPC registry drift;
17. no new global registry drift rows relative to the pre-migration live baseline.

After `ROLLBACK`, the verification confirmed:

- `atlas.flower_sale_orders` absent;
- `atlas.flower_sale_order_cancellation_events` absent;
- `atlas.flower_ready_inventory_disposition_events` absent;
- `atlas.record_flower_sale_core_v2(...)` absent;
- live global registry drift returned to its pre-test count of 127.

## Registry baseline note

The live project currently has 127 pre-existing global authenticated-RPC registry drift rows unrelated to this Harvest slice:

- 61 `unregistered_authenticated`;
- 45 `anonymous_execute`;
- 16 `missing_expected_authenticated`;
- 5 `service_execute_mismatch`.

This is existing Atlas/Supabase backlog. The Harvest proof does not hide or normalize it. It proves the staged Harvest commercial migrations add zero Harvest-specific drift and zero new drift rows over that baseline.

## Concurrency proof limitation

A true second PostgreSQL session cannot observe DDL that is still uncommitted inside the rollback transaction, so the same transaction cannot honestly run a two-session race against newly staged tables.

The proof therefore uses both:

- source-level deterministic Ready-row locking (`ORDER BY ready.id FOR UPDATE`) to serialize concurrent claims; and
- runtime sequential overclaim rejection after the first claim.

A true two-session concurrency race can be run later on an isolated Supabase database branch if desired, but it is not represented here as having happened.

## Production status

**Pass 5 and the reversal/disposition migrations remain unapplied to live `noel-core`.**

No synthetic sale, cancellation, disposition, Ready inventory, fulfillment task, or fulfillment event from this proof remains in production.
