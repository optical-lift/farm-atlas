# Harvest Commercial Cutover Audit — Existing Sales and Revenue Paths

**Status:** Governing cutover map before Harvest commercial production migration  
**Date:** 2026-08-15  
**Scope:** Existing Atlas paths that currently describe flower claims, market/event sales, buyer outreach, inventory reconciliation, or revenue.

## 1. Purpose

Pass 5 introduces the first canonical flower commercial ledger. Before that ledger can become production truth, every existing sales-like path must be assigned one lawful role so Atlas does not immediately regain split truth.

The governing commercial chain is:

`Ready birth truth → Available projection → explicit sale/claim → Going out → actual fulfillment`

Existing tasks may request or guide commercial work. They may preserve historical evidence. They may not remain a second inventory, sale, or fulfillment ledger after the canonical commercial objects exist.

## 2. Live paths found in production

The live audit found no hidden canonical flower order or fulfillment system. The relevant existing paths are task instructions/metadata, buyer relationship events, and community registration/payment records.

### Existing Friday Flowers work

Production contains tasks such as:

- **Manage Friday bouquet claims** — currently carries `starting_inventory: 6`, `unit_price: 10`, and instructions to move a mental/task-local count from available → claimed → remaining.
- **Reconcile Friday Flowers inventory at noon** — currently asks the worker to mark claimed quantity sold/reserved and decide what remains saleable.
- **Review Friday Lobby Route results** — buyer relationship/revenue-follow-up work with a quoted weekly offer.

These are real operational workflows, but the mutable inventory/count state inside their metadata is not durable commercial truth.

### Existing market Sales Data Entry work

Production contains standard `sales_data_entry` tasks for Ozark, Rogersville, and Fair Grove. Their metadata states `submission_owns_sales_record: true` and asks the worker to count leftovers and record estimated sales by product/crop before clocking out.

The task remains useful as the obligation to reconcile the market. Its submission may no longer own a separate sales record once structured flower sale rows exist.

### Existing Thursday event capture

Production contains **Capture Thursday night sales + attendance** with a task-local `market_sales_capture_v1` contract requesting tickets, ticket revenue, door guests, bouquets sold/revenue, other add-on revenue, and total revenue.

No live database function/table named `market_sales_capture_v1` exists. The contract is metadata describing what the task expects.

Flower-product sales must cut over to the canonical flower sale ledger. Ticket/attendance/program-registration truth remains in the community event/registration domain.

### Existing Aug. 13 flower-bar result

A completed production task records the historical fact `bouquets_sold: 2`. That is useful historical evidence. It does not establish which Ready lots were consumed or a defensible price/revenue amount, so the commercial cutover must not silently invent a canonical sale or revenue backfill from it.

## 3. KEEP

### Buyer relationship and outreach

Keep:

- `atlas.buyer_relationship_reconstruction`
- `atlas.buyer_contact_events`
- `atlas.record_buyer_outreach_result_v1`
- buyer-outreach and pipeline work

These own relationship truth: who was contacted, what was offered or discussed, quoted quantity/price, response, next action, and relationship state.

**Invariant:** quoted quantity or price is not a Ready claim, sale, or fulfillment fact.

### Community event registration/payment

Keep:

- `atlas.community_events`
- `atlas.community_registration_offerings`
- `atlas.community_registrations`
- `atlas.community_registration_participants`
- `atlas.community_registration_payments`

These remain valid admissions/program-commerce truth. They do not consume flower Ready inventory.

### Task system as commercial work/provenance

Keep the existing task engine for work such as:

- record/reconcile market sales;
- contact a buyer;
- fulfill an order;
- review a route result.

A task can be `source_task_id` provenance for a canonical flower sale. It cannot itself be the commercial ledger.

### Historical task metadata

Keep old metadata as historical evidence. Do not rewrite or delete it merely because the canonical system changes.

Historical evidence is not automatically promoted into new canonical rows.

## 4. CUT OVER

### Friday bouquet claims

Old behavior:

`starting_inventory → claimed → remaining` inside task instructions/metadata.

New behavior:

`Ready birth quantity - active canonical sale claims - explicit dispositions = Available`

A claim becomes a real `flower_sale_order` + `flower_sale_order_line` against a specific Ready lot. Friday work may open or guide that write, but it does not own a second mutable count.

### Friday noon reconciliation

The reconciliation task remains useful as a human check. Its output must compare physical/commercial reality to the canonical ledger. It must not create an independent `remaining` number that Atlas later treats as inventory truth.

### Market Sales Data Entry

The `sales_data_entry` task remains the obligation to close out a market. Its flower sales submission must write canonical sale rows, normally with `sales_channel='market'`, event/source context, explicit Ready-lot claims, and immediate handoff when the sale already occurred at the market.

Deprecate the statement `submission_owns_sales_record: true` as architecture. The structured flower commercial ledger owns the sale record.

### Thursday event sales capture

Split the old task-local capture by domain:

- ticket/attendance/program-registration values remain event/registration truth;
- bouquet/flower-product sales write canonical flower sale rows;
- total event revenue may later be projected from its lawful component domains rather than copied into another hand-maintained total.

### Preparation sale hints

Preparation metadata such as suggested channel or price may remain execution context. It is not proof that anything was sold and must not reduce Available inventory.

## 5. DEPRECATE AS WRITABLE TRUTH

The following patterns must not survive as independent commercial state after cutover:

- `starting_inventory` as the saleable inventory source;
- task-local `inventory_state_model` such as available → claimed → remaining;
- `submission_owns_sales_record: true`;
- estimated sales stored only in task metadata as the canonical sale ledger;
- quoted buyer quantity/price treated as a sale;
- a task completion or due date treated as fulfillment;
- product quantity/price metadata treated as Ready consumption;
- a task-local `total_revenue_dollars` treated as authoritative when component domains can disagree.

## 6. Historical backfill rule

Do not manufacture structured commercial history from incomplete task evidence.

A historical result may be backfilled only when the evidence supports the required canonical fields. In particular:

- `2 bouquets sold` without defensible Ready-lot lineage is historical evidence, not an invented Ready consumption record;
- a known count without a known price does not justify inferred revenue;
- a known price/offer without actual sale evidence does not justify a sale;
- old inventory counts are not retroactively treated as Ready birth rows.

If historical reconciliation is later needed, it should use an explicit reconciliation/backfill workflow with evidence/confidence rather than silent migration inference.

## 7. Cutover invariants

1. There is exactly one structured flower sale ledger.
2. Ready birth truth is immutable.
3. Available is derived; it is never a task-local number promoted to inventory truth.
4. Buyer outreach does not imply sale.
5. Event registration payment does not imply flower sale.
6. Sales Data Entry is work; canonical sale rows are the result truth.
7. Sale does not imply fulfillment.
8. Historical task metadata remains evidence, not a second current ledger.
9. New commercial readers must not reconstruct flower sales from task metadata once structured records exist.
10. A future cancellation or physical disposition must be append-only and must change availability by projection, never by deleting or rewriting Ready/sale birth facts.

## 8. Required cutover implementation

Before Pass 5 can be applied to production:

1. add append-only sale cancellation and Ready disposition truth;
2. make Available subtract only **active** sale claims and explicit dispositions;
3. make new sales honor released claims after cancellation and already-removed quantities after disposition;
4. ensure cancelled future fulfillment work is retired through the canonical task/occurrence membrane;
5. add regression guards proving the commercial API does not read Friday/market task metadata as its inventory or sales source;
6. run the whole contract in a rollback-only production-shaped proof before persistent migration.
