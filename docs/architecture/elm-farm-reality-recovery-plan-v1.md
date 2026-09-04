# Elm Farm Reality Recovery Plan v1

**Status:** Working migration and acceptance plan

**Purpose:** Use Elm Farm's current messy-but-real data as the migration specimen for the Atlas Core Reality Contract rather than manually cleaning symptoms one table at a time.

## Why Elm Farm is the fixture

Elm Farm contains the exact conditions future Atlas customers will eventually create:

- years of relationship memory;
- multiple operators;
- user-reported events;
- direct application entries;
- purchases and corrections;
- outreach by email, text, phone, and in person;
- discovered prospects;
- routes;
- stale contacts;
- ambiguous authority;
- external-source evidence;
- manually reconstructed history.

If Atlas can reconcile Elm Farm without destroying provenance, the architecture is substantially more credible for future organizations.

## Audit snapshot — 2026-09-04

The following facts were observed in the live Atlas/Supabase system during the reality-intake audit.

### Florist identity split

- 26 florist-related rows exist in `atlas.buyer_relationship_reconstruction`.
- 26 of 26 currently have `entity_id IS NULL`.
- `entity_id` is nevertheless defined as a foreign key to `local_intel.entities(id)`.
- Therefore the buyer relationship layer and Elm Local entity layer are architecturally connected in schema but operationally unlinked in the live florist data.

### Outreach fragmentation

Within the florist reconstruction population:

- some records use `metadata.latest_outreach`;
- some use `metadata.outreach_history`;
- some use bespoke flags such as `educational_tour_followup_email_sent`;
- others use other named email flags;
- some outreach is represented in `atlas.buyer_contact_events`;
- some source communications live independently in `atlas.communication_events`.

The same conceptual occurrence type therefore does not currently have one guaranteed storage/retrieval path.

### Communications

At audit time the communication system contained approximately:

- 4,183 communication events;
- 102 source-state observations;
- 7 communication conflicts;
- 1 communication identity link;
- 7 identity-review queue rows.

The communication custody model is strong, but identity resolution into the operational relationship graph is not yet mature.

### Routes

At audit time the general route system contained:

- 3 operational routes;
- 4 route stops;
- 0 route events.

The general route primitive exists but is not yet the lived memory path for Elm Farm's sales rounds.

### Commercial correction behavior

The Schaffitzel's 2026-08-28 sale provides a positive reference pattern:

- an earlier incorrect $25/celosia sale assertion remains preserved;
- it is explicitly cancelled as an `entry_correction`;
- the corrected $20/goldenrod sale remains active;
- the commercial summary reports one valid $20 purchase.

This is the preferred correction grammar: preserve history, record why an assertion ceased to govern, and derive current truth from reconciled events.

## Migration principles

1. **Do not clean by deleting evidence.** Preserve original rows and provenance until the new model proves parity.
2. **Do not hand-promote reconstruction metadata into canonical truth without attribution.** Reconstruction rows become migration/source evidence.
3. **Do not create a new florist-specific identity system.** Resolve into Atlas-owned canonical parties.
4. **Do not make Elm Local the canonical identity source.** Existing or newly discovered Elm Local entities become external links/enrichment.
5. **Do not flatten nuanced relationships into yes/no statuses.** Preserve roles, authority, dependencies, and open loops.
6. **Do not migrate projections as though they were events.** Reconstruct the supporting observations/events first where possible.
7. **Use shadow read models before cutover.** Old and new views should be compared until discrepancies are explained.

## Migration tranches

### Tranche A — census and classification

Inventory every relevant table, view, function, trigger, API path, and JSON metadata convention touching:

- buyer identity;
- contact identity;
- buyer relationship state;
- outreach;
- communications;
- purchases;
- preferences;
- routes;
- local intelligence / discovered prospects;
- follow-up tasks.

Classify each artifact as:

- Core;
- Domain;
- Integration;
- Evidence;
- Projection;
- Legacy / migration only.

Output: repository-owned census with explicit destination/disposition for every artifact.

### Tranche B — Atlas-owned canonical party graph

Introduce or designate the Atlas-owned canonical identity layer for:

- people;
- organizations;
- places;
- aliases;
- contact points;
- external identities.

Resolve current Elm Farm florist organizations into this graph. Create review items for ambiguous identities rather than guessing.

### Tranche C — Receive ledger

Introduce the universal receive envelope and append-only observation custody.

Backfill selected existing evidence sources with links to original rows rather than copying untraceable prose.

### Tranche D — relationship timeline projection

Build the canonical relationship timeline/current-position read surface.

It must union reconciled events from communication, commerce, route, and relationship domains without requiring the caller to know those storage locations.

### Tranche E — reconstruct legacy buyer history

Translate current reconstruction material into source-attributed observations/events where justified.

Targets include:

- `latest_outreach` objects;
- `outreach_history` arrays;
- bespoke email-sent flags;
- historical buyer notes;
- contact-name transitions;
- route outcomes currently stored only in narrative notes.

Every migrated fact retains a pointer to the legacy source row/field.

### Tranche F — Smart Contacts separation

Resolve any relevant `local_intel` entity to Atlas parties through external identity links.

Move all future interaction through the Smart Contacts adapter. Prohibit new Atlas Core foreign keys to `local_intel`.

### Tranche G — route activation

Use the existing operational route system as the Core route foundation.

Represent Katie's Springfield florist rounds as dated routes/rounds whose stop outcomes emit canonical visit/contact/sale/open-loop events.

### Tranche H — assistant write cutover

Provide the Atlas Receive / domain write tool that connected assistants use for ordinary memory.

Stop ordinary assistant behavior from directly mutating relationship reconstruction or projection metadata.

### Tranche I — retire legacy write paths

After read parity and acceptance tests pass:

- freeze reconstruction tables as migration/history sources;
- stop new JSON outreach conventions;
- remove UI/API write paths that bypass Receive/domain contracts;
- retain historical custody for audit/provenance.

## Acceptance corpus

### Schaffitzel's

Must show:

- Kim as current known buyer;
- valid purchase history only in totals;
- original corrected sale visible in provenance/history but not current totals;
- product-level purchase history;
- route visits;
- open product questions or follow-ups.

### Linda's Flowers / Josh

Must show:

- Josh as current known contact;
- historical strong-buyer context;
- availability-list interest;
- `not this week` as non-purchase, not rejection;
- route history and next eligible follow-up.

### Flowerama / Recinna

Must show:

- Katie's in-person visit;
- receptive/no-purchase outcome;
- class-tour interest;
- later Elm Farm follow-up email;
- open reply/date loop;
- no double-counting if actual email evidence later arrives;
- actor/operator attribution separated from organizational sender where relevant.

### House of Flowers

Must show:

- prior buyer no longer current;
- current buyer unknown until discovered;
- Wednesday preference preserved only to the confidence justified by evidence;
- route objective to identify current buyer;
- new buyer discovery resolves the open loop.

### Rose Among Thorns

Must show:

- Theresa as owner where supported;
- temporary unavailability separate from relationship rejection;
- purchasing authority may belong to another current person;
- follow-up history and route outcomes.

### Mama Jean's East Sunshine / Jandyn

Must show:

- Jandyn handles floral ordering;
- Jandyn lacks final grower approval authority;
- category-manager approval is a dependency/open loop;
- subsequent contact updates that dependency rather than overwriting the relationship into a simplistic status.

### Zimmerman Meats / Kendall

Must show:

- phone follow-up rather than physical route visit;
- proposed 5-stem bouquet resale model;
- Kendall's promise to ask owner;
- owner decision as unresolved until observed.

### Good Ground Floral / Smart Contacts case

Must show:

- discovery provenance through Smart Contacts / Elm Local;
- accepted Atlas organization has Atlas-owned canonical ID;
- Smart Contacts disconnect does not erase the organization or later relationship history.

## Read parity test

Before retiring legacy views, choose a set of representative entities and answer the same questions using old and new models:

- Who are they?
- Who do we know there?
- What happened last?
- What have they bought / given / received / serviced?
- What communications occurred?
- What route visits occurred?
- What is unresolved?
- What should the operator know before the next encounter?
- Why does Atlas believe each material fact?

Every discrepancy must be classified as:

- legacy bug corrected by new model;
- missing migration evidence;
- unresolved identity;
- unsupported legacy projection;
- new-model bug.

No discrepancy is silently waved through.

## Exit gate

Elm Farm reality recovery is complete when:

1. representative buyer relationships have Atlas-owned canonical identities;
2. current relationship timelines are queryable through one read surface;
3. purchase, communication, visit, and follow-up history can be retrieved without knowing internal domain tables;
4. evidence provenance is retained;
5. corrections do not become duplicate current truth;
6. Smart Contacts is optional and removable;
7. Katie's next-round doorstep context can be produced from prior route and relationship events;
8. ordinary assistant writes use Atlas contracts rather than direct table selection;
9. legacy reconstruction structures no longer receive normal new operational truth.
