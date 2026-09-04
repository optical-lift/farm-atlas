# Smart Contacts / Elm Local Boundary v1

**Status:** Proposed product and service boundary

**Purpose:** Remove Elm Local from Atlas Core while preserving it as an optional intelligence capability for organizations that want market and contact mapping.

## Product decision

**Elm Local is not Atlas.**

Elm Local is an intelligence engine that may be offered inside Atlas as an optional integration. The customer-facing capability should be packaged as **Smart Contacts** unless and until Elm Local is intentionally exposed as its own brand.

Suggested product language:

> **Smart Contacts**  
> We'll map the people and organizations worth knowing.

> Atlas can map prospective customers, partners, vendors, institutions, supporters, and other relevant organizations around your business. Smart Contacts researches the market, finds useful public contacts, enriches existing Atlas records, and surfaces promising relationships for you to pursue.

Internal implementation may identify the provider as `elm_local`.

## Boundary rule

> **Smart Contacts discovers and enriches. Atlas owns identity, relationship history, operational events, commitments, work, and current state.**

### Smart Contacts / Elm Local owns

- public business and institution discovery;
- geographic and market mapping;
- business classification;
- public contact discovery;
- likely decision-maker research;
- opportunity and fit signals;
- market-category intelligence;
- source-backed enrichment;
- prospect scoring and ranking;
- research provenance;
- recommendations about who may be worth knowing.

### Atlas owns

- the canonical person, organization, and place identity;
- whether a discovered candidate becomes part of the organization's operational world;
- the organization's actual relationship with that party;
- outreach sent;
- replies received;
- meetings and visits;
- purchases, gifts, services, deliveries, or other domain events;
- promises and commitments;
- routes and follow-up;
- current relationship state;
- operational consequences.

## No Core foreign-key dependency

The target architecture must contain **no Atlas Core foreign key whose existence depends on an Elm Local canonical entity row**.

Atlas owns its own party IDs. Smart Contacts attaches through an external identity / source link such as:

```text
atlas_party_id: <Atlas UUID>
provider: elm_local
external_id: <Elm Local entity ID>
```

The exact table name is implementation-specific, but the direction is not:

```text
Elm Local entity -> external identity link -> Atlas party
```

Never:

```text
Atlas party -> depends on Elm Local entity as canonical identity
```

## Candidate inbox

Smart Contacts should not dump researched organizations directly into canonical Atlas relationship state.

The integration produces candidates and enrichment proposals.

Example:

```text
Good Ground Floral
Springfield, Missouri
Category: florist
Likely fit: high
Buyer contact: not confirmed
Sources: ...
```

Atlas then offers a controlled transition such as:

- Add to Atlas;
- Merge with existing Atlas organization;
- Enrich existing organization;
- Dismiss / not relevant;
- Suppress from future recommendations.

Once accepted, Atlas owns the resulting party and relationship. Smart Contacts remains its discovery/enrichment provenance.

## Existing-record enrichment

If Atlas already knows the organization, Smart Contacts must propose enrichment against the existing canonical party rather than create a duplicate.

Resolution may use:

- normalized organization name;
- website/domain;
- phone;
- address;
- geospatial match;
- external provider identifiers;
- reviewed aliases.

Consequential or ambiguous merges must enter Atlas identity review rather than being silently forced.

## Disconnect semantics

Disconnecting Smart Contacts must:

- stop future discovery/enrichment;
- revoke integration access according to policy;
- retain Atlas-owned parties and relationships;
- retain valid events, commitments, route history, and domain history;
- retain provenance indicating which historical enrichment came from Smart Contacts;
- never strand Atlas operational rows because an Elm Local foreign row is unavailable.

This is a hard integration acceptance test.

## Physical extraction target

The current `local_intel` schema shares a Supabase project with Atlas and has become entangled with Atlas buyer identity. That is an implementation accident, not the target product boundary.

Target state:

```text
Elm Local / Smart Contacts service
  - own research stores
  - own discovery queues
  - own market models
  - own source evidence
  - own internal identifiers
            |
            | integration contract
            v
Atlas
  - canonical parties
  - relationships
  - observations/events
  - commitments/work/routes
  - domain systems
```

Physical separation may be staged. The required sequence is:

1. remove Atlas Core identity dependence on `local_intel.entities`;
2. introduce Atlas-owned canonical parties and external identity links;
3. place a Smart Contacts adapter in front of existing `local_intel` capabilities;
4. migrate current cross-schema references;
5. only then move Elm Local into its own service/database boundary when operationally safe.

## What may remain shared temporarily

During extraction, `local_intel` may remain in the same Supabase project for deployment convenience provided that:

- Atlas reads/writes it only through the integration adapter;
- no new Atlas Core foreign keys target `local_intel`;
- new Smart Contacts data does not become canonical Atlas identity by default;
- all accepted candidates are copied/linked into Atlas-owned identity;
- tests prove Atlas remains readable when Smart Contacts data is unavailable.

## Elm Farm migration

Elm Farm is both an Atlas user and the original owner of Elm Local. It may use Smart Contacts extensively, but it must use it through the same contract future customers will use.

That means Elm Farm receives no architectural exemption.

Current florist and other buyer relationships that exist only in buyer reconstruction must be resolved into Atlas-owned organizations. If Smart Contacts already knows the same organization, its entity ID becomes an external link, not the canonical ID.

## Customer-facing onboarding

Smart Contacts should appear only after Atlas establishes the customer's own world.

Recommended sequence:

1. establish organization/account;
2. connect existing operational sources;
3. resolve existing people/organizations;
4. establish current relationships;
5. offer Smart Contacts: `Want us to map more of the market around you?`

This keeps optional market intelligence from masquerading as Atlas's own memory.

## Smart Contacts acceptance tests

The integration is correctly separated when all are true:

1. Atlas can create and use an organization without Smart Contacts installed.
2. A Smart Contacts candidate can be accepted into Atlas without making Elm Local its canonical identity owner.
3. A candidate matching an existing Atlas organization enriches rather than duplicates it.
4. Disconnecting Smart Contacts does not erase or break accepted Atlas relationships.
5. Smart Contacts cannot directly mutate a buyer/donor/service relationship projection.
6. Every enrichment retains provider and source provenance.
7. Elm Farm uses the same adapter contract as future Atlas customers.
