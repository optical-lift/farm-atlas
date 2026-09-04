# Smart Contacts / Elm Local Boundary v1

**Status:** Proposed product and service boundary

**Purpose:** Remove Elm Local from Atlas Core while preserving it as an optional intelligence capability for organizations that want market and contact mapping.

## Product decision

**Elm Local is not Atlas.**

Elm Local is an intelligence engine that may be offered inside Atlas as an optional integration. The customer-facing capability should be packaged as **Smart Contacts** unless and until Elm Local is intentionally exposed as its own brand.

Suggested product language:

> **Smart Contacts**  
> We'll map the people and organizations worth knowing.

> Atlas can map prospective customers, partners, vendors, institutions, supporters, and other relevant organizations around your business. Smart Contacts researches the market, finds useful public contacts, enriches existing Atlas identity evidence, and surfaces promising relationships for you to pursue.

Internal implementation may identify the provider as `elm_local`.

## Boundary rule

> **Smart Contacts discovers and enriches. Atlas owns identity reconciliation, relationship history, operational events, commitments, work, and current state.**

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

- durable tenant-scoped identity subjects;
- reconciliation of source records that concern the same person, organization, or place;
- Party/Person/Organization/Place projections derived from reconciled evidence;
- whether a discovered candidate becomes operationally relevant;
- the organization's actual relationship with the subject;
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

Smart Contacts rows remain provider-owned source records. Atlas may bind them to an identity subject through source-record references and identity assertions.

Conceptually:

```text
Elm Local entity/person record
        |
        | source evidence
        v
Atlas identity source record
        |
        | reconciliation assertion
        v
Atlas identity subject
        |
        v
Party / Person / Organization / Place projection
```

Never:

```text
Atlas operational identity depends on Elm Local row existing as canonical truth
```

## Candidate inbox

Smart Contacts should not dump researched organizations directly into Atlas relationship state or a privileged canonical directory.

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

Atlas then offers controlled transitions such as:

- relate this candidate to an existing Atlas subject;
- establish a new identity subject candidate;
- accept selected enrichment claims;
- dismiss / not relevant;
- explicitly mark as a non-match to an existing subject;
- suppress from future recommendations.

The Smart Contacts row remains provider evidence either way.

## Existing-record enrichment

If Atlas already has evidence about the organization, Smart Contacts should propose identity/enrichment assertions against the existing subject rather than create a duplicate canonical object.

Resolution may consider:

- normalized organization name;
- website/domain;
- phone;
- address;
- geospatial match;
- external provider identifiers;
- reviewed aliases;
- prior explicit non-match adjudications.

Similarity is evidence, not proof. Consequential or ambiguous equivalence must enter Atlas identity review rather than being silently forced.

## Disconnect semantics

Disconnecting Smart Contacts must:

- stop future discovery/enrichment;
- revoke integration access according to policy;
- retain Atlas identity subjects and reconciled projections needed by operations;
- retain relationships;
- retain valid events, commitments, route history, and domain history;
- retain provenance indicating which historical identity/enrichment claims came from Smart Contacts;
- never strand Atlas operational rows because an Elm Local foreign row is unavailable.

Historical provider evidence may remain represented by source identifiers/provenance even when the live provider row is no longer queryable.

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
            | integration evidence contract
            v
Atlas
  - identity subjects + reconciliation
  - identity projections
  - relationships
  - observations/events
  - commitments/work/routes
  - domain systems
```

Physical separation may be staged. The required sequence is:

1. remove Atlas Core identity dependence on `local_intel.entities`;
2. introduce Atlas-owned identity subjects, source-record references, assertions, and projections;
3. place a Smart Contacts adapter in front of existing `local_intel` capabilities;
4. migrate current cross-schema references into explicit integration evidence/reconciliation seams;
5. only then move Elm Local into its own service/database boundary when operationally safe.

## What may remain shared temporarily

During extraction, `local_intel` may remain in the same Supabase project for deployment convenience provided that:

- Atlas reads/writes it only through the integration adapter;
- no new Atlas Core foreign keys target `local_intel`;
- new Smart Contacts data does not become governing Atlas identity by default;
- accepted/relevant candidates attach as source evidence to Atlas identity subjects;
- ambiguous candidates remain unresolved/reviewable;
- tests prove Atlas remains readable when Smart Contacts data is unavailable.

## Elm Farm migration

Elm Farm is both an Atlas user and the original owner of Elm Local. It may use Smart Contacts extensively, but it must use it through the same contract future customers will use.

That means Elm Farm receives no architectural exemption.

Current florist and other buyer relationships that exist only in buyer reconstruction must be progressively reconciled to Atlas identity subjects. If Smart Contacts already knows the same organization, its row becomes corroborating/provider evidence rather than the canonical identity owner.

## Customer-facing onboarding

Smart Contacts should appear only after Atlas establishes the customer's own operating world and begins reconciling its existing source evidence.

Recommended sequence:

1. establish organization/account;
2. connect existing operational sources;
3. reconcile existing people/organizations where evidence supports it;
4. establish current relationships;
5. offer Smart Contacts: `Want us to map more of the market around you?`

This keeps optional market intelligence from masquerading as Atlas's own memory.

## Smart Contacts acceptance tests

The integration is correctly separated when all are true:

1. Atlas can establish and use identity subjects without Smart Contacts installed.
2. A Smart Contacts candidate can resolve to an Atlas subject without making Elm Local its identity owner.
3. A candidate matching existing Atlas evidence enriches/reconciles rather than creates a parallel canonical directory row.
4. Ambiguous matches can remain unresolved and explicit non-matches are retained.
5. Disconnecting Smart Contacts does not erase or break reconciled Atlas relationships/history.
6. Smart Contacts cannot directly mutate buyer/donor/service relationship projections.
7. Every enrichment and identity assertion retains provider/source provenance.
8. Elm Farm uses the same adapter contract as future Atlas customers.
