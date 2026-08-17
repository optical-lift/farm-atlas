# Harvest Commercial Production Readiness — August 15, 2026

**Status:** Harvest Pass 5 + commercial correction layer are LIVE on `noel-core`; Pass 6 reconciliation is branch-complete and not yet live.  
**Branch:** `agent/harvest-truth-contract-pass1`

## Current production position

Live Supabase migration history now contains the complete Pass 5 commercial slice:

1. `20260815214911 harvest_flower_commercial_truth_v1`
2. `20260815214919 harvest_flower_commercial_owner_context_hardening_v1`
3. `20260815214928 harvest_flower_sale_buyer_options_v1`
4. `20260815214937 harvest_flower_commercial_truth_rpc_registry_v1`
5. `20260815214948 harvest_flower_commercial_reversals_v1`
6. `20260815214958 harvest_flower_fulfillment_required_lane_v1`
7. `20260815215008 harvest_flower_commercial_reversals_rpc_registry_v1`

The commercial schema is therefore live. At the current verification point, the new flower commercial ledgers still contain **zero real Harvest/Ready/sale/fulfillment rows**. No rollback-proof fixture data persisted.

## Commercial cutover rule

The cutover audit found no hidden canonical flower sale/order/fulfillment ledger. Existing sales-like paths are buyer outreach, community event registration/payment, and task instructions/metadata for Friday Flowers, market Sales Data Entry, and Thursday event capture.

- buyer outreach remains relationship truth;
- event registration/payment remains program-commerce truth;
- existing tasks remain work/provenance and historical evidence;
- task-local `starting_inventory`, available → claimed → remaining state, `submission_owns_sales_record: true`, estimated sales stored only in task metadata, and task-local total revenue are deprecated as current flower commercial truth;
- structured flower sales use the Ready-lot commercial ledger;
- incomplete historical task evidence is not silently backfilled into invented canonical sale/revenue history.

## Append-only correction contract

Live Pass 5 now preserves correction facts without rewriting history:

- unfulfilled sale cancellation appends `flower_sale_order_cancellation_events` and releases the Ready claim by projection;
- spoilage, donation, and write-off append `flower_ready_inventory_disposition_events` and remove otherwise Available inventory by projection;
- original sale/order-line and Ready birth rows remain immutable;
- fulfilled orders cannot use the claim-release cancellation path;
- Farm Hand may cancel only a sale they recorded and may record physical spoilage; donation/write-off require management authority;
- sale v2 takes deterministic `FOR UPDATE` locks on Ready lots and validates availability after locking.

## Fulfillment timing correction

The original rollback proof exposed that scheduled flower fulfillment inherited generic `discretionary / floating` planned-work defaults. That could suppress a customer-committed pickup/delivery on its promised date.

The live correction now forces flower-sale-derived occurrences to:

- `work_lane = required`;
- `commitment_kind = hard_date`;
- remain unreleased before the promised date because their release horizon remains zero.

## Production-shaped Pass 5 proof

The rollback proof exercised the exact staged commercial migrations against live `noel-core` before persistence and proved:

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
12. due fulfillment releasing into Worker Day through the required/hard-date lane;
13. actual handoff creating a fulfillment fact and canonically completing the fulfillment task;
14. cancellation-after-fulfillment rejection;
15. authenticated read-only table privileges and scoped write-RPC membrane;
16. zero Harvest-commercial RPC registry drift;
17. no new global registry drift rows relative to the pre-migration live baseline.

## Registry baseline

Live `noel-core` still has 127 pre-existing global authenticated-RPC registry drift rows unrelated to this Harvest slice:

- 61 `unregistered_authenticated`;
- 45 `anonymous_execute`;
- 16 `missing_expected_authenticated`;
- 5 `service_execute_mismatch`.

Current Harvest-commercial registry drift remains zero.

## Concurrency boundary

A true second PostgreSQL session cannot observe DDL that is still uncommitted inside the rollback transaction, so the rollback transaction cannot honestly represent a two-session race against newly staged tables.

Coverage therefore consists of:

- deterministic Ready-row locking (`ORDER BY ready.id FOR UPDATE`) in source; and
- runtime sequential overclaim rejection after the first claim.

## Next gate

Pass 5 is no longer the deployment blocker. The active remaining Harvest milestone is **Pass 6 — Reconciliation**:

`Harvest actual → preparation → Ready retail value → buyer claim → fulfillment → realized commercial result → Production evidence`

See `docs/HARVEST_RECONCILIATION_PRODUCTION_READINESS.md` for the staged Pass 6 contract and proof.
