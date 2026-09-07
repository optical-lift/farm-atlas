# Structured Work A3 — Canonical Database Rail Map

Status: Release A / A3 mapping result. Inspection only; no DDL or canonical data mutation was performed.

Production inspected: `zirqkouammpwxlqfbsvf`
Governing grammar: `lib/atlas/work-grammar-v1.ts`
Governing plan: `docs/architecture/STRUCTURED-WORK-MIGRATION-V1.md`

## Purpose

Give every existing structured-work rail one declared semantic responsibility before schema work begins, document overlaps explicitly, and isolate the actual missing canonical capabilities for A4/A5.

The central result is that Atlas already has most of the physical rails needed for Structured Work. They are unevenly governed, partly legacy-task-scoped, and often allow prose/display fields to carry meaning, but they should be evolved rather than replaced.

No parallel structured-task store is recommended.

---

# Canonical ownership map

## `atlas.work_items` — durable Work identity and lifecycle

Current production: 93 rows; 71 carry non-empty `instructions`; 23 distinct `operation_class` values.

Canonical responsibility:

- durable Work identity;
- organization / operating-unit custody;
- lifecycle state (`open`, `completed`, `cancelled`, `superseded`);
- stable key / definition linkage;
- source lineage;
- canonical result-contract attachment;
- supersession identity.

Work Grammar relationship:

- owns the **identity carrier** for a Work package;
- does **not** own the semantic meaning of Work Act, Referents, timing, instructions, or result fields merely because it currently has columns for them.

Compatibility-only / non-authoritative semantics:

- `title` — may remain a display/cache field during migration;
- `instructions` — legacy/source prose, never employee-safe canonical instruction data;
- `operation_class` — migration clue / compatibility classification until governed Work Act storage is settled;
- arbitrary `metadata` prose — source/migration material unless explicitly promoted into typed rails.

Decision: **reuse and narrow**. Do not create a second Work identity table.

---

## `atlas.work_definitions` — reusable work-pattern identity

Current production: 403 rows. Every row has `title_template`; 138 distinct `action_key`/legacy task-type combinations.

Canonical responsibility:

- stable reusable work-pattern identity;
- organization/farm-scoped reusable operation pattern linkage;
- defaults that are truly pattern policy rather than per-work fact.

Work Grammar relationship:

- precursor for reusable **Work Act pattern** and default Result/Constraint/Requirement attachments;
- should eventually point to governed semantic patterns rather than making `title_template`, `task_type`, or `action_key` the ontology.

Compatibility-only / non-authoritative semantics:

- `title_template` is presentation;
- `task_type` is legacy classification;
- `action_key` is a strong migration clue for `WorkAct.operation`, but open-ended operation semantics should be governed through the Work Grammar rather than this column alone;
- `default_visibility_scope` is not the new Exposure Envelope or component exposure classification.

Decision: **reuse as pattern identity**, not as sentence templates.

---

## `atlas.work_execution_components` — legacy carrier for Referents + Specifications, with selected typed attachments

Current production: 7,004 rows across 23 component kinds. 282 rows contain non-empty `value_text`.

The table already supports:

- task or planned-occurrence carrier;
- `component_key`, `component_kind`, `component_role`;
- numeric / boolean / text scalar slots;
- units;
- generic reference kind/id;
- real FKs to resources, growing objects, and zones;
- ordering / required flag / source metadata.

Canonical responsibility under Work Grammar V1:

1. **Referent attachment** when a component points to a canonical identity;
2. **Specification attachment** for typed scalar/categorical parameters;
3. narrowly typed references to Result/Constraint/etc. only when a future mapping explicitly gives the row that semantic role.

It should not remain one generic bucket for every semantic box.

Important current overlap/problems:

- `component_kind` mixes domain nouns (`place`, `resource`, `crop_cycle`, `party`) with semantic functions (`parameter`, `quantity`, `state`, `result_field`);
- `component_role` mixes true relationship roles (`source`, `destination`, `target`) with parameter keys (`cut_height`, `pressure`) and operations (`harvests`, `observes`);
- `label` is mandatory and can be mistaken for canonical meaning;
- `value_text` is a prose escape hatch;
- generic `reference_kind/reference_id` has no FK across arbitrary domains;
- components are currently carried by legacy `task_id` or `planned_occurrence_id`, not directly by `work_item_id`.

Decision: **reuse and normalize**. A future migration must distinguish Referent rows from Specification rows and stop using `label/value_text` as authoritative semantics. Do not create a parallel universal component table before determining whether this rail can be safely evolved.

---

## `atlas.work_execution_relations` — typed execution Relations; partial Composition precursor

Current production: 4,606 rows across 14 `relation_kind` values.

Current vocabulary is already meaningfully relational: `at`, `from`, `into`, `for`, `set_to`, `remove_from`, `adjacent_to`, `preserve_in`, `results_in`, `after`, `loosens`, `removes`, `requires`, `uses_on`.

Canonical responsibility:

- **Relation** edges among execution components;
- selected **Composition** ordering/conditional edges where endpoints represent Work Acts/compositions rather than domain referents.

Current limitation:

- endpoints are component keys inside a legacy task/planned occurrence;
- Relation and Composition are not explicitly distinguished;
- no direct Work-item-to-Work-item composition identity;
- `condition_component_key` hints at branching but does not establish the governed Composition contract.

Decision: **reuse for semantic relations**, and evaluate whether Composition needs a small explicit identity rail rather than forcing grouping identity into relation rows.

---

## `atlas.work_item_relations` — durable Work-to-Work relation rail

Current production: 0 rows.

Canonical responsibility:

- durable semantic relation between separate `work_items` when the relationship is itself part of institutional truth (depends-on, enables, supersession-adjacent relationships, etc.).

This is not the same as presentation grouping.

Decision: **retain**. Do not misuse it as a rendered-task grouping table merely because it links work identities.

---

## `atlas.work_time_contracts` — canonical Temporal Contract precursor

Current production: 65 rows; movement policy is currently `movable` or `bounded` in live rows.

Current structure is strong:

- earliest lawful time;
- preferred start/end;
- latest lawful time;
- hard finish;
- expected/min/max duration;
- movement policy;
- delay consequence;
- source + confidence;
- lifecycle/supersession.

Canonical responsibility:

- **Temporal Contract** for durable Work.

Important vocabulary mismatch with Work Grammar V1:

- database movement policy currently allows `fixed`, `bounded`, `movable`, `unplaced`;
- A2 runtime vocabulary currently uses `fixed`, `bounded`, `movable`, `re_evaluate`.

This must be reconciled before persistence. `unplaced` is a real current state/policy and must not be silently lost; `re_evaluate` may belong to a requirement/placement consequence rather than movement policy unless the production model proves otherwise.

Current missing temporal shapes:

- explicit recurrence/rhythm relation;
- event anchor as canonical referent;
- biological/forecast-window type rather than only timestamps + source metadata;
- minimum interval semantics distinct from generic duration.

Decision: **reuse as primary Temporal Contract rail** and extend carefully rather than replace it.

---

# Requirement and Gate family

These existing tables overlap and should become a governed family, not be collapsed blindly.

## `atlas.work_requirements` — durable institutional Requirement identity

Current production: 65 rows; all `requirement_kind = operational`; every row has prose `summary`.

Canonical responsibility:

- durable **Requirement identity/lifecycle** at organization/operating-unit scope;
- validity/relevance window;
- source lineage;
- satisfaction/cancellation/supersession lifecycle.

Current gaps:

- `requirement_kind` is not meaningfully typed yet;
- `summary` currently carries the semantics in prose;
- no typed satisfaction rule;
- `consequence_of_delay` is JSON rather than governed consequence;
- requirement can exist independently of the Work that resolves/advances it, which is useful and should remain.

Decision: **reuse as durable Requirement rail**, but give requirements typed semantics rather than sentence summaries.

## `atlas.work_requirement_links` — Requirement ↔ Work relationship

Current production: 65 rows, all currently `link_role = resolves`; the constraint allows `advances`, `resolves`, `investigates`, `enables`, `protects`.

Canonical responsibility:

- relation between an institutional Requirement and Work that responds to it.

This is not the Gate evaluation itself.

Decision: **retain**.

## `atlas.task_prerequisites` — legacy task-to-task execution prerequisite

Current production: 76 rows.

Canonical responsibility during migration:

- compatibility precursor for **Requirement** where another Work/task state is required before execution;
- `hold_mode` is presentation/release behavior, not the requirement identity itself;
- `satisfied_at` is a legacy gate/result cache.

Current issue: it links legacy `atlas.tasks`, not durable `work_items`.

Decision: **migrate semantics into governed Requirement/Relation rails**, then retire as a canonical source once legacy tasks are converted.

## `atlas.task_resource_requirements` — legacy resource Requirement + cached Gate state

Current production: 75 rows; 21 rows carry freeform `note`.

Canonical responsibility during migration:

- precursor for resource **Requirement**;
- resource quantity/unit belongs to typed Specification attached to that requirement;
- current `status` (`needed`, `available`, `missing`, `needs_check`, `reserved`, `used`, `skipped`) mixes required-state semantics with current Gate evaluation and execution lifecycle.

Decision: **decompose during migration**, not clone.

## `atlas.work_release_policies` — release/gate policy definition

Current production: 395 rows across six gate types.

Canonical responsibility:

- reusable release policy / satisfaction-evaluation policy for planned work;
- not itself the current Gate state.

## `atlas.work_gate_evaluations` — historical release-policy evaluation

Current production: 43 rows; outcomes currently include `released`, `failed`, `capacity_blocked` in live data. All 43 rows contain prose `reason`.

Canonical responsibility:

- auditable evaluation event/snapshot produced by release policy evaluation.

This is related to but not identical to Work Grammar `Gate`: current rows evaluate planned-occurrence release policy, whereas a Work Grammar Gate may evaluate any Requirement. A4/A6 must not collapse these meanings accidentally.

Decision for Requirement/Gate family: **retain each distinct identity/event role, but normalize the semantic contract around Requirement + current/evaluated Gate state**.

---

# Result family

## `atlas.work_result_contract_policies` — reusable Result Contract policy

Current production: 1 row.

Canonical responsibility:

- reusable **Result Contract acceptance policy** keyed by `contract_key`;
- source domain and acceptance mode.

Current DB acceptance modes are:

- `worker_attestation`
- `structured_submission`
- `domain_adapter`

A2 runtime acceptance modes currently are:

- `worker_attestation`
- `manager_acceptance`
- `system_observation`
- `external_confirmation`

This is a real vocabulary mismatch, not a naming cleanup. Database modes currently describe *execution/handling mechanism* in part, while A2 types describe *who/what accepts*. The schema should likely separate acceptance authority from submission/adapter mechanism rather than overwrite either vocabulary.

## `atlas.work_result_fields` — typed result field definition precursor

Current production: 120 rows across six distinct legacy tasks; current live kinds: `choice`, `text`, `number` (DB constraint also allows boolean/date).

Canonical responsibility:

- field definitions for **Result Contract**;
- field key, kind, unit, requirement, choices, ordering.

Current issues:

- carrier is legacy task/planned occurrence, not `work_item`/contract identity;
- mandatory `label` is presentation;
- `text` is valid only where the result is intrinsically textual, not as a general semantic escape hatch.

## `atlas.work_result_submissions` / `work_result_values`

Current production: 0 rows each.

Canonical responsibility:

- immutable/append-oriented structured **result submission** and typed field values.

These are execution evidence, not the Result Contract definition.

## `atlas.work_execution_results`

Current production: 0 rows.

Canonical responsibility:

- durable execution-result envelope attached directly to `work_item`, including reporter identity, result kind, contract key, idempotency, and payload.

This overlaps with the legacy task-oriented submission/value rail. Before A6 writes results, the architecture must decide which is the canonical new-work result envelope and which is compatibility plumbing. Do not dual-write both indefinitely without a declared adapter boundary.

## `atlas.work_result_acceptances`

Current production: 0 rows.

Canonical responsibility:

- explicit Result acceptance/adjudication event for a `work_execution_result`;
- acceptance authority/domain and evidence.

Decision for Result family: **reuse the existing result rails**, but split contract definition, submission/result evidence, and acceptance as separate identities. Reconcile the two result-envelope paths before A6 rather than create a third.

---

# Claim / epistemic family — important A3 correction

## `atlas.claim_records`

Current production: 1 row.

This means A4 does **not** need a new claims subsystem.

Existing canonical support already includes:

- scope kind/id;
- subject domain/kind/id;
- claim type;
- lifecycle state;
- authority kind;
- source kind/key;
- JSON value;
- confidence;
- primary evidence;
- supersedes claim;
- valid from/until;
- recorded/superseded timestamps;
- metadata.

Current lifecycle constraint includes:

- `reported`
- `observed`
- `inferred`
- `proposed`
- `accepted`
- `rejected`
- `superseded`
- `expired`
- `unknown`

## `atlas.claim_evidence_links`

Current production: 1 row.

Existing relations are governed as:

- `supports`
- `contradicts`
- `corrects`
- `context`

Canonical responsibility:

- Claim ↔ Evidence provenance/adjudication support.

### A4 gap after inspection

The existing rail is strong but currently conflates several axes that Work Grammar V1 requires to be independent:

- `lifecycle_state` currently mixes epistemic modality (`observed`, `inferred`, `unknown`, `proposed`) with adjudication/lifecycle (`accepted`, `rejected`, `superseded`, `expired`);
- there is no explicit governed modality field for `authoritative_assertion`, `planned`, `forecast`, `estimated`;
- `claim_type` carries predicate/dimension but is only non-empty text, not governed semantic key at the database boundary;
- `value` is generic JSONB, not a canonical typed scalar/reference contract;
- correction/contradiction is partly represented through evidence links rather than Claim-to-Claim adjudication relations;
- `supersedes_claim_id` handles one important relation but not all adjudication edges.

Decision: **A4 must evolve `claim_records` + `claim_evidence_links`**, separating modality from adjudication and governing typed values/predicate semantics. Do not add `work_claims` or another claim table unless a concrete FK/jurisdiction requirement makes extension impossible.

---

# Governance / exposure family

## Existing authority rails

`atlas.principal_authority_allocations` already exists for principal authority allocation, with membership, portfolio/function scope, authority kind, scope JSON, claim strength, displacement authority, validity interval, status, reason, and provenance. It is currently empty in production.

`atlas.architecture_authority_boundaries` records system-level authority boundary declarations.

These are relevant to action/decision authority, but neither is an Exposure Envelope.

## Exposure classification gap

Production table discovery found no dedicated exposure/visibility-classification rail capable of classifying semantic atoms and resolving per-institutional-person information ceilings.

`work_definitions.default_visibility_scope` is too coarse and attached to a work pattern; it cannot answer whether a specific Claim, Specification, customer referent, owner provenance item, or financial component may cross an employee boundary.

A5 therefore remains a genuine missing canonical capability.

Required A5 properties remain:

- component/fact-level classification or inherited domain classification;
- institutional-membership Exposure Envelope;
- scope/jurisdiction of each grant;
- deny when unclassified;
- disclosure authority delegation independent from execution authority;
- safety-critical classification support;
- auditable grant/revocation lineage.

Decision: **build exposure governance as a new capability adjacent to existing authority rails, not as `work_items.visibility` and not as another role flag.**

---

# Execution planning/adapters — adjacent rails, not Work Grammar boxes

## `atlas.work_execution_plans`

Current production: 0 rows.

Responsibility:

- assignment/planned placement of existing Work to a responsible allocation + assignee + service date;
- belongs to execution planning / Encounter selection, not canonical Work semantics.

## `atlas.work_execution_plan_events`

Responsibility:

- append/audit history of plan movement and exposure-service-date changes.

Note: the existing column named `exposure_service_date` refers to worker-plan exposure/placement timing. It is **not** the new information Exposure Envelope and must not be reused for information-classification semantics.

## `atlas.work_execution_adapters`

Current production: 65 rows across three adapter kinds.

Responsibility:

- compatibility link from durable Work to legacy task/planned-occurrence execution rails while migration is in progress.

Decision: retain as migration plumbing; do not treat adapter metadata as canonical work semantics.

---

# Overlap decisions

The following overlaps must be resolved explicitly rather than by table proliferation:

1. **Work Act operation**
   - `work_items.operation_class`
   - `work_definitions.action_key/task_type`
   - legacy task metadata
   - A2 Work Grammar `act.operation`
   - Direction: A2 semantic operation becomes authoritative for new work; existing columns become mappings/compatibility until migrated.

2. **Referents / Specifications**
   - both currently share `work_execution_components`.
   - Direction: keep one physical precursor if feasible, but require semantic subtype mapping and typed values; display `label` is never authority.

3. **Relations / Composition**
   - `work_execution_relations` handles component-level semantic edges;
   - `work_item_relations` handles durable Work-to-Work edges;
   - neither currently cleanly owns presentation/execution Composition identity.
   - Direction: preserve semantic relations; add only the minimum Composition identity support if A7 proves relations alone cannot carry composition structure without conflating identity.

4. **Requirement / Gate**
   - `work_requirements` = durable institutional requirement;
   - `work_requirement_links` = Work response relationship;
   - task prerequisites/resource requirements = legacy specialized precursors;
   - release policies/evaluations = placement/release policy + historical evaluations.
   - Direction: do not collapse these distinct identities, but normalize them behind Work Grammar Requirement/Gate semantics.

5. **Results**
   - contract policies/fields define required result;
   - submissions/values are one legacy-task-oriented evidence path;
   - `work_execution_results` is a direct Work-result envelope;
   - acceptances adjudicate execution results.
   - Direction: A6 must choose one canonical new-work result submission envelope and treat the other as adapter/legacy path.

6. **Claims**
   - existing `claim_records` is already the canonical general Claim rail.
   - Direction: A4 extends it; no new work-specific claim store.

7. **Exposure**
   - existing visibility/default scope and authority allocations are not semantic-atom exposure governance.
   - Direction: A5 is a real new capability but should integrate with institutional membership and existing authority law.

---

# Missing canonical capabilities isolated for next steps

## A4 — Claim evolution, not Claim creation

Required changes to the existing Claim rail:

- explicit modality independent from adjudication/lifecycle;
- explicit adjudication state;
- Claim-to-Claim contradiction/correction relationships where evidence links are insufficient;
- governed predicate semantic key;
- typed value contract / value-reference support;
- authoritative-assertion, planned, forecast, estimated distinctions;
- preserve evidence/source artifacts separately.

## A5 — Exposure governance

Genuinely absent:

- semantic exposure classes;
- classification attachment/inheritance for exposable atoms/domain facts;
- organization-membership Exposure Envelope;
- scoped grants;
- delegated authority to alter another member's envelope;
- deny-by-default evaluation;
- safety-critical override/classification semantics;
- disclosure audit trail.

## Later A6/A7 issues already identified but not to be solved in A3

- reconcile Temporal movement-policy vocabulary (`unplaced` vs A2 `re_evaluate`);
- reconcile result acceptance-authority vs submission-mechanism vocabularies;
- choose canonical new-work result envelope;
- determine minimum physical support for Composition identity;
- define direct `work_item` carrier for structured semantic components or an explicit adapter from current task/planned-occurrence carriers;
- derive compatibility title only after semantics.

---

# A3 acceptance verdict

**PASS.**

- Every inspected structured-work rail now has a declared semantic responsibility.
- Overlaps are documented rather than hidden.
- No parallel structured-task store is proposed.
- A4 has been narrowed to evolution of the existing Claim rail.
- A5 remains the primary genuinely missing governance capability.
- No DDL or canonical data mutation occurred during A3.

Next authorized step: **A4 — evolve the existing `claim_records` / `claim_evidence_links` rail to satisfy Work Grammar V1 epistemic semantics, through `noel-core-db`.**
