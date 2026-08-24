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

A future boundary ledger may record transitions such as `open → satisfied` and `satisfied → open`. Boundary recording is explicitly outside the first compatibility membrane.

### Effects own authorized consequences

Release, notification, escalation, obligation activation, and other consequences are separate consumers of boundary truth. Evaluation itself does not execute effects.

## Governing invariants

1. Evidence is not requirement state until an authorized evaluator admits or reads it.
2. Task completion is not progress by definition.
3. Progression does not own domain truth.
4. Requirements may reopen if underlying reality ceases to satisfy them.
5. Branches may progress independently; Atlas must not manufacture one universal stage number.
6. Aggregate readiness is derived from requirements.
7. Every satisfied requirement must be explainable from its provider/evidence.
8. Every future release must identify the boundary that authorized it.
9. Effects are separate from evaluation.
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

## Acceptance gate

This step is complete only when:

1. the generic evaluator contains no task-, farm-, crop-, seed-, resource-, or Elm-specific semantics;
2. the task adapter contains only the existing five execution-readiness providers;
3. the compatibility membrane has zero readiness mismatches across the live `atlas.tasks` corpus;
4. source custody, architecture CI, full tests, and build are green;
5. no production behavior has been cut over to the new membrane.

A later step may add append-only boundary recording, but only after this read-only parity membrane proves stable.