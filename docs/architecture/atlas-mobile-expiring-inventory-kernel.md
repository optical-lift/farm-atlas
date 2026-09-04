# Atlas Mobile, Expiring Inventory Kernel

**Status:** Deferred architecture note. Record now; do not implement until the active Atlas build reaches the appropriate inventory/custody tranche.

## Why this exists

Elm exposed a general Atlas problem: inventory can exist in multiple places, move inside persistent containers, pass between custodians, change condition over time, expire, be sold or consumed, and be observed imperfectly. The current flower-specific tables hold parts of this truth, but Atlas needs a domain-general primitive underneath them.

The target is not an Elm-only flower inventory feature. It is a reusable Atlas kernel for any organization that has physical inventory moving through people, vehicles, containers, locations, routes, and time.

## Core reality model

Inventory is not inherently “Anna inventory” or “Katie inventory.” Inventory has identity and quantity. It may be inside a persistent physical container. That container is somewhere, may itself be inside a vehicle or location, and is under someone’s current custody.

Example:

`50 celosia -> Martha bucket -> Katie vehicle -> Katie custody`

If Anna hands Martha to Katie, Atlas should infer that the celosia moved with Martha. The user should not have to restate the contents.

The same grammar must work for other companies:

- filter cartridges -> Bin 4 -> Truck 7 -> technician
- desserts -> blue cooler -> delivery van -> caterer
- screws -> red organizer -> work truck -> foreman
- brochures -> black tote -> car -> missionary

## Required distinctions

Atlas must keep these facts separate:

1. **Identity** — what thing is this?
2. **Containment** — what is inside what?
3. **Location** — where is it physically?
4. **Custody** — who is currently responsible for it?
5. **Ownership** — who owns it?
6. **Quantity** — how much currently exists?
7. **Condition** — what state is it in?
8. **Channel eligibility** — where/how may it be sold or used?
9. **Time/expiry** — how does usefulness change with time?
10. **Pricing policy** — what price applies for this buyer, condition, channel, and commitment?

These may correlate, but Atlas must not collapse them into one field.

## Persistent physical identities

Containers, vehicles, shelves, coolers, bins, cases, rooms, racks, and other physical holders need durable identities.

Elm examples:

- Martha
- Dorothy
- Dolly
- Ginger
- Nancy
- Artista

Friendly labels may change. The underlying identity must not.

Eventually all Elm buckets may be named or numbered. If Martha moves, Atlas should move the contents by derivation rather than asking for a duplicate inventory statement.

## Event ledger, not editable totals

Current inventory must be a projection over events, not a manually overwritten quantity.

Event families should include:

- produced / harvested / received
- placed into container
- removed from container
- split
- merged
- transferred between custodians
- moved between locations
- loaded onto route
- reserved
- sold
- consumed internally
- returned
- discarded
- spoiled / expired
- damaged
- counted / observed
- corrected / reconciled
- condition changed

If expected quantity and observed quantity disagree, Atlas must preserve both and surface the discrepancy rather than silently rewriting history.

Example:

Expected Martha = 30 celosia.
Human observation = 27 celosia.
Atlas position = expected 30, observed 27, discrepancy -3, reconciliation unresolved until explained or accepted.

## Observation versus domain truth

Natural-language reports are observations first.

“Anna gave Martha to Katie” should become a custody/containment movement observation against the known Martha identity.

“Katie says Martha has 22 celosia” should become a quantity observation against Martha’s current contents.

If Atlas cannot safely resolve which container, lot, quantity exactness, or movement occurred, it must preserve the observation and route the ambiguity to unresolved reality rather than inventing the connection.

## Perishability and condition

Inventory lots need time-sensitive state, including where relevant:

- created / harvested / received at
- ready at
- best-before / expiry expectation
- current condition
- last condition observation
- sellability state
- allowed channels
- disposal threshold

Elm example:

Sunflower condition may progress:

`closed -> opening -> open -> over-open -> unsellable`

Condition may change market eligibility and price.

Micro Teddy sunflowers are valid inventory but are currently **not florist-wholesale inventory**; they are intended primarily for small bouquet production.

## Pricing policy

Price is not merely a property of the item. Atlas needs a pricing resolution stack that can account for dynamic buyer pricing.

Recommended precedence:

1. exact committed/quoted price
2. buyer-specific agreement
3. buyer-specific dynamic pricing policy
4. condition/channel pricing rule
5. standard price book
6. unresolved / quote required

Elm sunflower rule currently established:

- open pollenless or Teddy sunflowers: **$5 per 5 stems**
- closed pollenless or Teddy sunflowers: **$7.50 per 5 stems**

Buyer-specific dynamic pricing can override standard pricing where the buyer relationship says it should.

Atlas must never manufacture a price when no valid rule resolves it.

## Routes carry inventory

A route is not only a destination list. A route may carry inventory.

A route should know:

- custodian
- starting location
- containers aboard
- inventory inside those containers
- reservations / committed orders
- sales and transfers during the route
- ending position
- unresolved discrepancies

Elm currently has two operational sales lanes:

- **Anna availability / local sales route** — inventory physically at Elm / under Anna-local custody for Marshfield, Strafford, and nearby selling.
- **Katie availability / Springfield sales route** — inventory in Katie custody in Springfield for her sales rounds.

These are not separate copies of Elm inventory. They are derived positions from custody, containment, and location.

A handoff from Anna to Katie should move custody of the container and therefore move the contained inventory without duplicating it.

## Proposed general schema direction

Names are provisional; preserve the concepts even if implementation naming changes.

- `inventory_products` — what kind of thing it is
- `inventory_lots` — a particular batch/quantity with origin and time
- `inventory_containers` — persistent physical holders
- `inventory_containment_events` — what entered/left which holder
- `inventory_custody_events` — who gained/lost responsibility
- `inventory_location_events` — physical movement
- `inventory_quantity_events` — sold, consumed, lost, discarded, adjusted
- `inventory_condition_events` — condition/state transitions
- `inventory_observations` — human reports preserved as observations
- `inventory_pricing_policies` — standard, buyer, dynamic, condition and channel rules
- `inventory_channel_rules` — permitted selling/use channels
- `inventory_expiry_policies` — time and degradation behavior
- `inventory_reconciliation_cases` — expected versus observed mismatch
- `inventory_position_v1` — derived answer to what exists, where, under whose custody, in what state, right now

Existing flower tables should remain specialized production machinery where appropriate. Once something becomes usable stock, it should project into this general inventory/custody layer rather than requiring flower-only movement semantics.

## Required receiving behavior

Atlas should be able to receive ordinary operating language and map it into this model.

Examples:

- “Anna has 25 goldenrod at Elm.” -> observation of current Anna/local position.
- “Katie has 50 celosia in Martha.” -> observation binding inventory to known container and Katie custody.
- “Anna gave Martha to Katie.” -> custody/location movement of container; contents move by derivation.
- “Katie sold 20 celosia.” -> quantity disposition against Katie’s current celosia position.
- “Martha only has 27 left.” -> count observation; compare to expected position and open discrepancy if needed.
- “Katie has what’s left after today.” -> replacement snapshot observation, not additive inventory.

## Non-negotiable principles

- Containers are not contents.
- Custody is not ownership.
- Custody is not location.
- Current quantity is a derived position, not the only stored truth.
- Human observations are preserved even when they conflict with the current projection.
- Moving a parent container moves its contents by derivation unless evidence says otherwise.
- Inventory may be valid but ineligible for a particular channel.
- Perishable inventory carries time and condition.
- Pricing is resolved from policy and relationship context, including dynamic buyer pricing.
- Unresolved identity, quantity, movement, pricing, or condition is surfaced rather than guessed.

## Build trigger

Implement when Atlas reaches the tranche where mobile inventory, route custody, fulfillment, expiring stock, or cross-location stock position becomes a release requirement. Until then this document is the frozen architecture note for the problem and should be used to prevent flower-specific patches from hardening into the permanent model.
