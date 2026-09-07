# Atlas Structured Work Migration — V1

Status: **selected implementation plan**

Date selected: 2026-09-07

This document is the execution ledger for replacing prose-first operational work with structured semantics, introducing authority-aware disclosure, and rebuilding employee work presentation on Desk Projections.

It governs implementation across passes. It should be read together with:

- `docs/architecture/atlas-structured-work-and-desk-projection-v0.md` — pre-audit hypothesis
- `docs/architecture/atlas-structured-work-corpus-audit-v1.md` — production-corpus-derived grammar

The corpus audit supersedes the v0 box list where they differ. This file governs **how the selected architecture is implemented**.

---

# 1. Governing outcome

Atlas must stop storing operational intelligence primarily as sentences and then attempting to recover structure, authority, and relevance from prose.

The required direction is:

```text
SOURCE REALITY
human statement / integration / observation / domain record

        ↓

TYPED CLAIMS + DOMAIN TRUTH

        ↓

CANONICAL WORK GRAMMAR
1. Work Act
2. Referent
3. Claim
4. Relation
5. Specification
6. Temporal Contract
7. Constraint
8. Requirement / Gate
9. Composition
10. Result Contract

        ↓

GOVERNANCE
responsibility + execution authority + decision authority + exposure

        ↓

ENCOUNTER ASSEMBLY

        ↓

DESK PROJECTION
minimum necessary authorized semantic subset

        ↓

HUMAN LANGUAGE / VISUAL PRESENTATION
```

The employee, manager, owner, household member, or other human never receives information merely because it is technically attached to the same canonical record.

---

# 2. Constitutional invariants

These are implementation constraints, not aspirations.

1. **Atlas stores semantics before sentences.**
2. **A rendered title is presentation, not canonical work identity.**
3. **Canonical prose is non-authoritative by default.** Prose may remain source evidence, correspondence, authored content, or intrinsically textual output.
4. **Linkage does not grant disclosure.**
5. **Unclassified information is non-exposable.**
6. **Employee surfaces never receive raw canonical records and redact afterward.** Rejected information must not cross the server disclosure membrane.
7. **Authorization permits disclosure; it does not compel disclosure.** The encounter receives the minimum useful subset inside the authorized ceiling.
8. **The language renderer sees only the Desk Projection.** It cannot query canonical task prose or owner-only context.
9. **A grouping does not merge the identity, authority, or provenance of grouped work.**
10. **Observed, asserted, derived, planned, forecast, estimated, disputed, superseded, and unknown are not interchangeable truth states.**
11. **A Constraint is not a Gate.** A constraint is a rule; a gate is the current evaluation of a requirement/constraint.
12. **A Result Contract defines what completion means.** `Done` is not a universal result model.
13. **Existing structured rails are evolved, not replaced by a parallel task system.**
14. **Do not redesign the architecture while implementing a phase.** If production reality invalidates the plan, stop, document the conflict, and return for architectural review before proceeding.

---

# 3. Repository boundaries

## `optical-lift/farm-atlas`

Owns application behavior and compatibility during migration:

- server-side Work Grammar types and validators used by the app
- Structured Work Writer application service
- disclosure membrane consumers
- Exposure Envelope resolution/application
- Desk Projection assembler
- language renderer
- Worker Day readers/projections
- employee `/today` surface
- generic Worker Day client/actions
- compatibility adapters for legacy work
- tests proving no unauthorized payload crosses to clients

It must **not** become the canonical home of Atlas schema migrations.

## `optical-lift/noel-core-db`

Owns canonical database evolution:

- new/changed Atlas schema
- governed vocabularies where database enforcement is appropriate
- Claim/epistemic support
- exposure classification storage
- Exposure Envelope storage
- normalized relationships between existing work rails
- canonical RPC/functions needed to maintain invariants
- migration/backfill logic that changes canonical production data

Production schema changes follow the established database release process.

## `optical-lift/atlas`, branch `atlas-system-map-v1`

Owns selected/current architectural representation once implementation makes the architecture materially real.

Do not use the system map as an implementation scratchpad.
Do not promote unimplemented details merely because they appear in this migration plan.

---

# 4. Current production baseline

Production audit on 2026-09-07 found:

- 1,286 `atlas.tasks`
- 173 distinct legacy `task_type` values
- 93 `atlas.work_items`
- 71 current `work_items` still carrying freeform `instructions`
- 7,004 `work_execution_components`
- 232 distinct tasks with execution components
- 1,534 planned occurrences with execution components
- 4,606 `work_execution_relations`
- 120 `work_result_fields`
- 65 `work_requirements`
- populated time-contract, prerequisite, object-link, resource-requirement, work-definition, and result-policy rails

The current system already contains meaningful structured-work machinery. Migration must normalize and constitutionalize those rails rather than create a competing subsystem.

---

# 5. Migration strategy

The work is divided into four release blocks.

```text
RELEASE A — SEMANTIC FOUNDATION
RELEASE B — DISCLOSURE ARCHITECTURE
RELEASE C — EMPLOYEE EXECUTION
RELEASE D — CORPUS CONVERSION
```

Each release has explicit gates. A later release may not be treated as complete merely because code exists; its acceptance tests must pass.

---

# RELEASE A — SEMANTIC FOUNDATION

Goal: stop creating new prose-first work and establish one governed semantic grammar over the existing structured rails.

## A1. Freeze new prose-only operational semantics

Status: [ ] not started

### Build

Add application/test guardrails stating that new operational meaning may not be authored solely through fields such as:

- `title`
- `instructions`
- `display_title`
- `display_detail`
- `detail_lines`
- `display_action`
- `execution_do`
- `execution_how`
- `execution_done_when`
- `execution_statement`
- `worker_script`
- `owner_instruction_text`
- arbitrary metadata prose

Existing legacy writers may remain temporarily only when explicitly inventoried as compatibility debt.

### Acceptance

A1 is complete only when:

- new structured-work code has a single approved semantic entry path;
- tests fail if that path attempts to establish operational meaning with prose alone;
- employee-facing code is explicitly prohibited from treating `work_items.instructions` or legacy task metadata prose as worker-safe presentation data;
- a documented compatibility list identifies remaining legacy prose writers rather than silently permitting them.

### Stop condition

If no practical boundary can distinguish legacy writers from new work creation, stop and document the writer inventory before proceeding.

---

## A2. Define Work Grammar V1 contracts and governed vocabularies

Status: [ ] not started

### Build

Implement server-side types/validators for the ten corpus-derived boxes:

1. Work Act
2. Referent
3. Claim
4. Relation
5. Specification
6. Temporal Contract
7. Constraint
8. Requirement / Gate
9. Composition
10. Result Contract

Govern the small universal vocabulary while leaving domain nouns in their canonical domains.

Minimum Work Act modes:

- `change`
- `observe`
- `decide`
- `communicate`
- `transfer`
- `create`
- `plan`

Do not attempt to freeze every domain operation globally in this step. Operation vocabulary should be governable without turning 173 legacy task types into the new ontology.

### Acceptance

- each box has a typed contract;
- components cannot fall back to an untyped `note`/`detail` field to carry operational meaning;
- referents point to real domain identities where such identities exist;
- the grammar can represent both one atomic work act and a composition of multiple acts;
- tests distinguish Claim modality/adjudication states;
- tests distinguish Constraint from Requirement/Gate;
- tests distinguish Work identity from presentation grouping.

---

## A3. Map existing database rails to the grammar

Status: [ ] not started

### Build

Produce the canonical mapping before DDL:

```text
work_items
→ durable work identity + lifecycle

work_definitions
→ reusable operation/work patterns

work_execution_components
→ Referents + Specifications + selected typed components

work_execution_relations
→ Relations + Composition edges

work_time_contracts
→ Temporal Contracts

work_requirements / task_prerequisites / task_resource_requirements
→ Requirement + Gate precursors

work_result_fields / result policies
→ Result Contract precursors
```

Identify exactly what is missing rather than adding a new table for every box by default.

### Acceptance

- every existing structured rail has one declared semantic responsibility;
- overlaps are documented;
- no new parallel structured-task store is proposed;
- missing canonical capabilities are isolated for A4/A5 database work.

---

## A4. Add first-class Claim / epistemic support

Status: [ ] not started

Repo: `noel-core-db`

### Minimum canonical support

A Claim must be able to express:

- subject/referent
- predicate/dimension
- typed value or value reference
- unit when applicable
- effective/valid time
- modality
- provenance/source
- adjudication state/relations

Required modality distinctions:

- observed
- authoritative assertion
- derived
- planned
- forecast/projected
- estimated
- unknown

Required adjudication distinctions:

- current/accepted
- disputed
- superseded
- contradicts
- corrected by

### Acceptance

Using the BB10 treatment-history problem, Atlas must be able to store:

```text
confirmed treatment count = 0
as of 2026-08-29
source = authoritative owner assertion/correction
```

without making the original owner sentence the canonical fact.

The source sentence may remain attached as provenance/evidence.

---

## A5. Add exposure classification to exposable semantic atoms

Status: [ ] not started

Repo: `noel-core-db`

### Build

Establish a first-class classification mechanism for components/domain facts that may cross a human-facing boundary.

Unclassified must resolve to deny.

Initial class families should be sufficient to distinguish at least:

- basic work identity/title-level exposure
- execution detail
- operational context
- schedule/time
- order/delivery context
- customer/vendor context
- team context
- management context
- financial context
- personnel/HR context
- owner/ownership context
- provenance/internal adjudication
- safety-critical disclosure

Do not make these labels themselves the final UI. They are governance semantics.

### Acceptance

- every component used by the Release A seven-family test can be classified;
- missing classification produces a deny result;
- safety-critical disclosure can be represented explicitly rather than relying on broad informational permission;
- classification is independent of whether the component happens to live on the same task/work record.

---

## A6. Build one Structured Work Writer

Status: [ ] not started

Repo: `farm-atlas` application service over canonical rails

### Direction

All new governed work establishment should conceptually pass through one service:

```text
establishWork({
  act,
  referents,
  claims,
  relations,
  specifications,
  temporalContract,
  constraints,
  requirements,
  composition,
  resultContract
})
```

The exact API may vary after inspection, but the semantic boundary may not.

For compatibility, the writer may render/cache a legacy title where older product surfaces still require one.

### Acceptance

- structured semantics are written first;
- any compatibility title is derived from those semantics;
- prose cannot become the sole representation of an operation, referent, quantity, time rule, requirement, or completion result;
- source prose can still be preserved as evidence/provenance when appropriate;
- writer output is auditable against the ten boxes.

---

## A7. Seven-family semantic proof

Status: [ ] not started

Before Release B, take real production examples from all seven families:

| Family | Status |
| --- | --- |
| Treatment / spraying | [ ] |
| Harvest | [ ] |
| Transplant | [ ] |
| Observation / readiness | [ ] |
| Delivery / fulfillment | [ ] |
| Event setup | [ ] |
| Outreach / contact | [ ] |

### Acceptance for every family

A family passes only if a real production example can be represented **losslessly for operational meaning** without hiding required semantics inside prose.

The proof must show:

- Work Act
- all required Referents
- relevant Claims
- Relations
- Specifications
- Temporal Contract
- Constraints
- Requirements/Gates
- Composition where applicable
- Result Contract
- exposure classifications
- source prose preserved only as provenance where necessary

If any family cannot fit the grammar, **stop**. Update the corpus audit and this plan before schema expansion.

### Release A gate

Release A is complete only when all seven families pass.

---

# RELEASE B — DISCLOSURE ARCHITECTURE

Goal: establish the server-side boundary that decides what institutional reality may reach a particular person and encounter.

## B1. Define Exposure Envelope V1

Status: [ ] not started

The Exposure Envelope belongs to the person’s institutional relationship/membership in an organization, not to a global person identity and not to a route.

It defines the maximum information classes and jurisdictions Atlas may disclose.

Minimum jurisdiction scopes:

- assigned object/work only
- directly related work context
- team
- operating unit
- organization

### Acceptance

- two memberships for the same human can have different Exposure Envelopes;
- an employee cannot select or enlarge their own envelope;
- exposure is independent of Responsibility and Execution Authority;
- a manager may not delegate exposure they do not have authority to delegate;
- envelope changes are auditable and revocable.

---

## B2. Owner/manager employee-profile controls

Status: [ ] not started

Build the administrative controls that expose the governed permissions as understandable checkboxes/options.

The UI should express human concepts such as:

```text
Work
[always] Assigned task titles
[ ] Instructions needed to perform work
[ ] Locations, quantities and timing
[ ] Dependencies and prerequisites
[ ] Why the work matters operationally

Company operations
[ ] This Week priorities
[ ] Schedule and events
[ ] Orders and deliveries
[ ] Production and inventory
[ ] Customer/vendor information

Team
[ ] Names and roles
[ ] Assignments and handoffs
[ ] Team status / operating problems

Management
[ ] Operating plans and rationale
[ ] Metrics
[ ] Costs / budgets where delegable
[ ] Internal management context where delegable
```

Protected owner/HR/financial controls must remain subject to delegation authority rather than becoming ordinary manager toggles.

### Acceptance

- UI settings resolve to precise capability + scope grants;
- “checked” means Atlas may consider the class, not that every encounter must display it;
- every change writes an auditable grant/revocation history.

---

## B3. Build the server-only disclosure membrane

Status: [ ] not started

Conceptual input:

```text
institutional person / membership
+ organization
+ encounter
+ candidate semantic components
+ Exposure Envelope
```

Output:

```text
allowed semantic subset
```

### Absolute rule

The browser must never receive rejected canonical material.

No CSS hiding.
No client-side filtering.
No oversized JSON payload followed by redaction.
No raw canonical task record passed into a worker component.

### Acceptance

Create an integration fixture where canonical reality contains:

- task/work identity
- worker execution detail
- owner correction/provenance
- financial consequence
- management rationale
- location/time

For a basic employee envelope, inspect the actual serialized browser/server-component payload and prove it contains only the permitted subset.

---

## B4. Build Desk Projection assembler

Status: [ ] not started

A Desk Projection is a derived encounter artifact, not canonical work.

Conceptual pipeline:

```text
selected work identities
        ↓
resolve semantic components + related domain truth
        ↓
disclosure membrane
        ↓
relevance / minimum-necessary selection
        ↓
Desk Projection
```

Possible semantic output slots include:

- work identity reference
- action
- subject label/reference
- location
- quantity/specification
- timing
- worker-safe method
- prerequisite/gate state
- operational reason if authorized + necessary
- required result/report shape

### Acceptance

- Desk Projection contains no rejected source material;
- widening an Exposure Envelope increases eligible context but does not automatically increase clutter;
- the same canonical work can yield different lawful Desk Projections for employee, manager, and owner;
- a Desk Projection cannot become canonical truth merely because it was rendered.

---

## B5. Build late-bound language renderer

Status: [ ] not started

The renderer receives **only** the Desk Projection.

It may generate:

- display title
- concise instruction sentence
- timing/location phrases
- result request wording
- notification wording

It may not query canonical work tables, task metadata, owner notes, or hidden domain context to “improve” prose.

### Acceptance

Given a Desk Projection with:

```text
operation = spray
target = BB10
target condition = Bermuda treatment
sequence/pass = 1
```

it may render:

```text
Spray BB10 for Bermuda — first pass.
```

But it must be technically incapable of adding an owner-only correction that never entered the Desk Projection.

### Release B gate

Release B is complete only when a hostile/over-rich canonical fixture proves rejected information does not cross the membrane or become available to the renderer/client.

---

# RELEASE C — EMPLOYEE EXECUTION

Goal: move the real employee experience onto structured, authority-safe Desk Projections.

## C1. Migrate Anna’s currently deliverable Worker Day work

Status: [ ] not started

Only the work that can presently reach Anna’s Worker Day must be structurally migrated first.

### Safety rule

```text
structured + exposure-classified
→ eligible for generic employee projection

legacy prose only
→ not eligible for generic employee detail exposure
```

A compatibility title may still be shown where constitutionally allowed, but legacy instructions/metadata may not be forwarded as detail.

### Acceptance

- every currently deliverable Anna item has sufficient structured semantics for its basic employee projection;
- owner/internal prose is not required to render worker detail;
- unknown/unmigrated detail fails closed rather than leaking prose.

---

## C2. Switch employee task drawer to Desk Projection

Status: [ ] not started

Replace the current direct source-work exposure path.

The drawer may receive only the selected Desk Projection.

### Acceptance

The BB10 case must no longer expose owner ground-truth/provenance text to Anna, even though that text remains connected to the canonical work and remains available to authorized higher-authority encounters.

---

## C3. Build generic `/today`

Status: [ ] not started

Existing approved employee-seat law remains:

```text
route
≠ worker identity

WorkerSessionContext
→ institutional worker position
→ Worker Day selection
→ Desk Projection
→ /today
```

### Acceptance

- no valid worker session exposes no employee work;
- client cannot choose another employee by supplying membership/person IDs;
- `/today` reads Worker Day through `WorkerSessionContext`;
- `/today` receives Desk Projections, not raw canonical work;
- same route works for a second employee without a second employee-named page.

---

## C4. Work Pass destination → `/today`

Status: [ ] not started

Only after C3 is ready.

### Acceptance

- existing bounded Work Pass resolves institutional worker context;
- successful redemption redirects to `/today`;
- Personal Atlas auth is not implied;
- existing owner/manager `/work` remains separately protected;
- `/anna` remains compatibility until C6/D completion.

---

## C5. Generic Worker Day client + Result Contract reporting

Status: [ ] not started

Replace Anna-specific client/action naming only after the generic presentation/authority path is real.

Worker results must be shaped by the canonical Result Contract.

Examples:

```text
simple maintenance
→ completion attestation

harvest
→ quantity / grade / disposition as required

observation
→ condition / count / evidence as required

delivery
→ handoff / recipient / exception as required
```

Existing append-only transition history must remain authoritative where applicable.

### Acceptance

- no client-provided membership identity;
- server validates worker context + work identity + Result Contract + current state;
- a result can lawfully create Claims/Relations/state consequences without treating prose as the result semantics;
- `Done` remains available only for Result Contracts where attestation is actually sufficient.

---

## C6. Second-employee proof

Status: [ ] not started

Issue a second institutional worker a Work Pass without creating a second employee-specific page.

### Acceptance

- same `/today` route;
- different lawful Worker Day projection;
- different Exposure Envelope can produce different detail depth;
- neither worker can request the other’s projection by editing a request identifier;
- browser payloads contain only each worker’s lawful projection.

### Release C gate

Release C is complete when the second-employee proof passes in production-equivalent conditions.

---

# RELEASE D — CORPUS CONVERSION

Goal: convert the full legacy task corpus and shut down prose-first semantics.

## D1. Build migration classifier/report

Status: [ ] not started

Every legacy task must receive one migration disposition:

```text
fully structured
partially structured / unresolved
compound work requiring decomposition
presentation-only legacy container
superseded/historical
non-work record masquerading as task
intrinsically textual work/output
```

### Acceptance

- all 1,286 audited legacy tasks are accounted for;
- no silent “other” bucket;
- unresolved records are inspectable and do not get auto-promoted to structured truth.

---

## D2. Decompose compound work

Status: [ ] not started

Where one task currently contains multiple acts, establish distinct Work identities and Composition.

Example:

```text
legacy sentence:
Harvest X, strip it, bundle it, then deliver it.

structured:
A harvest
B prepare/strip
C bundle
D deliver

Composition:
A → B → C → D
```

The source sentence may remain as provenance.

### Acceptance

- each act has independent identity where state/authority/result can differ;
- grouping/presentation does not erase those identities;
- dependencies are typed relations/composition, not punctuation in a sentence.

---

## D3. Backfill structured semantics

Status: [ ] not started

Migrate legacy operational meaning into the selected grammar using auditable tooling.

### Rules

- never discard source prose needed for provenance;
- never declare inferred decomposition authoritative without recording provenance/modality;
- do not transform ambiguous prose into false precision;
- unresolved ambiguity remains unresolved and non-exposable unless separately authorized/safe.

### Acceptance

- each migrated item has an audit trail from source artifact to structured components;
- structured meaning can render the required operational presentation without reading legacy prose;
- task-family migration reports are reproducible.

---

## D4. Shadow comparison

Status: [ ] not started

During migration, compare:

```text
legacy presentation
vs.
structured semantic package
vs.
Desk Projection
vs.
late-bound rendering
```

### Acceptance

For migrated families:

- operational meaning is preserved;
- unauthorized information is reduced, not increased;
- new rendering is intelligible without depending on legacy prose;
- differences are reviewable rather than silently accepted.

---

## D5. Shut down prose-first writers

Status: [ ] not started

Remove or block the remaining ability for ordinary operational work to be created solely through legacy prose semantics.

### Acceptance

- new operational work cannot exist only as a title/instructions blob;
- legacy imports, if retained, must explicitly enter a quarantine/decomposition path;
- intrinsically textual tasks remain supported without being mistaken for general operational semantics.

---

## D6. Shut down prose-first employee reads

Status: [ ] not started

Remove compatibility paths that let employee surfaces read legacy canonical prose.

### Acceptance

- employee surfaces consume only Desk Projections;
- no employee-facing endpoint serializes `work_items.instructions` as operational detail;
- no employee-facing endpoint serializes arbitrary task metadata prose;
- regression tests search for these forbidden dependencies.

---

## D7. Retire `/anna`

Status: [ ] not started

After generic `/today`, generic results, and corpus-safe projection are proven.

Temporary redirect is permitted during retirement.

### Acceptance

- Anna and other employees use `/today`;
- no employee identity is encoded in route naming;
- deleting `/anna` removes no unique authority or data path.

### Release D gate

Release D is complete when prose-first operational semantics are no longer required for current production work creation, employee projection, or canonical execution meaning.

---

# 6. Cross-release test suite

The following tests should accumulate and remain permanent.

## Semantic integrity

- rendered titles can change without changing Work identity;
- operation/referent/quantity/time/result semantics survive without prose;
- domain objects remain canonical outside Work rather than being copied into task strings;
- compound presentation groups do not merge canonical work identities.

## Epistemic integrity

- owner assertion ≠ observation ≠ forecast ≠ plan ≠ derived claim;
- superseded claims remain provenance but do not silently remain current truth;
- ambiguous source prose cannot become authoritative structured fact without provenance/modality.

## Exposure integrity

- unclassified component → deny;
- task linkage → no automatic disclosure;
- assignment → no automatic disclosure beyond explicit baseline;
- widening envelope → increases eligibility, not mandatory display;
- unauthorized canonical fields never cross into browser payloads;
- renderer cannot fetch hidden context.

## Authority integrity

- exposure ≠ execution authority;
- responsibility ≠ exposure;
- manager cannot grant exposure beyond delegated authority;
- revoked exposure ceases to appear in new Desk Projections.

## Result integrity

- completion is governed by Result Contract;
- result submission cannot alter unrelated canonical state;
- append-only execution history remains reconstructible;
- observations/results can create new Claims without rewriting history.

---

# 7. Production/release discipline

For each implementation pass:

1. inspect the current migration journal and relevant repository state;
2. execute only the next authorized unchecked step;
3. if a schema change is required, use `noel-core-db` canonical migration/release process;
4. run the relevant focused tests;
5. run the full production application suite/build before release where application behavior changed;
6. open the explicit Vercel release gate only for the intended production release;
7. wait for production READY and verify the deployed artifact;
8. restore the release gate immediately afterward;
9. update this migration journal with commits, migrations, tests, production status, discovered debt, and the next authorized step.

A pass is not complete until the journal is updated.

---

# 8. Architectural review triggers

Stop implementation and return for review if any of these occur:

- a real task family cannot be losslessly represented by the ten-box grammar;
- implementation appears to require an eleventh universal semantic box;
- a proposed field begins carrying arbitrary prose because the grammar feels inconvenient;
- a worker-safe projection requires direct access to canonical owner/internal prose;
- exposure classification cannot express a necessary lawful disclosure boundary;
- the same field is being asked to mean both truth and presentation;
- the same identifier is being asked to mean both work identity and grouping identity;
- a new subsystem duplicates an existing structured-work rail instead of evolving it;
- migration would require inventing false precision from ambiguous historical prose;
- a manager/employee permission design conflates exposure with action authority.

When triggered, record the production example and the exact grammar failure before proposing a change.

---

# 9. Migration journal

## 2026-09-07 — Plan established

Status: complete

Documents already established:

- `atlas-structured-work-and-desk-projection-v0.md`
- `atlas-structured-work-corpus-audit-v1.md`
- `STRUCTURED-WORK-MIGRATION-V1.md` (this document)

Production corpus baseline:

- 1,286 legacy tasks
- 173 task types
- 7,004 existing structured execution components
- existing structured relations/time/requirements/results machinery confirmed

Architecture selected:

```text
Domain reality
→ ten-box Work Grammar
→ governance / Exposure Envelope
→ disclosure membrane
→ Desk Projection
→ late-bound language
```

Implementation status:

```text
Release A  [ ]
Release B  [ ]
Release C  [ ]
Release D  [ ]
```

Next authorized implementation step:

**A1 — Freeze new prose-only operational semantics.**

No schema migration has been authorized by this journal entry alone.

---

# 10. Definition of migration completion

This migration is complete only when all of the following are true:

1. New operational work is established semantically before presentation language exists.
2. The current production work corpus no longer depends on freeform prose for canonical executable meaning, except where the work/output is intrinsically textual.
3. Employee surfaces receive only server-derived Desk Projections.
4. Owner/management/provenance information cannot leak merely because it shares a task/work record with employee work.
5. Exposure Envelopes establish explicit disclosure ceilings per institutional membership.
6. Language is generated only after truth, authority, exposure, relevance, and encounter arrangement have been resolved.
7. The same canonical reality can produce different lawful presentations for different people without duplicating or weakening canonical truth.
8. A second employee can receive a Work Pass and use generic `/today` with their own lawful projection without developer-created person-specific UI.
9. Legacy prose-first writer and employee-reader paths are retired or explicitly quarantined as historical/import compatibility.
10. Atlas can explain why a particular fact was shown to a particular person in a particular encounter.

The desired final property is simple:

> **Atlas may know everything the institution knows. Each person sees only the minimum truthful portion they are authorized to encounter, assembled from structured reality at the last possible moment.**
