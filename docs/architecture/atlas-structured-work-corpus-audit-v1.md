# Atlas Structured Work Corpus Audit — v1

Status: corpus-derived architecture recommendation. This document revises `atlas-structured-work-and-desk-projection-v0.md`. It is not yet schema implementation authority.

Audit date: 2026-09-07
Production project inspected: `zirqkouammpwxlqfbsvf`

## Purpose

Determine the smallest semantic grammar capable of representing the operational meaning of Atlas work without using prose as canonical semantics, while preserving enough structure for authority-aware Desk Projections to be rendered only at the final encounter boundary.

## Corpus inspected

Production `atlas.tasks`:
- 1,286 task rows
- 173 distinct `task_type` values
- all 1,286 rows contain metadata

Production `atlas.work_items`:
- 93 rows
- 23 non-null operation classes
- 71 rows still carry freeform `instructions`

Existing structured work infrastructure:
- 7,004 `work_execution_components` rows
- 232 distinct tasks with execution components
- 1,534 planned occurrences with execution components
- 4,606 `work_execution_relations` rows across 48 distinct tasks
- 120 `work_result_fields` rows across 6 distinct tasks
- 65 `work_requirements`, currently all typed only as `operational`
- populated time-contract, object-link, prerequisite, resource-requirement, notification-plan, work-definition, and result-policy rails

The audit enumerated every task type and every metadata key used by every production task type. The result is not a small collection of task-specific prose patterns. Atlas is already carrying a broad operational ontology, but much of that ontology is embedded in metadata keys and display strings rather than governed semantic components.

## Primary finding

The original hypothesis was directionally correct but the proposed Work Proposition box list was too flat.

The corpus does **not** want dozens of nullable fields on a task. It wants a small grammar with typed components and typed relations.

The most important correction is:

> Domain nouns are not separate universal boxes. A crop cycle, customer, room, order, mower, event, bed, document, person, and project are all **Referents** to canonical domain objects. Their domain truth stays in their own ledgers/tables. Work points to them by typed role.

Likewise, time, quantity, authority, readiness, and results cannot be buried in prose. They require semantic boxes because Atlas must reason over them before language exists.

## What the corpus proves is wrong today

### 1. Presentation has become storage

Common metadata keys include:
- `display_action`
- `display_subject`
- `display_location`
- `display_detail`
- `display_title`
- `detail_lines`
- `execution_do`
- `execution_how`
- `execution_done_when`
- `execution_place`
- `execution_statement`
- `worker_script`
- `outreach_script`
- `call_script`
- `weekly_sentence`

These are useful migration clues and source artifacts, but they are not a sound canonical semantic layer.

### 2. Evidence and instructions are conflated

Owner corrections, historical reconciliations, source precision, prior inferred state, repair notes, and truth-conflict information frequently live alongside worker-facing execution wording.

A canonical record carrying a fact does not make the fact part of a worker instruction.

### 3. Task identity and presentation grouping are conflated

One displayed Worker Day line may aggregate multiple real pieces of work. Conversely, one canonical task may contain multiple checklist steps, route stops, crops, destinations, or result fields.

A rendered title is therefore not a durable work identity.

### 4. Epistemic states are mixed

The corpus contains observed facts, owner assertions, derived state, forecasts, planned dates, projected biological windows, estimates, unresolved/unknown truth, and prior superseded claims. These are not interchangeable.

### 5. Governance dimensions are mixed

Assignment, responsibility, execution authority, release/readiness, decision jurisdiction, sharing, and display visibility appear in overlapping metadata. These must be independent.

### 6. Current structured components are useful but not constitutional

`work_execution_components` already represents objects, places, crop cycles, resources, materials, quantities, parameters, parties, contacts, states, tasks, channels, prices, schedules, and result fields, with typed relations such as `at`, `from`, `into`, `for`, `set_to`, `requires`, and `after`.

This is the right direction and should be evolved rather than replaced by a competing subsystem.

However:
- coverage is partial;
- `label` and `value_text` can still become prose dumping grounds;
- component kinds/roles are ad hoc rather than governed grammar;
- facts, plans, forecasts, rules, gates, provenance, and presentation are not universally distinguished;
- exposure classification is not first-class on every exposable semantic atom.

## Revised universal grammar

The production corpus can be represented with **ten canonical semantic boxes**, plus a separate governance membrane and a separate presentation layer.

These boxes describe grammar, not domain tables. A box can refer to a canonical domain object rather than copy its data.

### Box 1 — Work Act

What kind of human/institutional act is required.

Fields/concepts:
- `mode`
- `operation`
- optional operation variant/class

`mode` is mandatory because the corpus contains fundamentally different kinds of work:
- `change` — alter physical/digital/institutional reality
- `observe` — establish or refresh truth
- `decide` — choose/authorize a state or path
- `communicate` — contact, request, reply, publish
- `transfer` — move/custody/handoff/deliver
- `create` — produce an artifact or prepared output
- `plan` — arrange future work or resolve structure

Examples of `operation` include sow, transplant, mow, harvest, inspect, call, deliver, decide, publish, clean, pay, repair, measure, prepare, reconcile.

A title is not stored here.

### Box 2 — Referent

A typed pointer to an existing thing participating in the work.

Structure:
- `role`
- `referent_kind`
- `referent_id`

Roles discovered in the corpus include:
- subject / target
- source
- destination
- work location
- primary location
- party/contact/provider/customer
- order/event/project/commitment
- crop cycle
- material/resource
- parent/prerequisite/downstream work
- artifact/channel/service

The referent’s actual truth remains in its canonical domain. The Work record does not copy a customer, crop, room, event, or order into prose.

### Box 3 — Claim

One atomic assertion about a referent or work-relevant state.

Structure:
- subject referent
- predicate / dimension
- typed value or referenced value
- unit where applicable
- valid/effective interval
- **modality**
- source/provenance reference
- adjudication state

Required modality vocabulary:
- observed
- authoritative assertion
- derived
- planned
- forecast/projected
- estimated
- unknown

Required adjudication vocabulary/relations:
- accepted/current
- disputed
- superseded
- contradicts
- corrected by

This is where facts such as “confirmed treatment count = 0 as of Aug. 29” belong. The owner’s original sentence remains source evidence; it is not the canonical fact and not automatically exposable.

### Box 4 — Relation

A typed semantic edge between referents, claims, work acts, or components.

Examples already present or required by the corpus:
- at
- from
- into
- for
- adjacent_to
- affects
- preserves
- creates
- harvests
- depends_on
- follows / after
- parent_of / member_of
- supplies
- fulfills
- blocks
- results_in

This replaces relationships hidden inside prose or metadata keys.

### Box 5 — Specification

A typed scalar or categorical parameter that defines how much, what setting, what characteristic, or what bounded specification applies.

Structure:
- semantic key
- value kind
- value
- unit
- tolerance/range where relevant

Corpus examples:
- quantity/count
- spacing
- cut height
- depth
- pressure
- spray pattern
- coat number
- color
- price/currency
- tray/cell/container count
- seed quantity
- dimensions

This consolidates the current ad hoc `quantity`, `parameter`, and `price` component families into one governed scalar grammar while preserving semantic keys.

### Box 6 — Temporal Contract

Time is not one field. The corpus requires typed temporal semantics.

A Temporal Contract may contain:
- earliest lawful time
- not-before threshold
- preferred window
- latest satisfactory/lawful time
- hard finish
- event/commitment anchor
- expected duration range
- recurrence/rhythm
- minimum interval since prior occurrence
- biological/forecast window
- service date / planned placement
- movement policy

Crucially, planned placement, forecast, deadline, recurrence, and lawful eligibility are different meanings and cannot be represented as one `due_date` string.

Existing `work_time_contracts` should be treated as the strongest current precursor.

### Box 7 — Constraint

A rule that limits, conditions, protects, or qualifies execution.

Subtypes required by the corpus:
- method constraint
- policy constraint
- safety constraint
- physical condition
- weather/environment condition
- resource constraint
- presence/capability constraint
- preservation constraint (“preserve existing crop”)
- substitution constraint
- forbidden inference / truth-boundary rule

Safety constraints must be capable of mandatory disclosure independent of normal informational exposure when execution would otherwise be unsafe.

A Constraint is not the same thing as a Gate. It states the rule; a Gate evaluates whether the rule is presently satisfied.

### Box 8 — Requirement / Gate

A requirement states what must be true before or during execution. A gate is its evaluated state.

Requirement structure:
- requirement kind
- required referent/claim/work state/resource
- satisfaction rule
- consequence if unsatisfied

Gate structure:
- requirement reference
- current evaluation: satisfied / unsatisfied / needs check / unknown
- evidence/source
- evaluated_at

This covers:
- task prerequisites
- resource availability
- source readiness
- bed readiness
- owner decision required
- sales inventory gate
- external readiness
- crop readiness
- capability/presence holds

Existing `work_requirements`, `task_prerequisites`, and resource requirements should converge conceptually here. A prose `summary` cannot be the requirement semantics.

### Box 9 — Composition

How multiple work atoms are arranged into an executable structure without changing their canonical identity.

Subtypes required by the corpus:
- sequence
- checklist
- conditional branch
- option/decision branch
- batch
- round
- route
- collection
- parent/child grouping
- serial queue
- paired work
- recurring family

This is the box the first hypothesis was missing most clearly.

It explains why one Worker Day line can group two work acts without becoming a new canonical fact, and why a Farm Round, delivery route, outreach batch, or planting cohort can be presented as one instrument while retaining distinct source work.

### Box 10 — Result Contract

What evidence/result is required for the work to be considered successfully reported, accepted, or transitioned.

Structure:
- acceptance mode
- required result fields
- allowed outcome choices
- quantitative result measures
- evidence requirements
- resulting state transitions / consequences
- completion authority

Result fields are typed, not prose:
- choice
- number + unit
- boolean
- reference
- observation/claim
- artifact
- text only when the result is intrinsically textual, not as a substitute for structure

The corpus proves this must be first-class: germination, harvest, transplant, inventory, outreach, weed condition, readiness, and preparation all close differently.

A result may create a new Claim, Relation, state transition, inventory movement, or downstream requirement. “Done” alone is not the universal result model.

## Separate membrane — Governance

Governance is not another Work component. It determines who may own, act on, decide about, and see the semantic components above.

It must keep these dimensions separate:

1. organization / operating unit jurisdiction
2. responsibility
3. assignment / intended executor
4. execution authority
5. decision authority
6. release/executability authority
7. exposure classification
8. Exposure Envelope for the institutional person

### Exposure classification

Every component capable of crossing a human-facing boundary must have an exposure class or inherit one from canonical domain truth. Unclassified means non-exposable.

The employee’s Exposure Envelope defines the maximum classes and scopes Atlas may consider disclosing.

Examples of scope:
- this assigned work only
- directly related work context
- team
- operating unit
- organization

Authorization permits disclosure; it does not compel it.

## Separate layer — Desk Projection

A Desk Projection is not canonical work and must not be stored as the authoritative meaning of the task.

Pipeline:

```text
Canonical domain truth
+ canonical Work grammar
+ current responsibility/authority
+ Exposure Envelope
+ encounter context
        ↓
Disclosure membrane
        ↓
minimum necessary semantic subset
        ↓
Desk Projection
        ↓
language / visual rendering
```

The renderer receives only the authorized Desk Projection.

It never receives the owner’s full canonical record and attempts to redact it afterward.

A Desk Projection may render:
- title
- instruction sentence
- location
- quantity
- time
- method
- prerequisite
- reason
- outcome/report request

but those strings are generated at the last moment from already-authorized typed components.

## What should NOT become universal boxes

The corpus contains many domain nouns, but these should remain canonical domain entities referenced by Box 2 rather than becoming nullable columns on every Work record:
- crop cycle
- bed / room / place
- customer / vendor / employee
- order
- community event
- project
- resource
- inventory lot
- financial account
- content asset
- training material
- service provider

Likewise, the following should not become canonical semantics:
- display title
- display detail
- worker sentence
- owner sentence
- AI summary
- UI label

Labels are renderable aliases of canonical referents/components, not the truth itself.

## What existing Atlas infrastructure should survive

The audit recommends evolving, not replacing, these rails:
- `work_items` as durable work identity/lifecycle, after prose loses semantic authority
- `work_definitions` as reusable operation templates, after title templates become presentation-only
- `work_execution_components` as the precursor to Referents + Specifications + selected semantic components
- `work_execution_relations` as precursor to typed Relations/Composition edges
- `work_time_contracts` as canonical Temporal Contract precursor
- `work_requirements` + task prerequisites + resource requirements as Requirement/Gate precursors
- `work_result_fields` + result policies as Result Contract precursors
- canonical domain tables as the source of referent truth

Do **not** build another parallel “structured task” subsystem beside these.

## What must change structurally

1. `work_items.title` may remain as a compatibility/display cache, but cannot be authoritative work semantics.
2. `work_items.instructions` must become legacy/source evidence, not a field employee surfaces are permitted to render directly.
3. freeform `display_*`, `execution_*`, `detail_lines`, scripts, and instruction prose in task metadata must be treated as migration/source artifacts unless their content is intrinsically textual.
4. component grammar needs governed type/role vocabularies rather than open-ended ad hoc strings.
5. components/claims need explicit epistemic modality and provenance/adjudication.
6. exposure classification must be first-class before any employee projection can consume a component.
7. Desk Projections must be server-derived and must never include rejected canonical data in browser payloads.
8. language generation occurs after exposure/relevance selection, never before.

## Corpus-derived invariants

> Atlas stores semantics before sentences.

> A sentence may be evidence or presentation; it is not a substitute for typed operational meaning.

> A task does not own the truth of the objects it references.

> A rendered title is not work identity.

> A grouping does not merge the identity or authority of the work it groups.

> Planned, forecast, inferred, observed, asserted, and unknown are distinct epistemic states.

> A constraint is not a gate; a gate is the current evaluation of a constraint or requirement.

> A result is not merely completion; it is governed evidence capable of changing canonical reality.

> Linkage does not grant disclosure.

> Unclassified information is non-exposable.

> The language renderer may only see the already-authorized Desk Projection.

## Recommended next implementation boundary

Before any broad migration, prove the grammar vertically on Worker Day:

1. choose a small but diverse set of existing work families (treatment, harvest, transplant, observation, delivery, event setup, outreach);
2. represent each using the ten boxes above while retaining current canonical source records;
3. classify exposable components;
4. derive an employee Desk Projection from the worker’s Exposure Envelope;
5. render the task title/instructions from that projection;
6. prove that owner provenance and unrelated commercial/financial truth never enter the payload;
7. compare rendered output with current operational needs;
8. only then define the canonical migration plan in `noel-core-db`.

The corpus audit found no need for a separate universal “task prose” field. It found a need for a governed semantic grammar plus a late-bound presentation layer.