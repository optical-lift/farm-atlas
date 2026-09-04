# Atlas Receive and Reconciliation v1

**Status:** Proposed implementation contract

**Depends on:** `atlas-core-reality-contract-v1.md`

## Problem

Atlas currently contains several strong domain-specific write contracts, but there is no universal intake spine. New facts can arrive through chat, worker UI, Messages, email, Stripe, imports, route reports, or domain workflows and end up represented differently depending on which code path or assistant handled them.

This contract defines the common receive layer that sits ahead of domain reconciliation.

## Receive envelope

Every incoming observation should be representable by an Atlas-owned envelope with the following conceptual fields.

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

### Observation semantics

- `observation_kind`
- `direction` when relevant
- `actor_hint`
- `counterparty_hint`
- structured values
- freeform note / body evidence
- domain hint, if the source already knows the domain

The receive contract must permit incomplete or ambiguous identity. Ambiguity becomes work for identity resolution, not a reason to discard evidence.

## Pipeline

### 1. Admit

Validate custody, schema version, provenance, size, idempotency, and source permissions. Preserve the source-attributed observation before attempting to promote it to governing state.

### 2. Resolve identity

Attempt to map subject hints to canonical Atlas parties, places, relationships, route stops, or domain objects.

Resolution outcomes:

- `resolved`
- `probable_match`
- `ambiguous`
- `new_candidate`
- `unresolved`

Ambiguous or consequential merges go to a review queue. Atlas must not fabricate identity merely to make the pipeline complete.

### 3. Determine authority

Classify the observation as one of:

- evidence only;
- enrichment;
- action result;
- narrow authoritative source.

Authority is scoped. A provider may govern one state without governing the whole relationship.

### 4. Reconcile occurrence

Determine whether the observation represents:

- a new event;
- corroboration of an existing event;
- source-state enrichment of an existing event;
- a correction;
- a cancellation;
- a supersession;
- a contradiction/conflict requiring review;
- information that affects a projection but does not establish an event.

Reconciliation must be idempotent and preserve the evidence graph.

### 5. Invoke domain adapter

If the occurrence has domain semantics, call the appropriate Atlas-owned domain contract.

Examples:

- a flower purchase -> Flower Commerce sale contract;
- route arrival -> Operational Route event contract;
- technician repair -> Field Service event contract;
- pledge -> Fundraising commitment contract;
- email -> Communication evidence contract.

The receive layer does not duplicate the domain ledger. It links the observation and reconciled occurrence to it.

### 6. Project current state

Update or invalidate the relevant read projections:

- entity / relationship timeline;
- current relationship position;
- buyer / donor / service profile;
- open loops;
- route status;
- next-action eligibility;
- domain-specific summaries.

Projection logic must be reproducible from retained evidence/events plus governing rules.

## Corrections and contradictions

Atlas must prefer explicit correction and supersession over destructive mutation.

The current Flower Commerce correction behavior is the model: an incorrect sale may remain preserved as a historical assertion while a cancellation/correction record causes it to cease governing current commercial truth.

The receive layer must support the same grammar outside commerce.

Example:

1. Observation A: `House of Flowers buyer is Donovan.`
2. Later observation: `Donovan is deceased; current buyer unknown.`
3. Atlas preserves both observations.
4. The relationship projection must no longer present Donovan as current buyer.
5. The unresolved buyer identity becomes an open loop.

## Assistant contract

An Atlas-connected assistant must never need to know that a fact belongs in `buyer_contact_events`, a JSON metadata field, a relationship reconstruction row, or a sales table.

Normal assistant flow:

1. interpret the user's statement into a receive envelope;
2. submit it to Atlas;
3. inspect the receive result;
4. report whether Atlas resolved, reconciled, queued, or rejected it.

Direct SQL remains available only for architecture development, migration, diagnosis, and controlled repair.

## Read contract

The receive contract is incomplete without a canonical read path.

Required read surfaces:

### Party / relationship current position

Returns the current governing relationship state and its supporting provenance.

### Party / relationship timeline

Returns a chronological union of relevant reconciled events and linked source observations without requiring the caller to know domain tables.

### Open loops

Returns unresolved commitments, follow-ups, identity questions, promised actions, and route carry-forwards.

### Source drill-down

Allows the user to inspect why Atlas believes a presented fact.

## Initial acceptance fixtures

The first implementation must pass these Elm Farm fixtures because they exercise different failure modes.

### Flowerama / Recinna

- in-person visit by Katie;
- no purchase but positive relationship signal;
- college class visit interest;
- later Elm Farm email follow-up;
- email source may initially be user-reported and later corroborated by actual mailbox evidence;
- no duplicate event when corroborating source arrives.

### Schaffitzel's corrected sale

- initial incorrect sale assertion;
- corrected final sale;
- old assertion retained;
- current projection counts only the valid $20 sale;
- relationship and product history reflect the corrected products.

### Linda's / Josh

- historically strong buyer;
- current no-purchase visit must not become rejection;
- availability-list interest remains current;
- route visit history is visible.

### House of Flowers

- old buyer identity becomes invalid;
- current buyer unresolved;
- route objective is `identify current buyer`;
- new identity observation should resolve the open loop when confirmed.

### Rose Among Thorns / Theresa

- owner known but temporarily unavailable;
- visit may discover another authorized buyer;
- Atlas must distinguish owner identity from current purchasing authority.

### Mama Jean's / Jandyn

- Jandyn handles floral ordering but lacks approval authority;
- category-manager approval is an open dependency;
- a route visit or call should update the dependency rather than flattening the relationship to yes/no.

### Zimmerman Meats / Kendall

- telephone follow-up rather than physical stop;
- Kendall was to ask owner about resale;
- next contact resolves a promised internal decision.

## Implementation constraints

- append evidence before promotion;
- idempotency at the receive boundary;
- no silent destructive overwrite of source evidence;
- canonical Atlas identity before stable cross-domain projection;
- unresolved identity may not be guessed;
- domain ledgers remain authoritative for their own event semantics;
- integrations must not mutate projections directly;
- read models must expose provenance.

## Exit gate for v1

Atlas Receive v1 is viable when a caller can submit the same factual observation through two different source channels and Atlas can:

1. preserve both source observations;
2. resolve them to the same Atlas party/relationship when justified;
3. reconcile them to one real-world event when justified;
4. avoid duplicate operational consequences;
5. expose the event in one canonical timeline;
6. update the current projection correctly;
7. show the provenance chain on request.
