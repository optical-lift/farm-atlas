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
- `ledger.resource_conflict_domain_v1`
- `ledger.lock_resource_conflict_domains_v1`
- `ledger.establish_booking_bundle_service_v1`
- `reality.subject_schedule_availability_v1`
- `ledger.evaluate_booking_policies_v1`
- `ledger.refresh_recurrence_instances_service_v1`
- `ledger.materialize_recurrence_instance_service_v1`
- `ledger.materialize_recurrence_range_service_v1`
- `ledger.recurrence_schedule_service_v1`

Authenticated membrane:

- `atlas.ledger_resources_self_api_v1`
- `atlas.ledger_resource_calendar_self_api_v1`
- `atlas.ledger_resource_availability_self_api_v1`
- `atlas.upsert_ledger_resource_self_api_v1`
- `atlas.establish_ledger_booking_self_api_v1`
- `atlas.transition_ledger_booking_self_api_v1`
- `atlas.establish_ledger_resource_claim_self_api_v1`
- `atlas.bind_occurrence_to_ledger_calendar_self_api_v1`
- `atlas.establish_ledger_booking_bundle_self_api_v1`
- `atlas.upsert_ledger_availability_profile_self_api_v1`
- `atlas.upsert_ledger_availability_rule_self_api_v1`
- `atlas.upsert_ledger_availability_exception_self_api_v1`
- `atlas.upsert_ledger_booking_policy_self_api_v1`
- `atlas.upsert_ledger_recurrence_series_self_api_v1`
- `atlas.set_ledger_recurrence_exception_self_api_v1`
- `atlas.refresh_ledger_recurrence_self_api_v1`
- `atlas.materialize_ledger_recurrence_range_self_api_v1`
- `atlas.ledger_recurrence_schedule_self_api_v1`

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

## Industry-hardening tranche

The first booking/resource cut established canonical resources, bookings, calendar membership, occupancy claims, and availability projection. The next production tranche hardens those primitives into a general scheduling-commitment kernel.

### Atomic resource commitment

Availability checks alone are not sufficient to prevent double booking under concurrency. Atlas now serializes active resource claims over the full conflict domain before the final availability check and write.

`ledger.resource_conflict_domain_v1` resolves:

- the requested resource;
- all ancestors;
- all descendants.

`ledger.lock_resource_conflict_domains_v1` takes transaction-scoped PostgreSQL advisory locks for the union of those domains in deterministic UUID order.

`ledger.establish_booking_bundle_service_v1` then establishes a booking and all requested resource claims as one transaction. Multi-resource commitments therefore succeed or fail as one unit.

Validation proved:

- sibling resources can be reserved together;
- an overlapping exclusive parent-resource reservation is rejected;
- the validation transaction rolls back without residue.

This is the concurrency boundary for rooms, zones, equipment, vehicles, and quantity-governed resources.

### Universal availability

Availability is modeled separately from occupancy.

`reality.availability_profiles` may belong to either:

- a canonical Reality Entity; or
- a canonical Reality resource.

This allows one scheduling grammar to represent business hours, provider availability, room availability, equipment availability, maintenance shutdowns, or other constraints.

`reality.availability_rules` express recurring local-time available/unavailable windows with an explicit timezone and effective date range.

`reality.availability_exceptions` express one-off openings or closures such as holidays, maintenance, or special hours.

The resource availability engine evaluates schedule availability across the same hierarchical conflict domain used for occupancy. A parent facility closure can therefore make a child room unavailable without duplicating the closure onto every child.

If no active availability profile exists, V1 preserves backward compatibility by treating the subject as schedule-open and continuing to rely on occupancy/resource state.

### Booking policies

`ledger.booking_policies` contains Ledger-scoped declarative booking rules rather than domain-specific application logic.

V1 policy kinds:

- `duration` — minimum/maximum visible booking duration;
- `booking_window` — minimum notice and maximum advance window;
- `start_increment` — permitted local-time start increments;
- `buffer` — setup and teardown occupancy buffers;
- `approval` — whether confirmation requires approval;
- `recurrence` — whether recurring booking is permitted.

`ledger.evaluate_booking_policies_v1` returns explicit blocking reason codes plus requirements.

The atomic booking-bundle service applies policy before commitment. Setup/teardown buffers expand resource occupancy rather than falsifying the visible customer appointment time. A booking whose policy requires approval cannot be directly established as confirmed.

Validation proved that a visible 10:00–11:30 booking with 15-minute setup and 30-minute teardown occupies its resource from 9:45–12:00.

### Ledger-native recurrence

The useful recurrence semantics from legacy `atlas.organization_recurrence_*` have been promoted into the Ledger/Reality kernel. New scheduling logic must not depend on legacy Organization membership.

New tables:

- `ledger.recurrence_series`
- `ledger.recurrence_exceptions`
- `ledger.recurrence_instances`

A series preserves local wall-clock intent plus timezone rather than reducing recurrence to UTC instants.

V1 frequencies:

- daily;
- weekly;
- monthly nth weekday.

Series support:

- interval;
- effective start/end;
- weekdays;
- month ordinals including last;
- all-day schedules;
- local start/end;
- active/paused/retired state;
- external UID;
- sequence;
- optional RRULE text;
- occurrence template payload.

Exceptions preserve the **source local date** and support:

- skip;
- override;
- move.

Instances distinguish the original source date from the realized local date and may remain expected/unmaterialized or become canonical `local_intel.occurrences`. Materialized instances are automatically bound to the Ledger calendar.

A DST validation proved that a weekly 9:00 a.m. `America/Chicago` series remains 9:00 local time as its UTC representation changes across daylight-saving time. Override and moved-instance semantics also materialized correctly.

The legacy `atlas.organization_recurrence_rules`, `organization_recurrence_exceptions`, and `organization_recurrence_instances` are now compatibility/history surfaces only for new architecture.

### Schedule responsibility

The existing Reality responsibility:

`institutional_schedule_operations`

now governs these additional operations:

- `availability.read`
- `availability.manage`
- `policy.read`
- `policy.manage`
- `recurrence.read`
- `recurrence.write`

alongside the earlier resource/calendar/booking operations.

## Elm Farm Venue first adopter

Subject Entity: Elm Farm.

Resources established:

- Elm Farm Site
  - Event Center
  - Grounds

Elm Farm Site is a parent resource. Event Center and Grounds are sibling resources.

### Recovered farm-atlas spatial model

The legacy `farm-atlas` Venue model was recovered into the universal resource kernel and then simplified to represent the things that are operationally meaningful to book.

Current hierarchy:

- Elm Farm Site
  - Event Center
    - Entry — non-reservable venue space
    - Lounge — reservable room
    - Library — reservable room
    - Coffee Bar — reservable station
    - Conference Room — reservable room; physical name **Living Room**; alias **Meeting Room**
    - Bathroom — reservable room
    - Studio — reservable room
    - Front Porch — reservable/shared exterior zone
    - Back Porch — reservable/shared exterior zone
    - Concrete Entrance Porch — reservable/shared exterior zone
  - Detached Garage / The Trading Post — separate reservable building
  - Grounds

**Kitchen and Dining Room are not booking resources.** They remain ordinary physical context around the Coffee Bar, but Atlas does not reserve them independently. The Coffee Bar itself is the canonical rentable resource for that area and is a direct child of Event Center.

**Water is not a resource.** The temporary Water station concept was removed from the universal resource kernel.

Conference Room, Living Room, and Meeting Room remain one physical resource. Aliases do not create duplicate resources.

Legacy identity is preserved through source-table/object IDs, stable keys, source commits, and cutover metadata.

The following old records are explicitly excluded from the universal resource kernel:

- `venue_kitchen` — retained only as hidden legacy provenance; canonical booking successor is `coffee_bar`
- `lounge_floor`
- `venue_library_addition_exterior`

They remain hidden historical records in the legacy registry rather than active resources.

Coffee Bar remains a `station` resource because that describes what it is physically; it is nevertheless `reservable = true` and uses exclusive booking semantics.

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
- `20260925220559_atlas_universal_booking_calendar_write_membrane_v1`
- `20260925220713_atlas_universal_ledger_occurrence_calendar_binding_v1`
- `20260925221900_elm_venue_legacy_space_resource_cutover_v1`
- `20260925222335_elm_venue_resource_hierarchy_reconciliation_v2`
- `20260925222903_elm_venue_coffee_bar_resource_simplification_v3`
- `20260925224117_atlas_atomic_booking_resource_commit_v1`
- `20260925224756_atlas_universal_availability_booking_policy_v1`
- `20260925225300_atlas_universal_ledger_recurrence_v1`
- `20260925225412_atlas_schedule_responsibility_capabilities_v2`
- `20260925225442_atlas_schedule_kernel_fk_indexes_v1`

## Important non-goals / compatibility boundaries

- Do not use `atlas.day_reservations` as the new booking core. It is legacy farm/member-specific architecture.
- Do not make new booking/resource logic depend on legacy `atlas.organizations` authority.
- Do not store payment state as authoritative booking state.
- Do not create company-specific tables such as `elm_venue_bookings`.
- Do not infer room/zone occupancy from title text when the resource is unknown.
- Do not force every calendar occurrence to have a customer or commercial transaction.
- Do not force a physical space to become a Reality Entity kind; V1 resources are Reality-owned resources beneath canonical Entities.
- Do not create separate resources for aliases of the same physical space. Conference Room, Living Room, and Meeting Room are one resource at Elm.
- Do not promote surrounding physical context into booking resources when the actual rentable unit is narrower. At Elm, Coffee Bar is the rentable resource; Kitchen and Dining Room are not.

## Next implementation layer

The correctness foundation is now strong enough to support UI work, but several universal scheduling capabilities still belong in Atlas proper before calling the subsystem industry-complete.

The next kernel tranches are:

- expiring holds with automatic resource release;
- first-class booking requests, approvals, approvers/delegates, rejection reasons, and approval history;
- universal occurrence participants and scheduling roles such as organizer, customer, attendee, provider, host, required/optional participant, and RSVP/participation state;
- explicit free/busy/transparency semantics so calendar visibility and resource blocking are not treated as the same thing;
- named calendar collections/views within a Ledger without duplicating occurrence or occupancy truth;
- queryable resource capabilities and requirements, followed by requirement-based resource assignment;
- quotas/allowances and cancellation/reschedule policy;
- durable external calendar mappings with UID, sequence/revision, ETag/sync-token/source-of-truth/tombstone semantics;
- standards import/export for iCalendar and, where useful, JSCalendar.

A generic calendar/workbench can now safely be built over the current core to show day/week/month views, resource lanes, bookings and non-commercial occurrences, holds, conflicts, unclassified-resource warnings, policy/availability explanations, recurrence instances, and commercial snapshots.

No Elm-specific logic is required for those behaviors.
