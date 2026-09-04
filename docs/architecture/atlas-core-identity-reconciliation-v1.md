# Atlas Core Identity Reconciliation v1

**Status:** Implementation contract for Reality Foundation #788  
**Parent:** `atlas-core-reality-contract-v1.md`  
**Current-state evidence:** `atlas-current-reality-path-census-v1.md`

## Purpose

Atlas needs a durable way to know when records from different sources concern the same real-world person, organization, or place without turning any one source row into canonical reality.

The current system has rich but disconnected evidence: buyer reconstruction, communication participants, flower commerce, routes, manually reported outreach, and `local_intel` discovery. The live census shows the memory is present while the join spine is absent.

This contract makes identity **evidence-first**.

> Atlas does not begin by creating a privileged directory row and forcing all evidence into it. Atlas preserves source records, establishes which records concern the same real-world subject, adjudicates conflicts, and projects a usable current identity from that reconciled evidence.

## 1. Existing Atlas concepts that remain distinct

### Atlas tenant organization

`atlas.organizations` remains the account/security boundary. It answers:

> Whose Atlas operating world is this?

It is not an external-business directory.

### Atlas operational place

`atlas.places` remains the farm/operational place registry used by work execution. It is not the universal identity ontology for every outside storefront, church, residence, donor site, or service location.

### Identity subject

A new thin Core subject answers only:

> What enduring real-world subject do these observations appear to concern?

The subject is tenant-scoped and has a durable UUID. It deliberately carries almost no descriptive business state.

The subject UUID is a reconciliation anchor, not a claim that Atlas possesses metaphysical certainty about the subject.

## 2. Core primitives

### Identity subject

Conceptual storage: `atlas.identity_subjects`.

Minimum responsibilities:

- durable UUID;
- owning Atlas tenant organization;
- lifecycle state required for identity correction;
- creation provenance / idempotency;
- no privileged name, email, phone, address, buyer state, owner state, or integration ID required for existence.

A subject may later project as a Person, Organization, or Place. Those classifications are reconciled conclusions, not assumptions required to create the subject.

### Source record reference

Conceptual storage: `atlas.identity_source_records`.

A source record reference identifies an evidence-bearing record without copying that record into Core authority.

Examples:

- legacy buyer relationship row;
- communication participant/source identity;
- Smart Contacts entity/person row;
- Gmail contact or participant identity;
- Stripe customer object;
- route-stop destination/contact observation;
- imported CSV/contact row;
- user-reported identity observation admitted through Atlas Receive.

Required concepts:

- source system;
- source record identity;
- source record type;
- observed/received times when available;
- custody/provenance reference;
- tenant scope;
- idempotency.

### Identity assertion

Conceptual storage: `atlas.identity_assertions`.

An assertion states an identity proposition and retains why Atlas has it.

Examples:

- source record A concerns subject X;
- source record B probably concerns subject X;
- source record C does not concern subject X;
- subject X and subject Y appear equivalent;
- email address E is associated with subject X;
- name `Flowerama` has been observed for subject X;
- subject X appears to be an organization;
- subject Y appears to be a person.

Assertions must include source/provenance, confidence/adjudication state, and effective timing where relevant.

An assertion is evidence. It does not become governing merely because it was inserted first.

### Identity claim

Identity properties are claims around a subject rather than privileged columns on a canonical Party row.

Examples:

- name;
- alias;
- person/organization/place classification;
- email;
- phone;
- website;
- postal address;
- social handle;
- provider/external ID;
- preferred display label;
- legal/registered name when explicitly sourced.

Claims retain provenance and may conflict.

`same value` does not automatically mean `same subject`.

### Identity equivalence / non-equivalence

Core must be able to state explicitly that:

- two source records concern the same subject;
- two subjects are now adjudicated to be the same real-world subject;
- two similar records have been adjudicated as different subjects;
- the evidence remains ambiguous.

Negative identity evidence is important. A rejected match must remain available so Atlas does not repeatedly rediscover and re-propose the same bad merge.

## 3. Reconciliation states

At minimum, identity resolution needs these outcomes:

- `resolved` — evidence supports a subject strongly enough for the requested use;
- `probable_match` — likely same subject but not yet eligible for consequential promotion;
- `ambiguous` — multiple plausible subjects or contradictory evidence;
- `new_subject_candidate` — no existing subject is sufficiently supported;
- `non_match` — a proposed equivalence has been rejected;
- `unresolved` — insufficient evidence.

The consequence threshold may vary by operation. Displaying a probable contact suggestion may require less authority than merging sales history or attributing a payment.

## 4. Review and adjudication

Conceptual storage: `atlas.identity_review_items` and append-only adjudication records.

Review is Core-owned even when the candidate came from Smart Contacts or another integration.

Examples:

- Is Smart Contacts Flowerama the same subject as the legacy buyer record?
- Does this Gmail participant identify Recinna personally, Flowerama generally, or neither?
- Are two `House of Flowers` records the same business?
- Is the person reached during a Rose Among Thorns visit Theresa or another buyer?

Adjudication must preserve:

- proposed proposition;
- supporting and contradicting evidence;
- decision;
- actor/authority;
- rationale when required;
- timestamp;
- any later supersession.

## 5. Correction semantics

Identity can be wrong. Atlas must correct identity without rewriting history.

### Subject equivalence

If subject X and subject Y are later proven to concern the same real-world subject, Atlas records an append-only equivalence/adjudication and resolves both through a surviving identity representation.

Historical source links are not deleted.

### Split / mistaken merge

The model must not assume merges are irreversible truth. If later evidence shows that records combined under one subject actually concern two people or organizations, Atlas must support explicit correction/split adjudication while preserving the old mistaken assertion and its consequences for audit.

This is one reason a thin subject + evidence graph is preferred to destructive row merging.

## 6. Party, Person, Organization, and Place become projections

Atlas applications should not have to reason over raw identity evidence for ordinary screens.

Core should expose stable projections such as:

- `atlas.parties_v1`;
- `atlas.people_v1`;
- `atlas.organization_entities_v1`;
- `atlas.place_entities_v1`;
- subject current-name/contact projections;
- subject provenance drill-down.

These projections answer:

> Given currently applicable identity evidence and adjudication policy, what is the best usable representation of this subject now?

A projection may expose:

- subject UUID;
- current classification;
- current display name;
- accepted aliases;
- usable contact points;
- source confidence/provenance summaries;
- unresolved identity warnings.

The projection is not the evidence ledger and may change when evidence changes.

## 7. Relationship roles do not belong in identity

Identity answers who/what the subject is.

Relationship truth answers how subjects relate.

Examples that must remain outside the identity subject itself:

- Recinna works at Flowerama;
- Recinna is a buyer/contact for Flowerama;
- Theresa owns Rose Among Thorns;
- Jandyn handles floral ordering but lacks approval authority;
- Josh is Elm Farm's relevant contact at Linda's;
- a missionary has a support relationship with a church.

Those belong to #790 relationship reconciliation/current-position work.

## 8. Tenant scoping

Identity subjects are tenant-scoped in v1.

Atlas does not attempt a global cross-customer identity graph yet. Two Atlas customers may hold separate subject UUIDs for the same external organization because their permissions, provenance, relationship history, and operating worlds are independent.

A future federation contract may link them explicitly. It is outside v1.

## 9. Integration boundary

Integrations contribute source records and identity claims.

They do not own the subject.

Smart Contacts may say:

> We found a Springfield florist named Good Ground Floral at this website/address and believe it matches an existing Atlas subject.

Atlas identity reconciliation decides whether that evidence:

- binds to an existing subject;
- creates a new subject candidate;
- enriches a subject projection;
- remains ambiguous;
- is rejected.

Disconnecting Smart Contacts removes future access/discovery but does not delete Atlas's reconciled subject history or operational records.

## 10. Receive boundary

#788 must align with Atlas Receive (#789).

An incoming caller should provide source-attributed identity hints, not internal graph mutations.

Example:

```text
source: user report
organization hint: Flowerama
person hint: Recinna
channel: email
observation: Elm Farm sent follow-up about class visit
```

Receive preserves the observation, then identity reconciliation resolves or queues the participants.

The caller should not be required to create a subject UUID, choose an identity table, or decide whether a provider record should be merged.

## 11. Read guarantees

Core identity must provide two levels of read:

### Ordinary identity projection

Suitable for application/domain consumers:

- subject UUID;
- current usable name/classification;
- current accepted contact coordinates;
- aliases;
- identity confidence/warnings;
- relevant external-source linkage where authorized.

### Provenance drill-down

Suitable for explanation/review:

- which source records support the identity;
- which claims conflict;
- which assertions were adjudicated;
- why two records were joined or kept separate;
- correction history.

No consumer should have to query `local_intel.entities`, buyer reconstruction, or provider-specific identity tables merely to know the current projected identity.

## 12. Migration seams

### Buyer reconstruction

Do not bulk-copy buyer rows into a new Party directory.

Instead, each relevant legacy buyer row becomes or references an identity source record. Identity reconciliation progressively binds it to a subject when justified.

### Communication

Communication evidence remains append-only and evidence-authoritative. Participant/source identities are linked to subjects through assertions rather than copied into canonical person rows.

### Smart Contacts / local_intel

Do not bulk-copy all `local_intel.entities` or `local_intel.people` into Atlas Core.

They remain integration-owned source records. Operationally relevant candidates may resolve to Atlas subjects while retaining Smart Contacts provenance.

### Flower commerce

Sales/demand/order ledgers remain domain authority. Buyer/customer identifiers progressively resolve to subjects/relationships without rewriting valid commercial history.

### Routes

A route stop may carry a destination/contact observation even before identity is resolved. Later identity reconciliation may bind that stop evidence to a subject without changing the fact that the visit occurred.

## 13. Acceptance fixtures

### Flowerama + Recinna

Atlas should be able to bind:

- legacy Flowerama buyer record;
- Katie route visit destination;
- Elm Farm follow-up observation;
- later actual email participant/provider evidence;
- optional Smart Contacts record;

around one organization subject for Flowerama when justified, while maintaining a separate person subject for Recinna when evidence supports that distinction.

No one source record becomes the canonical Flowerama row.

### House of Flowers

Atlas may resolve the business subject while current buyer identity remains unresolved. Historical/deceased buyer evidence remains visible but cannot silently govern the current projection.

### Rose Among Thorns

Owner identity and purchasing-authority identity must remain distinct propositions. A visit to another buyer cannot silently overwrite Theresa's owner relationship.

### Same-name non-match

Two businesses with the same or very similar display name must be capable of remaining separate subjects after explicit non-match adjudication.

### Smart Contacts removal

Removing Smart Contacts must leave reconciled subject projections, operational history, sales, routes, and relationships usable.

## 14. Non-goals for #788

- generic relationship role vocabulary — #790;
- generic Atlas Receive envelope — #789;
- bulk Elm Farm backfill — #793;
- universal Rounds — #792;
- assistant write cutover — #794;
- global cross-tenant identity;
- automated identity certainty from name/email similarity alone.

## 15. Hard invariants

1. Source records remain source records; they are not copied into Core and declared reality by default.
2. The durable Core identity anchor is a thin subject UUID, not a rich canonical profile row.
3. Identity properties are source-attributed claims or projections.
4. Similar names, emails, phones, or addresses are evidence, not sufficient identity proof by themselves.
5. Integrations may contribute identity evidence but may not own Atlas identity.
6. Identity ambiguity must remain ambiguous or enter review; Atlas may not guess merely to complete a write.
7. Identity corrections preserve prior assertions and adjudications.
8. Negative/non-match adjudications are retained.
9. Party/Person/Organization/Place are application projections over reconciled subjects.
10. Relationship roles and domain classifications do not belong in the identity subject.
11. Ordinary callers use Atlas Receive/identity contracts rather than mutating graph tables directly.
12. New migrations must satisfy Atlas post-cutover exact-source custody.

## 16. #788 implementation sequence

1. Define subject, source-record, claim/assertion, review, adjudication, and correction schemas.
2. Define confidence/consequence thresholds and identity-resolution outcomes.
3. Add append-only mutation guards for adjudication/correction history.
4. Add guarded service/owner resolution commands; ordinary user/assistant evidence remains routed through Receive.
5. Add stable Party/Person/Organization/Place read projections over reconciled subjects.
6. Add provenance drill-down APIs.
7. Register RPCs in Atlas RPC governance where applicable.
8. Add database/contract tests, including explicit non-match and mistaken-merge correction.
9. Prove Flowerama/Recinna, House of Flowers, and Rose Among Thorns fixtures without bulk backfill.
10. Only after parity proof, proceed to #793 progressive Elm Farm binding/backfill.
