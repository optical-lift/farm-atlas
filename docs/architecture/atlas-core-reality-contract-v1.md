# Atlas Core Reality Contract v1

**Status:** Proposed governing architecture for Atlas Core

**Purpose:** Define what every Atlas account owns, how reality enters Atlas, and the boundary between Atlas Core, Atlas domain systems, and external integrations.

## Governing premise

> **Atlas owns the organization's operational reality. Integrations observe, enrich, communicate with, or act upon that reality. They do not become the reality model themselves.**

Atlas must remain intelligible and operational if any optional integration is disconnected. An integration may contribute evidence or perform an authorized action, but it may not own the canonical identity of an Atlas person, organization, place, relationship, commitment, event, or work object.

## Universal Atlas Core

Every Atlas organization receives the same small set of primitives regardless of industry.

- **Organization / account** — whose world Atlas is stewarding.
- **Party** — a canonical participant in that world.
- **Person** — a human party.
- **Organization entity** — a business, church, nonprofit, vendor, customer, institution, or other organized party.
- **Place** — a physical or operational location.
- **Relationship** — how two parties currently relate.
- **Contact point** — email, phone, address, website, or other reachable endpoint.
- **Observation** — source-attributed evidence received by Atlas.
- **Event** — a reconciled occurrence in the world.
- **Projection** — Atlas's current derived understanding from applicable events and observations.
- **Commitment** — an obligation, promise, order, appointment, pledge, deadline, or other future-bound state.
- **Work** — tasks, projects, service work, and execution obligations.
- **Route / round** — ordered physical movement through a set of places or relationships for a purpose.
- **Provenance** — why Atlas believes, presents, or acts on any fact.

Domain systems may specialize these primitives. They may not replace them with a second canonical identity or history system.

## Evidence, event, projection

Atlas must distinguish three levels that are currently too often mixed together.

### Evidence

A source says, reports, imports, observes, or measures something.

Example: `Katie reports that Kim bought two Teddy sunflower bundles.`

Evidence is preserved with source, time, custody, and attribution. Later disagreement does not erase the evidence.

### Event

Atlas determines the real-world occurrence represented by the evidence.

Example: `A flower sale occurred at Schaffitzel's on 2026-09-04.`

Events may have corrections, cancellations, supersessions, corroborating observations, or unresolved conflicts. Atlas must preserve those transitions rather than mutating history into a false single version.

### Projection

Atlas derives what currently governs.

Example: `Schaffitzel's is an active repeat buyer; last purchase 2026-09-04; Teddy sunflower preference demonstrated.`

A projection is a read model, not the historical record. It may change as evidence and events change.

## One front door for incoming reality

No source, interface, assistant, integration, or domain module may be required to understand Atlas's internal storage topology in order to report reality.

Incoming reality must enter through an Atlas-owned receive contract that can accept a source-attributed observation and then allow Atlas to:

1. preserve the observation;
2. resolve the subject and other identities;
3. classify source authority;
4. reconcile the observation with existing events and governing state;
5. invoke appropriate domain contracts when required;
6. update projections;
7. expose consequences to work, commitments, routes, and future decisions.

The sender reports what it observed. **Atlas decides where that observation belongs.**

## Canonical identity belongs to Atlas

Atlas must own canonical identities for people, organizations, and places.

External systems attach through external identity links such as:

- Gmail address or message participant;
- Stripe customer ID;
- Smart Contacts / Elm Local entity ID;
- accounting-system customer ID;
- calendar attendee identity;
- imported contact ID.

An external identifier may help resolve a party. It may never be the primary identity on which Atlas Core depends.

Disconnecting an integration must not delete the Atlas party, relationship, events, commitments, route history, or operational history that remain valid in Atlas.

## Integration authority classes

Every integration contribution must declare an authority class.

### Evidence only

`We observed X.`

Examples: sent email, received message, public website observation.

### Enrichment

`We believe this additional property or relationship may describe X.`

Examples: likely buyer name, business category, public phone, inferred market fit.

### Action result

`An authorized action was performed and this is the result.`

Examples: email sent, payment request created, route stop completed in an external system.

### Authoritative source

`This external system has explicitly been designated to govern this specific field or state.`

Examples may include a payment processor's settlement state for its own payment transaction. Authority is narrow and field-specific; it does not make the provider authoritative over the entire Atlas relationship.

## Product layers

Atlas product architecture has three distinct layers.

### Atlas Core

Universal identity, relationships, reality history, provenance, work, commitments, time, and routes.

### Atlas domain systems

Atlas-native specializations that add domain meaning without replacing Core primitives.

Examples:

- Flower Commerce
- Field Service
- Fundraising
- Production
- Events
- Property Maintenance

### Integrations

External systems or optional intelligence engines that contribute evidence, enrichment, or actions.

Examples:

- Gmail
- Google Calendar
- Stripe
- Smart Contacts, powered by Elm Local
- weather providers

A feature must be classified into one of these layers before new schema or application surfaces are introduced.

## Universal relationship read guarantee

For every canonical party or relationship, Atlas must be able to answer one question without table-specific archaeology:

> **What is going on with this person or organization?**

The canonical read surface must be able to return, when applicable:

- identity and aliases;
- current relationship state;
- known people and roles;
- chronological event timeline;
- communications;
- purchases / payments / giving / service history through domain projections;
- route / visit history;
- commitments and unresolved loops;
- current preferences or operating facts;
- provenance and confidence;
- recommended or due next action, when Atlas is authorized to determine one.

Specialized screens may filter this surface. They must not create parallel relationship histories.

## Routes / rounds are Core

A route is not a florist-specific or sales-specific feature.

A route records:

- purpose;
- assignee;
- time window;
- planned stops;
- sequence;
- intended action at each stop;
- actual stop disposition;
- encounters and outcomes;
- unresolved follow-up.

A florist round, water-filtration service route, delivery run, property inspection route, and missionary church trip use the same Core route grammar. Domain systems determine which context appears at the doorstep.

## Agent and UI write rule

Ordinary application and assistant writes must use Atlas contracts, not direct projection-table mutation.

Raw Supabase access is an administrative/development capability, not the normal memory path.

When a user tells an Atlas-connected assistant new operational reality, the assistant should submit an observation through the Atlas receive contract or an Atlas domain contract. It should not independently decide which internal table or JSON metadata key should be updated.

## Integration independence rule

> **An integration may enrich Atlas's world but may never own an Atlas entity's identity. Disconnecting an integration must not erase the organization's valid history or relationships.**

## Intake independence rule

> **No source, interface, assistant, integration, or domain module may be required to understand Atlas's internal storage topology in order to report reality. Sources report observations through contracts. Atlas alone resolves identity, reconciles governing state, and determines operational consequences.**

## Migration implication

Existing Elm Farm data that violates these boundaries is migration evidence, not a reason to preserve the violation.

Current reconstruction tables, embedded JSON history, domain-specific identity rows, and `local_intel` identity dependencies must be migrated into this model with provenance retained and destructive rewriting avoided.

## Non-goals

This contract does not prescribe final table names, UI visual design, or a single reconciliation algorithm for every domain. It defines the invariant boundaries those implementations must satisfy.
