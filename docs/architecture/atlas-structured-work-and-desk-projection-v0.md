# Atlas Structured Work and Desk Projection — Working Hypothesis v0

Status: working architecture hypothesis for corpus audit, not implementation authority.

Purpose: stop using prose as canonical operational semantics and stop treating record linkage as disclosure permission.

## Governing laws

1. Atlas stores reality as typed components. Human language is an output format.
2. Canonical prose is non-authoritative by default. Original prose may remain as source evidence, correspondence, observation, or provenance, but compound operational meaning must be decomposable into typed claims and relationships.
3. Institutional information is non-exposable by default. Assignment, linkage, relevance, possession, or technical availability does not grant disclosure.
4. Employee surfaces never receive raw canonical records and hide fields after retrieval. They receive an already-authorized Desk Projection.
5. Authorization permits disclosure; it does not compel disclosure. Atlas still selects the minimum useful information for the encounter.
6. Unclassified information is non-exposable.
7. A rendered task title is presentation, not canonical work identity.

## Proposed pipeline

```text
Source artifact
  ↓
Typed claims
  ↓
Adjudicated reality
  ↓
Relationships + state
  ↓
Work proposition
  ↓
Responsibility / execution authority
  ↓
Exposure envelope
  ↓
Encounter assembly
  ↓
Desk projection
  ↓
Human language
```

## Initial component hypothesis

This is deliberately provisional. The production task corpus will be decomposed against it and the box set revised before schema work begins.

### Reality fact components

- subject
- attribute / state dimension
- value
- unit
- observed_at / effective_at
- source
- confidence / authority status
- supersedes / contradicts

### Relationship components

- relation type
- source object
- target object
- effective interval

### Work proposition components

- operation
- subject
- target / desired state
- source
- destination
- quantity
- unit
- method
- tool
- material
- sequence
- prerequisite
- condition / trigger
- not_before
- deadline / time window
- location
- handoff
- expected result
- result measure
- reporting requirement

### Governance components

- organization
- responsibility holder
- execution authority
- jurisdiction
- visibility / exposure class
- provenance

### Desk projection components

A Desk Projection is a derived, encounter-specific object. It may contain only components allowed by the person’s Exposure Envelope and selected as necessary for the current encounter.

Possible worker-facing components:

- rendered title
- worker-safe action
- worker-safe subject label
- worker-safe location
- worker-safe quantity
- worker-safe timing
- worker-safe method
- worker-safe prerequisite
- worker-safe reason, only when authorized and necessary
- required result / response

The language renderer must receive only the Desk Projection, never the full canonical record.

## Immediate audit question

Can every real Atlas task be losslessly represented as small typed components without relying on prose for operational semantics?

The audit must identify:

- component categories missing from this hypothesis;
- task families whose semantics are currently hidden inside titles, instructions, metadata strings, or nested JSON;
- facts that are evidence/provenance rather than worker instructions;
- presentation groupings that are currently mistaken for canonical work identity;
- components requiring independent exposure classification;
- domains that require specialized result or state vocabularies.

No production schema or task writer should be changed from this document alone. The next step is a production corpus census and decomposition report.