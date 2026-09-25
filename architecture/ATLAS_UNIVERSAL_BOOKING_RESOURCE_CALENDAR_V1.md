# Atlas Universal Booking / Resource Calendar V1

Status: production schema live; Elm Farm Venue is the first adopter.

## Purpose

Atlas needs one booking and calendar architecture that works for many kinds of institutions, not a venue-specific or farm-specific reservation system.

The same core must support examples such as:

- a venue reserving an event center, grounds, parking zone, or whole property;
- a dental office reserving an operatory;
- a university reserving a classroom or lab;
- a construction company reserving equipment, a vehicle, or a work zone;
- a clinic reserving rooms or capacity;
- a company reserving desks, conference rooms, or appointment capacity.

No core table in this tranche is keyed by `farm_id`, venue type, or Elm-specific terminology.

## Core invariant

**Reality owns resources. Occurrences consume resources. Ledgers establish bookings and claims around occurrences. Commercial systems hold money. Calendar projections assemble the current operational picture.**

A resource is not owned by a Ledger. It belongs to the real-world Entity.

A booking does not own payment truth. It may reference a commercial order/payment, Stripe object, Amelia reservation, or another system through typed references.

A calendar does not infer occupancy from prose. Occupancy is represented as explicit time-bounded resource claims.

## Canonical layers

### `reality.resources`

Universal resources owned by a canonical Reality Entity.

A resource may be a:

- site;
- building;
- room;
- zone;
- equipment item;
- vehicle;
- capacity pool;
- or another reservable institutional thing.

Resources may be hierarchical through `parent_resource_id`.

This matters because hierarchy participates in availability:

- an exclusive whole-site claim blocks its rooms/zones;
- a room claim makes an exclusive whole-site request unavailable;
- sibling rooms/zones can coexist.

Capacity modes:

- `exclusive`
- `shared`
- `quantity`

Quantity capacity is numeric and unit-governed.

### `ledger.occurrence_calendar_bindings`

Ledger-native calendar membership for canonical occurrences.

An occurrence can belong on a Ledger calendar before:

- a customer is known;
- a booking exists;
- an exact room/zone/resource is classified;
- an end time is known.

This prevents incomplete operational truth from disappearing from the calendar.

Bookings and active resource claims automatically establish calendar membership.

### `ledger.bookings`

Current booking commitments associated with a canonical occurrence.

Booking state:

- `hold`
- `confirmed`
- `cancelled`
- `completed`
- `no_show`

A booking may have a customer Reality Entity, business-model key, label, and Ledger Seat author.

### `ledger.booking_events`

Append-only booking history.

Current booking state is mutable through governed transition services; event history is not.

### `ledger.booking_references`

Typed references from a booking to external or compatibility systems.

Examples:

- Atlas commercial order;
- Atlas commercial payment;
- Stripe payment;
- invoice;
- Amelia reservation;
- external scheduler object.

The booking core therefore does not depend on any particular payment or scheduling provider.

### `ledger.occurrence_resource_claims`

Time-bounded occupancy claims.

A claim says:

- which Ledger;
- which canonical occurrence;
- optional booking;
- which Reality resource;
- start/end of occupancy;
- exclusive/shared/capacity mode;
- quantity where relevant;
- claim state;
- provenance.

Claims may extend beyond the visible occurrence window when setup/teardown or other lawful occupancy requires it.

## Conflict / availability semantics

Availability considers the requested resource plus its ancestors and descendants.

An overlap blocks when:

1. the requested claim is exclusive; or
2. an existing related claim is exclusive; or
3. a quantity-governed resource would exceed capacity.

Sibling resources do not conflict merely because they share a parent.

This supports deterministic answers such as:

- Is Room 2 free?
- Is the entire facility free?
- Can two outdoor programs coexist?
- Does reserving the whole building block its conference rooms?
- Are four more seats available?
- Is a vehicle/equipment pool over capacity?

## Service contracts

Internal governed services:

- `reality.upsert_resource_service_v1`
- `ledger.bind_occurrence_to_calendar_service_v1`
- `ledger.establish_booking_service_v1`
- `ledger.transition_booking_state_service_v1`
- `ledger.add_booking_reference_service_v1`
- `ledger.establish_occurrence_resource_claim_service_v1`
- `ledger.resource_claim_availability_v1`
- `atlas.ledger_resources_service_v1`
- `atlas.ledger_resource_calendar_service_v1`
- `atlas.ledger_resource_availability_service_v1`

Authenticated membrane:

- `atlas.ledger_resources_self_api_v1`
- `atlas.ledger_resource_calendar_self_api_v1`
- `atlas.ledger_resource_availability_self_api_v1`
- `atlas.upsert_ledger_resource_self_api_v1`
- `atlas.establish_ledger_booking_self_api_v1`
- `atlas.transition_ledger_booking_self_api_v1`
- `atlas.establish_ledger_resource_claim_self_api_v1`
- `atlas.bind_occurrence_to_ledger_calendar_self_api_v1`

Authenticated access resolves Auth -> canonical Person and requires:

`institutional_schedule_operations`

scoped to the Ledger subject Entity and specific Ledger ID.

Write APIs additionally use the Person's active Ledger Seat where authorship is required.

Conflict override is intentionally not exposed through the authenticated resource-claim API.

## Security boundary

New tables are RLS-enabled and have no direct `anon` or `authenticated` table grants.

The direct service functions are not executable by public/anon/authenticated.

Authenticated callers use responsibility-gated self APIs.

This preserves the existing Atlas pattern: direct storage stays sealed while lawful operations are exposed through governed functions.

## Elm Farm Venue first adopter

Subject Entity: Elm Farm.

Resources established:

- Elm Farm Site
  - Event Center
  - Grounds

Elm Farm Site is a parent resource. Event Center and Grounds are sibling resources.

### Oct. 6 proof

John Gray private rental:

- 6:00-8:00 p.m.
- Event Center
- exclusive
- confirmed booking
- linked to existing commercial order/payment references

Elm Family Ultimate:

- 6:00-7:30 p.m.
- Grounds
- exclusive for that occurrence

Result:

- Event Center 6:00-8:00 -> unavailable
- Grounds 6:00-7:30 -> unavailable
- Grounds 7:30-8:00 -> available
- whole-site exclusive request 6:00-8:00 -> unavailable
- John rental vs Family Ultimate -> no conflict because they occupy sibling resources

The Venue calendar projection includes the current commercial snapshot for John's booking without moving payment truth into the booking core.

## Existing Elm occurrence bootstrap

Known future Elm occurrences were bound to the Venue Ledger calendar.

Where the exact room/zone is not yet established and an end time exists, the occurrence currently carries a conservative shared claim on the Elm Farm Site root with:

`classificationState = unclassified_resource`

This is intentionally not a guess about room/zone.

A future exclusive request can therefore see that the property has unresolved occupancy rather than silently double-booking.

Occurrences may also be calendar-bound without resource claims. For example, a scheduled workshop with an established start but no end/resource remains visible with:

`occupancyState = unclassified`

## Quantity-capacity validation

A transaction-only validation created a generic capacity-10 resource.

With 6 units occupied:

- request for 4 more -> available;
- request for 5 more -> unavailable / capacity exceeded.

The validation transaction was rolled back.

This proves the architecture is not limited to rooms or physical venue spaces.

## Production migrations

- `20260925215931_atlas_universal_booking_resource_calendar_v1`
- `20260925220232_atlas_universal_booking_calendar_access_v1`
- `20260925220342_atlas_universal_booking_calendar_fk_indexes_v1`
- `atlas_universal_booking_calendar_write_membrane_v1`
- `atlas_universal_ledger_occurrence_calendar_binding_v1`

The final two migration versions should be read from Supabase migration history when repository migration files are reconciled.

## Important non-goals / compatibility boundaries

- Do not use `atlas.day_reservations` as the new booking core. It is legacy farm/member-specific architecture.
- Do not make new booking/resource logic depend on legacy `atlas.organizations` authority.
- Do not store payment state as authoritative booking state.
- Do not create company-specific tables such as `elm_venue_bookings`.
- Do not infer room/zone occupancy from title text when the resource is unknown.
- Do not force every calendar occurrence to have a customer or commercial transaction.
- Do not force a physical space to become a Reality Entity kind; V1 resources are Reality-owned resources beneath canonical Entities.

## Next implementation layer

The UI can now be built as a projection over this core.

A generic calendar/workbench should be able to:

- show day/week/month views;
- group by resource lanes;
- show bookings and non-commercial occurrences together;
- distinguish confirmed / hold / unclassified / conflict;
- show payment snapshot when a booking has commercial references;
- ask availability before establishing a claim;
- classify an unclassified occurrence into a room/zone/resource;
- create resources without domain-specific vocabulary;
- create bookings for people, businesses, organizations, or internal use;
- reserve an entire parent resource or one of its descendants.

No Elm-specific logic is required for those behaviors.
