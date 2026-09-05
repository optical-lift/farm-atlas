# Atlas Receive and Reconciliation v1

**Status:** Proposed implementation contract

**Depends on:**
- `atlas-core-reality-contract-v1.md`
- `atlas-core-identity-reconciliation-v1.md`

## Governing premise

Atlas Receive is the semantic adjudication membrane between sources and governing operational reality.

A source reports evidence. A source does not choose Atlas storage, create governing domain state, or decide which consequences should exist. Atlas Receive preserves the evidence, resolves shared identity, asks the relevant domain interpreters what the evidence may mean, reconciles those proposals once around a shared occurrence, and commits the legitimate consequences through the owning domain contracts.

The governing sequence is:

```text
evidence
  -> custody
  -> identity resolution
  -> domain interpretation proposals
  -> occurrence reconciliation
  -> canonical consequences
  -> projections
```

Receive owns orchestration and reconciliation. Domains own domain semantics. Integrations and assistants own neither.

This deliberately rejects two failure modes:

1. **Caller-directed storage:** the source/assistant chooses tables or JSON conventions.
2. **Distributed raw interpretation:** every domain independently interprets uncontrolled source evidence and creates unrelated consequences.

Atlas must receive a fact once and know how to coordinate what it means without becoming a giant domain-specific rule engine.

## Problem

Atlas already contains several strong domain-specific write contracts, but incoming reality can arrive through chat, worker UI, Messages, email, Stripe, imports, route reports, Smart Contacts, or domain workflows and be represented differently depending on which code path or assistant handled it.

Without one adjudication membrane:

- the same occurrence can be recreated by several subsystems;
- separate domains can resolve the same identity differently;
- corrections must be understood independently by every consumer;
- assistants become part of the schema-routing logic;
- provenance and authority can be lost as evidence is translated into state.

Receive exists to prevent those failures.

## Receive envelope

Every incoming observation must be representable by an Atlas-owned envelope.

### Custody

- `observation_id`
- `received_at`
- `occurred_at` when known
- `source_kind`
- `source_system`
- `source_event_ref` when available
- `source_actor_ref` when available
- `source_authority`
- `capture_mode`
- `idempotency_key`
- raw or attributed source payload / evidence reference

The evidence is preserved before Atlas attempts to determine what operational reality it supports.

### Subject hints

The sender may provide identity hints without resolving Atlas identity itself:

- person name
- organization name
- email
- phone
- address
- website
- external provider ID
- route stop ID
- relationship hint
- domain object hint

Ambiguity is permitted at intake. It becomes evidence for Core identity reconciliation, not a reason to invent a canonical identity.

### Observation semantics

- `observation_kind`
- `direction` when relevant
- `actor_hint`
- `counterparty_hint`
- structured values
- freeform note / body evidence
- domain hint, when a source has legitimate knowledge of likely domain relevance

A domain hint is advisory. It is not permission for the source to govern the domain.

## Receive responsibilities

### 1. Admit and preserve

Validate custody, schema version, provenance, source permissions, size, and idempotency.

Preserve the source-attributed evidence before semantic promotion.

Receive must be able to say:

- admitted;
- duplicate source delivery;
- malformed;
- unauthorized;
- rejected with reason.

### 2. Resolve shared identity

Translate identity hints and provider/source identities into the evidence-first identity reconciliation graph established by #788.

Possible outcomes include:

- `resolved`
- `probable_match`
- `ambiguous`
- `new_subject_candidate`
- `non_match`
- `unresolved`

Consequential uncertainty goes to Core identity review. Receive does not permit individual domain interpreters to independently manufacture a second identity for the same source evidence.

Party/Person/Organization/Place remain downstream projections over reconciled identity evidence.

### 3. Determine source authority

Classify the evidence under a scoped authority contract, such as:

- evidence only;
- enrichment;
- action result;
- narrow authoritative source.

Authority is always scoped. Gmail may prove that an email occurred without governing the current buyer relationship. Stripe may govern settlement state without governing customer identity. Smart Contacts may contribute enrichment without owning any Atlas subject.

### 4. Select candidate domain interpreters

Receive determines which Atlas-owned domain interpreters are relevant enough to inspect the evidence.

Examples:

- Flower Commerce
- Communications
- Relationships
- Rounds / Routes
- Inventory
- Field Service
- Fundraising
- Commitments / Work

Receive itself must not grow domain-specific `if sunflower`, `if donation`, or `if repair` logic. Domain meaning remains implemented behind governed domain contracts.

### 5. Ask domains for semantic proposals

A domain interpreter reads the admitted evidence plus resolved identity/context and returns a proposal. It does not directly mutate its ledger during interpretation.

Examples:

```text
Flower Commerce proposal:
  evidence supports a sale of 4 closed sunflower bundles at $7.50

Rounds proposal:
  evidence supports completion of planned stop S

Relationships proposal:
  evidence supports a successful buyer encounter

Inventory proposal:
  inventory consequence should derive from the accepted sale semantics
```

A proposal must declare:

- proposed occurrence kind;
- subject/object identities it relies on;
- evidence references;
- confidence / authority requirements;
- whether it believes the occurrence is new or refers to an existing occurrence;
- proposed domain consequence;
- idempotency / deduplication key where possible;
- dependencies on another domain consequence.

### 6. Reconcile occurrence identity once

Receive owns shared occurrence identity.

It determines whether the admitted evidence and interpreter proposals represent:

- a new real-world occurrence;
- corroboration of an existing occurrence;
- source-state enrichment of an occurrence;
- correction;
- cancellation;
- supersession;
- contradiction/conflict requiring review;
- insufficient evidence to establish an occurrence;
- evidence relevant only to a projection.

One occurrence may legitimately produce several domain consequences. Those consequences must remain linked to the same occurrence and source evidence rather than becoming unrelated records that merely happened to be created at the same time.

Identity reconciliation and occurrence reconciliation remain distinct. Atlas may know that two records concern Flowerama without concluding that two communications are the same message.

### 7. Reconcile domain proposals

Receive coordinates proposals before mutation.

It must prevent:

- two interpreters from creating duplicate versions of the same consequence;
- one interpreter from silently contradicting another's dependency;
- domain consequences from using different identities for the same participant;
- corrections from producing a new occurrence when they actually amend or supersede an existing one.

When proposals conflict materially and policy cannot resolve the conflict safely, Receive preserves the evidence and queues adjudication rather than forcing a complete transaction.

### 8. Commit through owning domain contracts

Only after reconciliation does Receive invoke the authoritative domain commands.

Examples:

- Flower Commerce creates/corrects/cancels a sale;
- Rounds records a completed encounter or route event;
- Communications records source-attributed communication evidence;
- Commitments records a promised next action;
- Inventory derives movement from accepted commerce/production semantics.

Receive does **not** become a duplicate domain ledger.

Domain mutations should be committed as one governed consequence set where transactional boundaries permit it. If true atomicity across consequences is impossible, the receipt must expose partial completion and recovery state explicitly rather than pretending the occurrence reconciled completely.

### 9. Project current state

Accepted domain events and reconciled occurrence identity drive projections such as:

- Party/Person/Organization/Place representations;
- subject / relationship timeline;
- current relationship position;
- buyer / donor / service profile;
- open loops;
- route status;
- next-action eligibility;
- domain-specific summaries.

Projection logic must remain reproducible from retained evidence, reconciled occurrences, domain events, and governing rules.

## The occurrence graph

Receive should treat a real-world occurrence as a durable coordination anchor, not as another canonical profile row.

Conceptually:

```text
Observation A ----\
                  \
Observation B -----> Occurrence X
                  /      |
Correction C ----/       +--> Flower Commerce consequence
                         +--> Round consequence
                         +--> Relationship consequence
                         +--> Commitment consequence
```

Evidence can accumulate around the same occurrence over time.

The occurrence anchor exists so that Atlas can answer:

- which evidence supports this event;
- which consequences came from it;
- whether later evidence corrected or contradicted it;
- whether two apparent records are actually one real-world occurrence.

It must not become a replacement for the owning domain ledgers.

## Corrections and contradictions

Corrections are centralized at the reconciliation membrane.

If later evidence says an earlier occurrence was misstated, Receive determines which occurrence is being corrected and coordinates the appropriate domain correction semantics.

The Schaffitzel's August 28 sale is the governing example:

1. initial evidence supported `$25 / celosia`;
2. later evidence corrected it to `$20 / goldenrod`;
3. the original assertion remains preserved;
4. the correction addresses the same real-world occurrence;
5. Flower Commerce applies its append-only correction/cancellation semantics;
6. dependent projections consume the corrected governing occurrence rather than re-interpreting both raw reports independently.

The same principle applies to identity and relationships.

Example:

1. Observation A: `House of Flowers buyer is Donovan.`
2. Later evidence: `Donovan is deceased; current buyer unknown.`
3. Both source observations remain preserved.
4. Core identity/relationship interpretation no longer presents Donovan as current buyer.
5. The unresolved buyer becomes a current open loop.

## Assistant contract

An Atlas-connected assistant must never choose whether a report belongs in `buyer_contact_events`, relationship reconstruction metadata, an identity assertion table, a flower sale table, a route table, or a task table.

Normal assistant flow:

1. translate the user's report into one Receive envelope;
2. submit it once;
3. inspect the receipt;
4. report what Atlas admitted, resolved, reconciled, committed, queued, or rejected.

Example user report:

```text
Katie says Linda's took two bundles and Josh wants more next Friday.
```

A successful Receive result might describe:

```text
one admitted source observation
resolved subjects: Katie, Linda's Flowers, Josh
one reconciled encounter
one commerce consequence
one relationship consequence
one future commitment
one receipt linking all consequences to the same occurrence/evidence
```

The assistant supplies evidence and source attribution. Atlas determines operational consequences through its governed interpreters and reconciliation membrane.

Direct SQL remains architecture/migration/diagnostic tooling, not normal organizational memory.

## Read contract

Receive is incomplete without read surfaces that expose the reconciled world without requiring callers to know storage topology.

Required surfaces include:

### Identity projection

Current usable Party/Person/Organization/Place representation plus relevant confidence/warnings.

### Subject / relationship current position

Current governing relationship state and supporting provenance.

### Subject / relationship timeline

Chronological view of reconciled occurrences/domain events and linked source observations.

### Occurrence drill-down

For one occurrence, expose:

- supporting and conflicting evidence;
- resolved identities;
- domain consequences;
- corrections/supersessions;
- unresolved questions;
- provenance.

### Open loops

Unresolved commitments, follow-ups, identity questions, promised actions, and route carry-forwards.

### Source drill-down

Why Atlas believes a presented fact or association.

## Initial acceptance fixtures

### Flowerama / Recinna

- Katie's in-person visit and later Elm Farm follow-up are distinct occurrences;
- legacy buyer record, route evidence, communication participants, and Smart Contacts evidence may resolve to the same Flowerama subject when justified;
- Recinna remains a distinct person subject;
- later mailbox evidence corroborating the already-reported email must not create a duplicate email occurrence or duplicate relationship consequence.

### Schaffitzel's corrected sale

- original incorrect assertion remains evidence;
- later correction resolves against the same occurrence;
- Flower Commerce's valid correction machinery governs commercial truth;
- current projections count only the valid $20 sale and corrected products;
- dependent domains do not independently reinterpret the obsolete evidence as another sale.

### Linda's / Josh

- a no-purchase visit must not become rejection;
- availability-list interest remains current;
- route encounter, commercial outcome, relationship signal, and follow-up can be distinct consequences of one encounter occurrence.

### House of Flowers

- business identity may resolve while current buyer remains unknown;
- stale buyer evidence remains inspectable without governing current position;
- `identify current buyer` remains an open loop until sufficient evidence resolves it.

### Rose Among Thorns / Theresa

- owner identity and purchasing authority remain distinct semantics;
- another buyer discovered during a visit does not overwrite Theresa's owner identity.

### Mama Jean's / Jandyn

- Jandyn handles ordering but category-manager approval remains a separate dependency;
- new contact evidence updates that dependency rather than flattening the relationship to yes/no.

### Zimmerman Meats / Kendall

- telephone follow-up can resolve a promised internal decision without pretending a physical route encounter occurred.

## Implementation constraints

- preserve evidence before promotion;
- idempotency at the Receive boundary;
- shared identity resolution before consequential cross-domain commit when identity matters;
- domain interpreters propose semantics but do not directly mutate during interpretation;
- Receive owns occurrence reconciliation and consequence coordination;
- domain ledgers remain authoritative for their own event semantics;
- integrations and assistants never mutate projections directly;
- no silent destructive overwrite of evidence;
- unresolved identity or semantic conflict may remain unresolved;
- corrections/supersessions address existing occurrence identity when appropriate;
- one occurrence may have many consequences, but each consequence must retain provenance to that occurrence/evidence;
- read models must expose provenance and correction history.

## Exit gate for v1

Atlas Receive v1 is viable when a caller can report one real-world situation without choosing Atlas storage and Atlas can:

1. preserve the source evidence once;
2. resolve shared identity without domain-specific identity invention;
3. solicit relevant domain interpretations;
4. reconcile those interpretations around the correct real-world occurrence;
5. distinguish new occurrence, corroboration, correction, conflict, and insufficiency;
6. commit all legitimate consequences through their owning domain contracts without duplicates;
7. return one stable receipt describing the whole adjudication;
8. expose one provenance chain from source evidence through occurrence to domain consequences and current projections.

The governing product test is:

> I tell Atlas something once. Atlas determines what happened, what it means in each legitimate domain, and what must change—without the caller knowing where any of it is stored.
