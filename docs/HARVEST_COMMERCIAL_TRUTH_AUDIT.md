# Harvest Commercial Truth Audit — Ready through Fulfilled

Status: Harvest Pass 5 governing primitive map

## Purpose

This audit answers one question before adding commercial schema: **what Atlas already knows about buyers, outreach, event registrations, sales, delivery, and fulfillment, and which existing primitives must be reused rather than rebuilt?**

The governing Harvest chain remains:

`field truth → harvest obligation → physical harvest → completed preparation → Ready inventory → commercial commitment → fulfillment obligation → actual handoff → commercial result → production evidence`

Ready inventory is a birth fact. Commercial work may claim or consume that inventory, but it must not rewrite the Ready birth record.

## Live primitive audit

### KEEP — buyer relationship and outreach truth

- `atlas.buyer_relationship_reconstruction`
  - existing relationship/prospect reconstruction;
  - contains buyer identity, relationship state, priority, interests, preferences, and next-action context;
  - populated in production;
  - remains upstream relationship truth, not an order ledger.
- `atlas.buyer_contact_events`
  - append-only contact/outreach result truth;
  - can record quoted quantity, quoted weekly price, agreed start date, channel, offer, and follow-up;
  - remains evidence of a conversation, not proof that inventory was sold or handed off.
- `atlas.record_buyer_outreach_result_v1`
  - closes lawful buyer-outreach work and evolves relationship truth;
  - must not be promoted into the inventory-claim or fulfillment boundary.
- existing `buyer_outreach` / pipeline tasks
  - remain lawful work for relationship development.

### KEEP — community event and registration truth

- `atlas.community_events`
- `atlas.community_registration_offerings`
- `atlas.community_registrations`
- `atlas.community_registration_participants`
- `atlas.community_registration_payments`

These are valid public-program registration/payment primitives. They represent attendance/registration commerce for community events. They are **not** flower inventory claims and must not become the flower sales ledger merely because money can be attached to them.

### KEEP — Worker Day / obligation membrane

- `atlas.planned_work_occurrences`
- release policies and signal/release functions
- canonical task transition machinery
- Worker Day / farm Clock placement

A future pickup or delivery is operational work. The commercial commitment may create that obligation, but the sale itself does not place an exact hour in Clock.

### KEEP — Ready inventory birth truth

- `atlas.flower_ready_inventory_lots`

This remains immutable preparation output. Availability must be derived from Ready quantity minus lawful downstream claims. Do not add mutable `available`, `sold`, or `fulfilled` status columns to Ready rows.

## Do not misuse

### Buyer contact quantity/price is not a sale

A contact event can say a buyer discussed or agreed to quantity and price. That is relationship evidence. It does not reserve a specific Ready lot, establish inventory custody, create a delivery obligation, or prove fulfillment.

### Task metadata is not the sales ledger

Existing tasks contain market/event and buyer-commitment metadata, including a `sales_data_entry` task that explicitly expects structured canonical sales/event-result records. Task metadata may seed entry context, but it cannot remain the durable commercial record after structured truth exists.

### Registration payments are not flower sales

Community registration/payment records remain scoped to registration offerings. They must not be reused as a generic payment or flower inventory table.

### Production forecasts are not saleable inventory

Crop forecasts, harvest readiness, physical harvest buckets, and Ready products remain separate layers. A commercial commitment can only claim finished Ready inventory in this pass.

## Missing primitives confirmed by live audit

Production has no canonical flower order/sale table, no Ready-lot claim ledger, and no flower fulfillment ledger. There is also no existing sale/fulfillment RPC hidden under a different commercial name.

The smallest lawful addition is therefore:

1. **Flower sale order** — immutable commercial commitment header.
2. **Flower sale order line** — immutable claim against one specific Ready lot, preserving its product kind and unit.
3. **Flower fulfillment event** — immutable actual handoff of the committed order.
4. **Fulfillment work obligation** — only for non-immediate pickup/delivery, released through the existing planned-work membrane.
5. **Availability projection** — Ready birth quantity minus committed sale-line quantities; availability is derived, never written onto Ready inventory.

## Pass 5 boundary

### Available

`Available` means the unclaimed portion of a Ready birth lot. It is a projection:

`Ready quantity - committed sale-line quantity = currently available quantity`

No inferred expiry or spoilage is introduced in this pass. If a Ready lot physically becomes unusable, that requires a future explicit inventory-disposition truth rather than silently disappearing it.

### Sold / committed

A sale exists only after an explicit commercial write. Each sale line claims one specific Ready lot. The sale may optionally link to an existing buyer relationship, but buyer linkage is not required for walk-up market/event transactions.

### Going out

A committed order requiring later pickup or delivery is `Going out` until an actual fulfillment event exists. The commitment releases one lawful `flower_fulfillment` work obligation through existing planning/release machinery. Worker Day / farm Clock owns placement.

### Fulfilled

Fulfillment is a separate append-only fact: the committed order was actually handed off. A scheduled order is not fulfilled merely because its task exists or its due date passes.

Immediate market/event handoff may record sale + fulfillment atomically because commitment and physical handoff occur in the same real-world transaction.

## Deliberate v1 limits

- One sale line claims one Ready lot. A multi-product order may contain multiple lines.
- One successful fulfillment event completes the whole order; partial fulfillment is not modeled yet.
- Cancellation, return, refund, spoilage, donation, and other inventory-release/disposition flows are not modeled in Pass 5.
- Sale commitments are therefore irreversible in v1. This is intentional: releasing already-claimed inventory needs an explicit append-only reversal contract rather than a mutable order status shortcut.
- Payment settlement/accounting is not modeled here. The order captures commercial amounts; House Position / financial settlement is a different truth domain.

## Governing invariants

1. Raw harvest cannot be sold directly through this contract.
2. Preparation cannot be skipped to manufacture Ready inventory.
3. Ready birth rows remain append-only and unchanged.
4. A sale line cannot claim more than the Ready quantity still unclaimed.
5. Product kind and unit on a sale line must exactly match the claimed Ready lot.
6. Outreach does not imply sale.
7. Sale does not imply fulfillment.
8. A future fulfillment creates operational work, not Principal work.
9. Immediate handoff may create fulfillment in the same transaction, but it still creates a distinct fulfillment fact.
10. No sale, fulfillment, or availability truth may be reconstructed from task metadata once canonical commercial rows exist.
