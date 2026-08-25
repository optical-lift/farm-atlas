# Atlas State Progression Contract v1

Status: governing compatibility architecture for requirement unification.

## Purpose

Atlas must become simpler by reducing the number of independent mechanisms that decide readiness, closure, and release without flattening the kinds of reality Atlas represents.

The shared law is:

**Evidence → Requirement → Evaluation → Boundary → Effect**

Progression is the durable, nested use of that law when a subject is intentionally moving toward a target condition. Tasks, projects, crops, resources, finances, household state, and other domains remain distinct objects with distinct truth ownership.

## Ownership boundaries

### Domain evidence owns what happened

Authoritative facts remain in their existing domain systems. The requirement layer references or reads those facts; it does not duplicate them into a generic truth store.

### Requirements own what must be true

A requirement expresses a condition whose satisfaction can be evaluated from authoritative evidence or from an existing governed domain provider.

### Evaluation owns derived satisfaction

Evaluation is deterministic, read-only, and explainable. It may derive aggregate satisfaction from child requirements but may not release work, notify people, assign tasks, mutate unrelated domain state, or arbitrate Clock priority.

### Boundary owns the fact that evaluated state changed

The boundary ledger records evaluated requirement-set transitions such as `open → satisfied` and `satisfied → open`. Boundary recording does not itself decide whether domain reality is true and does not execute the consequences of the transition.

### Effects own authorized consequences

Release, notification, escalation, obligation activation, and other consequences are separate consumers of boundary truth. Evaluation and boundary recording do not execute effects.

## Governing invariants

1. Evidence is not requirement state until an authorized evaluator admits or reads it.
2. Task completion is not progress by definition.
3. Progression does not own domain truth.
4. Requirements may reopen if underlying reality ceases to satisfy them.
5. Branches may progress independently; Atlas must not manufacture one universal stage number.
6. Aggregate readiness is derived from requirements.
7. Every satisfied requirement must be explainable from its provider/evidence.
8. Every future release must identify the boundary that authorized it.
9. Effects are separate from evaluation and boundary recording.
10. Clock arbitration occurs only after eligibility/readiness is established.
11. Projects organize work; Progressions establish changed reality.
12. New domains may not invent another readiness/gate/release engine without first proving the shared contract cannot express the needed semantics.
13. Compatibility migration must preserve existing behavior until parity is proven and an explicit cutover is authorized.

## First implementation boundary: task execution readiness

The first implementation is deliberately read-only. It does not replace `atlas.task_execution_readiness_v1(uuid)`.

The existing task execution warrant already composes five governed providers:

- prerequisites — `task_prerequisites_ready_v1`
- resources — `task_required_resources_available_v1`
- destination — `task_execution_destination_readiness_v1`
- seed — `task_seed_readiness_v1`
- state-consequence gate — `task_state_consequence_gate_v1`

The compatibility membrane normalizes those provider results into requirement nodes, evaluates the set through one generic evaluator, and compares the derived answer with the legacy task execution warrant.

The first membrane therefore has three functions:

1. `requirement_set_evaluate_v1(jsonb)` — generic read-only all-required evaluator over normalized requirement nodes.
2. `task_execution_requirement_inputs_v1(uuid)` — task-domain adapter that reads the five existing providers without becoming a new truth authority.
3. `task_execution_requirement_evaluation_v1(uuid)` — compatibility packet that returns normalized requirements, aggregate evaluation, legacy readiness, and an explicit parity result.

## Normalized requirement node v1

Each node contains:

- `requirementKey` — stable semantic key within the requirement set.
- `satisfied` — derived boolean supplied by the domain adapter.
- `provider` — existing governed provider that supplied the result.
- `providerState` — provider-native state when available.
- `evidence` — provider output or a minimal wrapper around the provider result.

The generic evaluator does not know what a seed, destination, resource, crop, guest room, or debt balance is. It only validates normalized nodes and derives aggregate satisfaction.

## Truth boundaries of the first membrane

The first membrane:

- is read-only;
- creates no tables, triggers, queues, releases, transitions, or notifications;
- does not change task status, assignment, Worker Day placement, Clock arbitration, or UI;
- does not replace any existing provider;
- does not treat provider output as new domain truth;
- fails closed on malformed requirement nodes;
- exposes whether its answer matches the legacy execution warrant.

## First-step acceptance gate

The first step is complete only when:

1. the generic evaluator contains no task-, farm-, crop-, seed-, resource-, or Elm-specific semantics;
2. the task adapter contains only the existing five execution-readiness providers;
3. the compatibility membrane has zero readiness mismatches across the live `atlas.tasks` corpus;
4. source custody, architecture CI, full tests, and build are green;
5. no production behavior has been cut over to the new membrane.

## Second implementation boundary: append-only requirement boundary ledger

The second implementation adds the **Boundary** primitive without attaching **Effect**.

`atlas.requirement_boundary_events` is the generic append-only ledger. It records an explicit comparison between two already-evaluated requirement-set snapshots and only admits two state changes:

- `open → satisfied` = `closed`
- `satisfied → open` = `reopened`

`atlas.record_requirement_boundary_v1(...)` is the sole service-internal recorder introduced by this step. It does **not** inspect tasks, crops, resources, Worker Day, Farm Round, releases, notifications, or Clock state to decide whether a requirement is true. Its input is the before/after evaluation truth supplied by an authorized upstream evaluator.

The recorder enforces these boundaries:

- both evaluation snapshots must be JSON objects with canonical `state` and boolean `satisfied` fields;
- `state` and `satisfied` must agree;
- same-state comparisons emit no boundary and return `null`;
- a stable `boundary_key` makes retries idempotent;
- an exact retry returns the existing event id;
- reuse of a boundary key with different truth fails closed;
- recorded history cannot be updated or deleted;
- direct service-role insert/update/delete on the ledger is denied; service writes go through the governed recorder.

The ledger deliberately stores both evaluation snapshots so a later effect can identify the precise evaluated boundary that authorized it. The ledger does not duplicate or replace the authoritative domain evidence referenced inside those evaluations.

### What Step 2 does not do

This step makes no behavior cutover. It has:

- no release consumer;
- no notification consumer;
- no task or assignment mutation;
- no Worker Day or Farm Round mutation;
- no scheduling or dependency-clock action;
- no Principal or Clock arbitration;
- no UI behavior;
- no domain-specific state mutation.

`atlas.task_execution_readiness_v1(uuid)` remains the execution authority. The Step 1 compatibility membrane remains read-only and does not automatically write boundary events. A future effect-separation step must explicitly connect a proven boundary to one bounded consumer rather than turning this ledger into another trigger-driven switchboard.

## Second-step acceptance gate

The second step is complete only when:

1. the ledger and recorder contain no task-, farm-, crop-, seed-, training-, debt-, or other domain-specific semantics;
2. close, reopen, same-state no-op, idempotent replay, conflicting-key rejection, and append-only behavior are proven;
3. the ledger has no `AFTER INSERT` effect consumer;
4. the live task-readiness compatibility membrane still reports zero mismatches across the full task corpus;
5. source custody, architecture CI, full tests, and build are green;
6. no release, notification, scheduling, task, Worker Day, Farm Round, Principal, or Clock behavior has been cut over.

Only after this boundary primitive is proven should Atlas separate one existing coupled effect path behind it.

## Third implementation boundary: one boundary-authorized release effect

The third implementation cuts over exactly one existing consequence path: the `pot_up_serial` task-release queue. It does not create a generic effects engine.

Before this step, `atlas.advance_pot_up_serial_queue_v1()` directly treated a predecessor task transition to `done` as both the readiness decision and the command to complete the current queue item and release its successor.

After this step the same domain event flows through the shared grammar:

1. the existing task status remains domain evidence;
2. the pot-up adapter normalizes predecessor completion as requirement `predecessor_task_completed` and evaluates before/after snapshots through `atlas.requirement_set_evaluate_v1(jsonb)`;
3. `atlas.record_requirement_boundary_v1(...)` records the stable `open → satisfied` boundary for the active queue item;
4. `atlas.apply_pot_up_serial_release_effect_v1(uuid,date)` accepts that exact boundary id as its authorization warrant;
5. the existing `atlas.release_next_task_in_queue_v1(uuid,text,date)` remains lower-level queue/materialization machinery inside the bounded effect consumer.

The release effect fails closed unless the boundary identifies a `pot_up_serial` queue item, the boundary is `closed`, its requirement set is `pot_up_serial_predecessor_completion_v1`, its source is the same authoritative task, and that task is actually `done`. The effect is idempotent for the same boundary.

The authorizing boundary id is carried onto the completed predecessor queue item and the released successor queue item, planned occurrence, task payload, and materialized task. This makes the release explainable without making the boundary ledger own queue or task truth.

### What Step 3 does not do

This step:

- does not add an `AFTER INSERT` consumer to the generic boundary ledger;
- does not make `requirement_boundary_events` a global effect switchboard;
- does not change task execution readiness authority;
- does not alter Worker Day, Farm Round, Principal, Clock, notification, or UI behavior;
- does not expose the new effect consumer as a public, authenticated, or service-role RPC;
- does not replace the generic queue/materialization primitive used inside the bounded effect;
- does not cut over any other ready/gate/release path.

The old automatic pot-up coupling is retired by changing its existing task trigger function into a domain adapter that must record a Boundary before invoking the release consequence. The shared lower-level queue release function remains implementation machinery; it is not itself the State Progression authorization boundary.

### Step 3 release-authority seal

The post-merge release audit found that correct orchestration at the pot-up adapter was not sufficient as a durable invariant: a lower-level helper must not remain capable of accepting `pot_up_serial` work without the same authorization provenance. The final Step 3 seal therefore requires the lower-level release helper to fail closed for `pot_up_serial` unless the authorizing Boundary chain is present.

For pot-up serial work, `atlas.release_next_task_in_queue_v1(uuid,text,date)` now requires the queued successor to identify the Boundary event, requirement set, and immediately preceding queue item that authorized release. The immediately preceding item must already be completed by the same Boundary, and the Boundary ledger row must be a matching `closed` `open → satisfied` event whose source is that predecessor task. Other queue kinds retain their existing behavior.

The dormant generic direct-release trigger function is retired rather than left as a competing authority. `atlas.advance_task_release_queue_v1()` had no live trigger attached, but removing it eliminates a second executable formulation of the old direct coupling. Pot-up release metadata now records `boundary_authorized_process_continuation_v1`; the former `direct_process_continuation_materialization_v1` label is not part of the post-cutover path.

This hardening does not create another effect consumer, API, table, trigger, or generic effect router. The final governed artifact count is neutral relative to Step 2 at 4,368: the new bounded Effect consumer and retirement of the dormant direct-release formulation offset one another. The simplification is architectural—one fewer competing release authority—while the authorization invariant is now enforceable at the last shared mutation boundary.

## Third-step acceptance gate

The third step is complete only when:

1. a real pot-up predecessor completion is proven in a rollback transaction to create exactly one `open → satisfied` boundary before successor release;
2. the released queue item, occurrence, task payload, and task all identify the exact boundary that authorized them;
3. replaying the same effect boundary is idempotent;
4. the rollback proof leaves the live task, checklist, queue, occurrence, and boundary ledger unchanged;
5. the boundary ledger still has no insert-triggered effect consumer;
6. the live task-readiness compatibility membrane still reports zero mismatches across the full task corpus;
7. authenticated RPC registry drift remains zero and the new effect consumer remains service-internal;
8. the lower-level helper rejects pot-up release without valid Boundary provenance and accepts the same release when the exact Boundary chain is present;
9. the dormant generic direct-release function is absent from the live executable surface;
10. repository migration bytes exactly match post-cutover production provenance;
11. source custody, architecture CI, full tests, build, merge, and production deployment verification are green.

Only after this single effect path is proven should Atlas select another competing ready/gate/release mechanism for retirement.