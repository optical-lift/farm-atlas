# Atlas Core Party Model v1

**Status:** Implementation contract for Reality Foundation #788  
**Parent:** `atlas-core-reality-contract-v1.md`  
**Current-state evidence:** `atlas-current-reality-path-census-v1.md`

## Purpose

Atlas needs one canonical identity anchor for the people, organizations, and places that exist in an Atlas organization's operating world.

Today that role is split across buyer reconstruction, communication evidence, and `local_intel`. The result is rich memory without a reliable join spine. The live census found 92 buyer relationship rows with zero populated `entity_id` links and 4,084 communication events with zero communication identity links.

This contract creates the missing Core identity layer without turning an integration, a tenant record, a farm place, or a CRM projection into identity authority.

## 1. Three concepts that must remain distinct

### 1.1 Atlas tenant organization

`atlas.organizations` answers:

> Whose Atlas operating world is this?

It is the tenancy/account/security boundary. It owns memberships, farms, tasks, projects, routes, onboarding, connected-source custody, and other tenant-scoped operational records.

It is **not** the table for Flowerama, a church, a vendor, a customer, a school, or another external organization.

### 1.2 Atlas operational place

`atlas.places` currently answers:

> What named operational place exists inside this farm/operating environment?

It is farm-scoped and currently contains room/work-station/house/garage/distribution-style operational locations.

It is **not** the general identity registry for a customer storefront, church, donor stop, or outside address.

### 1.3 Atlas Party

`atlas.parties` answers:

> Who or what is this identifiable person, organization, or place in this Atlas organization's world?

A Party is tenant-scoped canonical identity. It can exist whether or not Smart Contacts, Gmail, Apple Messages, Stripe, a florist workflow, or any other integration/domain is installed.

## 2. Core identity primitives

### Party

The universal identity anchor.

Required concepts:

- `id`
- `organization_id` — the Atlas tenant that owns this canonical identity
- `party_kind` — `person`, `organization`, or `place`
- `display_name`
- lifecycle state — `active`, `inactive`, or `merged`
- optional `merged_into_party_id`
- creation provenance / idempotency
- metadata that is non-authoritative unless promoted through an explicit contract

A Party UUID is the durable Core identity. Display names, aliases, email addresses, phone numbers, provider IDs, and integration entity IDs are not identity by themselves.

### Person profile

`atlas.party_people` is a 1:1 subtype for a Party whose kind is `person`.

It may carry intentionally asserted name parts or preferred-name data. It must not be populated by guessing a person's legal or preferred name from a contact string.

### Organization-entity profile

`atlas.party_organizations` is a 1:1 subtype for a Party whose kind is `organization`.

The name deliberately avoids `atlas.organizations`, which remains the tenant/account boundary.

### Place-entity profile

`atlas.party_places` is a 1:1 subtype for a Party whose kind is `place`.

This represents an independently identifiable external/general place. It does not replace farm-scoped `atlas.places`. A later explicit relation may connect a Party place to an internal operational place when that is genuinely the same real-world location.

## 3. Identity-bearing observations around a Party

### Aliases

`atlas.party_aliases` records names/labels/legacy keys that have been associated with a Party.

An alias may help recognition, but alias equality is not sufficient proof that two Parties are identical.

Examples:

- `Flowerama`
- historical business name
- `Re-seen-a` pronunciation/display aid
- a legacy buyer stable key

### Contact points

`atlas.party_contact_points` records a communication coordinate associated with a Party, such as:

- email
- phone
- website
- postal address text
- social handle
- other declared contact coordinate

A contact point carries source/provenance and verification state. A discovered email is not automatically the preferred or authoritative email. Matching contact-point text may generate an identity candidate; it does not silently merge Parties.

### External identities

`atlas.party_external_identities` links a canonical Party to an identity owned by another system.

Examples:

- Smart Contacts entity/person ID
- Apple Messages participant/source identity
- Gmail/contact identity
- Stripe customer ID
- legacy buyer relationship ID
- future CRM/provider object ID

The direction of authority is always:

`external identity -> Atlas Party`

never:

`external system row becomes the Atlas Party`.

Only confirmed current links belong in the external-identity table. Unresolved candidates belong in identity review.

## 4. Identity review and adjudication

`atlas.party_identity_review_items` is the Core queue for unresolved identity questions.

It may be fed by Smart Contacts or any other evidence source. It stores enough source attribution to explain why a match is proposed, but Smart Contacts does not own the adjudication.

Examples:

- “Is this Smart Contacts Flowerama entity the same Party as the existing Flowerama buyer?”
- “Does this email participant correspond to Recinna or only to the Flowerama organization?”
- “Is this newly discovered House of Flowers buyer the same person as an existing contact?”

Review states are `open`, `accepted`, `rejected`, and `superseded`.

Accepted adjudication may create an external-identity link or another explicit Core identity fact. Rejection preserves the evidence that the candidate was considered and refused.

## 5. Party merge semantics

Duplicate canonical Parties will sometimes be created before enough evidence exists. Atlas must correct that without deleting history.

`atlas.party_merge_events` is append-only.

A merge:

1. names a source Party and a surviving target Party;
2. records reason, evidence and actor;
3. marks the source Party `merged` and points `merged_into_party_id` to the survivor;
4. does **not** delete the source Party, its evidence, aliases, contact points, or historical references;
5. causes canonical resolution to follow the merge chain to the survivor.

Merge is not used merely because two rows have the same display name.

## 6. Tenant scoping

Every Party and every Party-owned identity record is scoped by `organization_id`.

Core v1 does not attempt cross-tenant global identity. The same real-world organization may legitimately be represented as separate Parties in two Atlas tenants because each tenant owns its own operational truth, permissions, relationships, and provenance.

A future explicit federation contract may link those identities. It is not part of v1.

## 7. Authority rules

### Core owns

- canonical Party IDs
- Party lifecycle / merge state
- accepted aliases/contact points needed for operations
- confirmed external identity links
- identity-review adjudication

### Integrations may own

- discovery candidate rows
- source/provider-specific IDs
- enrichment and ranking
- source evidence
- campaign/provider metadata

### Domains may own

- buyer status
- sales/demand state
- donor/customer/vendor-specific classifications
- service or fundraising semantics

Those domain facts reference Parties/relationships; they do not redefine who the Party is.

## 8. Write path

Direct authenticated table mutation is not the public contract.

### Canonical identity management commands

Core v1 should expose guarded commands for:

- creating a Party
- adding an alias
- adding/updating the current status of a contact point through an explicit command
- linking an external identity
- opening/adjudicating an identity review item
- merging Parties
- resolving a Party to its surviving canonical ID

Owner/Consultant authority may perform explicit identity adjudication. Ordinary worker/assistant observations should flow through Atlas Receive (#789), which may deterministically resolve an existing Party or create an identity review candidate rather than granting arbitrary table-write authority.

Service-role migrations/integration adapters may write through dedicated functions while preserving source provenance.

## 9. Read path

Core v1 should expose a stable Party read model containing:

- canonical Party ID after merge resolution
- party kind
- display name
- aliases
- accepted contact points and verification status
- external-identity links appropriate to the caller
- merge state

No consumer should need to join `local_intel.entities`, buyer reconstruction, or provider-specific identity tables merely to know who a Party is.

## 10. Migration seams

### Buyer reconstruction

Do not rewrite all buyer rows during #788.

First establish Core Party primitives. Then create explicit legacy external-identity links such as:

`source_system_key = 'legacy_buyer_relationship'`

with the legacy buyer relationship UUID as source record identity during #793 backfill.

The legacy buyer row remains readable until canonical relationship parity exists.

### Communication

`atlas.communication_identity_links` currently has no rows. #788 establishes the canonical Party target so the communication identity lane can be wired without changing communication evidence authority.

### Smart Contacts / local_intel

Do not bulk-copy all `local_intel.entities` or `local_intel.people` into Core.

Smart Contacts submits identity evidence/candidates. Only entities that become operationally relevant need a Core Party, and their Smart Contacts IDs attach as external identities.

### Flower commerce

Flower sales, demand, standing orders and prospect routes remain domain authority. Their buyer relationship references are repointed in later work after Party/relationship parity exists.

## 11. Acceptance cases

### Flowerama + Recinna

Expected identity shape:

- one organization Party for Flowerama;
- one person Party for Recinna when evidence is sufficient to identify her as a person distinct from the organization;
- Smart Contacts, legacy buyer, email/message or other source IDs linked as external identities to the appropriate Party;
- the relationship between Recinna and Flowerama belongs to #790, not to the Party table.

An email to Recinna must not be attributed to the wrong actor merely because the organization record is correct; event attribution is separate from identity.

### House of Flowers

Atlas may know the organization Party while current buyer identity remains unknown. It must not invent or perpetuate a deceased/historical contact as the current person merely to satisfy a non-null field.

### Rose Among Thorns

The owner and the person actually reached are separate person identities unless evidence says otherwise. Purchasing authority is relationship/domain state, not Party identity.

### Smart Contacts removal

Disabling Smart Contacts must leave the Party IDs, operational contact history, sales, routes, open loops and relationship state usable.

## 12. Non-goals for #788

- generic relationship role vocabulary — #790
- open-loop/opportunity/pursuit vocabulary — #790
- generic evidence Receive envelope — #789
- bulk Elm Farm buyer migration — #793
- universal Rounds — #792
- assistant write cutover — #794
- globally shared cross-tenant identity

## 13. Hard invariants

1. `atlas.organizations` remains tenant/account authority and is never overloaded as an external organization directory.
2. `atlas.places` remains operational-place authority and is never overloaded as the universal external place directory.
3. A Party belongs to exactly one Atlas tenant organization.
4. Party kind is explicit and cannot silently change after creation.
5. A merged Party is never physically deleted as part of identity correction.
6. Merge history is append-only.
7. External IDs, aliases and contact coordinates do not independently prove identity.
8. Integration identity can attach to Core identity but cannot become Core authority.
9. Domain classifications do not belong in the Party identity record.
10. Direct authenticated table writes are not the public identity contract.
11. All migrations must satisfy Atlas post-cutover exact-source custody.

## 14. #788 implementation sequence

1. Add Core Party tables, constraints, indexes and RLS.
2. Add append-only merge history and mutation guards.
3. Add guarded owner/consultant identity commands and service-safe integration linkage command(s).
4. Add canonical Party resolution/read API.
5. Register authenticated RPC privileges in the existing Atlas RPC governance registry where required.
6. Add contract/database tests.
7. Prove Flowerama/Recinna and unknown-current-buyer fixtures without bulk migrating the buyer corpus.
8. Only then begin #793 production backfill planning.
