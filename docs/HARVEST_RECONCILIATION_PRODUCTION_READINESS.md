# Harvest Reconciliation Production Readiness — August 15, 2026

**Status:** Pass 6 reconciliation is branch-complete, production-shaped rollback proof is green, and the migration is NOT yet live.  
**Branch:** `agent/harvest-truth-contract-pass1`  
**Migration:** `20260815144000_harvest_flower_reconciliation_v1.sql`

## Purpose

Pass 6 closes the Harvest truth chain without introducing a second mutable commercial summary system:

`physical Harvest actual → preparation → Ready inventory → preserved retail value → active buyer claim → fulfillment → realized commercial result → Production evidence`

Harvest still does not schedule worker time and does not determine Principal priority.

## Missing truth corrected by this pass

Ready inventory previously preserved physical birth quantity but not the retail value of that prepared product. That made the governing sell-through definition impossible to calculate honestly for unsold Ready inventory.

Pass 6 adds an append-only dated `flower_product_price_book` and snapshots the applicable retail value onto each Ready birth row at insert time.

Initial Elm governing product values effective August 15, 2026:

- Posy — $10
- Bouquet — $25
- Lobby Arrangement — $15

Conditioned buckets and counted stems remain intentionally unpriced until a governing price exists. If any Ready lot lacks preserved valuation, sell-through is withheld rather than estimated.

## Derived reconciliation truth

The migration creates derived views over immutable/append-only facts:

### `flower_ready_inventory_position_v1`

For every Ready lot it derives:

- birth quantity;
- active claimed quantity, excluding cancelled sales;
- fulfilled quantity;
- disposed quantity;
- currently available quantity;
- prepared catalog retail value;
- active claimed catalog value;
- fulfilled catalog value;
- disposed catalog value;
- active committed product revenue;
- realized product revenue.

### `flower_commercial_farm_score_v1`

For each farm it derives:

- prepared retail value;
- claimed retail value;
- disposed retail value;
- sell-through percentage;
- active, fulfilled and cancelled order counts;
- committed revenue;
- realized revenue;
- realized total receipts.

**Sell-through** is claimed catalog-valued Ready output divided by prepared catalog-valued Ready output.

**Realized revenue** requires actual fulfillment. A sale record alone is a commitment, not realized commercial result.

### Production evidence

`flower_preparation_commercial_evidence_v1` and `flower_harvest_production_evidence_v1` preserve the downstream evidence available to Production without inventing attribution.

Explicit states include:

- `unlinked`;
- `partial_linkage`;
- `direct_single_production_lot`;
- `mixed_production_lots`;
- `direct_single_observation`;
- `mixed_batch_unallocated`.

When a preparation batch combines multiple crop observations, Atlas does not manufacture a per-crop revenue allocation.

## Production-shaped rollback proof

The exact migration plus `supabase/tests/harvest_flower_reconciliation_rollback_proof_v1.sql` were executed in one transaction against live `noel-core` and rolled back.

Synthetic specimen:

1. one bucket-equivalent Harvest observation;
2. one preparation batch;
3. Ready birth of 10 bouquets;
4. Ready retail snapshot = $25 per bouquet / $250 prepared retail value;
5. sale A: 4 bouquets at $20 each with immediate handoff;
6. sale B: 3 bouquets at $25 each with scheduled pickup.

Initial derived result:

- prepared retail value: $250;
- claimed retail value: $175;
- sell-through: 70.0%;
- committed revenue: $155;
- realized revenue: $80;
- realized product revenue: $80.

Then sale B was cancelled and 2 bouquets were recorded as spoilage.

Corrected derived result:

- active claimed quantity: 4;
- fulfilled quantity: 4;
- disposed quantity: 2;
- available quantity: 4;
- sell-through: 40.0%;
- committed revenue: $80;
- realized revenue: $80;
- disposed catalog value: $50.

The specimen crop cycle has no current Elm `production_lot_crop_cycles` link, so Production evidence correctly reported `unlinked` rather than fabricating lineage. Its one-observation preparation conversion remained directly attributable to the Harvest observation.

## Rollback cleanliness

After rollback verification:

- `atlas.flower_product_price_book` was absent;
- reconciliation views were absent;
- live Harvest batches remained 0;
- live Ready lots remained 0;
- live flower sale orders remained 0;
- live migration history remained at the Pass 5 production boundary.

No synthetic reconciliation facts persisted.

## Security boundary

The Pass 6 migration was staged successfully in a live transaction with:

- RLS on the price book;
- authenticated member read only;
- no authenticated direct mutation grant;
- append-only price history;
- `security_invoker=true` on authenticated-facing derived views;
- Production evidence views restricted to `service_role`;
- no new Principal tables or Principal scheduling paths.

The current Supabase security advisor findings are pre-existing project-level items: leaked-password protection disabled, an available Postgres security update, and the `http` extension in the public schema. None originates in this reconciliation migration.

Harvest-specific authenticated RPC registry drift remains zero. The project-wide pre-existing registry backlog remains 127 rows.

## Source verification

Current Pass 6 branch head has passed Atlas CI, including architecture, source/unit, and production-build gates.

## Production deployment gate

Pass 6 may be applied as an additive production migration after the release checks above remain green.

After application verify:

1. exactly three initial Elm price rows exist;
2. Ready/sale/fulfillment ledgers still contain no synthetic data;
3. Elm commercial score begins at zero Ready lots and no sell-through percentage;
4. authenticated clients can read permitted score/price truth but cannot mutate price history directly;
5. Harvest-specific registry drift remains zero;
6. Supabase advisors show no reconciliation-introduced regression.

## Milestone completion boundary

Applying Pass 6 completes the **infrastructure and derived truth contract**, but does not by itself prove the milestone with real farm behavior.

Harvest Milestone 1 should be called fully accepted only after the first genuine Elm production specimen traverses:

`real harvest → real preparation → real Ready inventory → real sale/claim → real fulfillment`

and the resulting commercial score and Production evidence reconcile truthfully.
