# Atlas Phase A — RLS, Function Boundary, and First Vertical-Slice Contract

**Audit date:** July 20, 2026  
**Repository:** `optical-lift/farm-atlas`  
**Supabase project:** `zirqkouammpwxlqfbsvf`  
**Schema:** `atlas`  
**Status:** Architecture decision record. No policies, grants, functions, or application behavior are changed by this document.

## 1. Governing decision

Atlas will not secure its existing pages one route at a time. The database and application will be rebuilt around one minimum authenticated path:

```text
verified Supabase session
→ normalized Atlas session
→ active farm membership
→ authorized task read
→ authorized task transition
→ worker result and derived farm-state changes
```

The first secure vertical slice is deliberately task-sized because it exercises every layer required by the rebuild: identity, membership, row visibility, controlled mutation, result history, and downstream farm-state effects.

## 2. Current database security baseline

The current Atlas schema contains 48 base tables.

### Current RLS state

- Most operational tables have RLS enabled but no policies.
- Eight tables still have RLS disabled:
  - `crop_cycle_impacts`
  - `crop_observation_types`
  - `crop_profile_aliases`
  - `inbox_items`
  - `object_activity_events`
  - `project_task_links`
  - `rhythm_templates`
  - `task_crop_cycles`
- `production_plans` and `production_successions` currently permit unrestricted anonymous reads and writes.
- Only `user_profiles` and `farm_memberships` currently have self-read policies.
- Ordinary application routes use the service-role client, so the existing RLS shape is not the practical authorization boundary.

### Immediate security conclusion

RLS cannot be enabled or tightened table-by-table without a coordinated policy set. Several join tables lack `farm_id`, and worker-safe visibility cannot be expressed using the current task metadata conventions alone.

The first migration must therefore establish helper functions, normalized assignment fields, parent-inheriting join policies, controlled RPCs, and table policies together.

## 3. Role model used by the policy matrix

### Owner

An active Owner membership at a farm grants full operational visibility and management authority within that farm.

### Manager

An active Manager membership grants broad operational visibility and coordination authority within that farm, but not Owner-only strategy, membership administration, compensation, or cross-farm data.

### Farm hand

A farm hand does not receive broad direct access to the farm’s base operational tables. The farm-hand interface reads worker-safe prepared records and writes through controlled result functions.

This distinction is important: RLS should not attempt to hide selected columns after returning a broad task, crop-cycle, project, or object row. The worker should receive a deliberately shaped record that contains only the context needed to perform assigned work.

## 4. Required normalized task assignment model

The current task model stores role and assignee decisions primarily inside `metadata`, including values such as `assigned_to`, `anna_task`, `owner_task`, and `marshall_task`. These values may remain as migration evidence but cannot remain the authorization boundary.

Before farm-hand policies are activated, `atlas.tasks` needs normalized fields equivalent to:

```text
assigned_membership_id uuid null
visibility_scope text not null
owner_only boolean not null default false
manager_visible boolean not null default true
worker_visible boolean not null default false
```

Recommended `visibility_scope` values:

- `owner`
- `management`
- `assigned_worker`
- `farm_shared`
- `system_internal`

The final implementation may use an assignment join table rather than a single assignment column if tasks need multiple assignees. The security requirement is fixed: assignment and visibility must be relational, farm-scoped, and server-owned.

## 5. RLS helper functions

The existing functions below are structurally useful and should be retained after review:

- `atlas.is_farm_member(farm_id)`
- `atlas.is_farm_owner(farm_id)`
- `atlas.current_farm_role(farm_id)`

They already resolve `auth.uid()` against active `farm_memberships` and are executable only by `authenticated`.

The replacement policy layer also needs narrowly scoped helpers such as:

```text
atlas.is_farm_manager_or_owner(farm_id)
atlas.current_membership_id(farm_id)
atlas.can_view_task(task_id)
atlas.can_transition_task(task_id, transition)
atlas.can_manage_memberships(farm_id)
```

Rules for policy helpers:

- `SECURITY DEFINER` only when required to avoid RLS recursion.
- Fixed `search_path` containing only trusted schemas.
- No dynamic SQL.
- No `PUBLIC` or `anon` execute permission.
- Each helper returns the smallest possible answer.
- Helpers do not perform mutations.

## 6. Table-by-role RLS policy matrix

Legend:

- **R** — direct row read permitted.
- **W** — direct insert/update/delete may be permitted with row checks.
- **RPC** — access only through a controlled function that validates the actor and returns a safe shape.
- **None** — no application access for that role.
- **Service** — background or administrative service only.

### 6.1 Identity and membership

| Table | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `user_profiles` | R own; RPC admin | R own | R own | Keep self-read. Profile changes are self-service or controlled admin operations. |
| `farm_memberships` | R all memberships for owned farm; RPC manage | R self and operational coworker directory only | R self | Owners manage memberships through a controlled RPC. Do not allow direct client inserts/deletes. |
| `farms` | R/W owned farms | R managed farms | RPC minimal farm identity | Farm creation and deletion remain administrative. Worker receives farm name/key through prepared data. |

### 6.2 Shared registries

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `crop_profiles`, `crop_profile_aliases`, `crop_observation_types` | R/W or controlled admin | R | RPC/task-context read | Global or shared registries. No anonymous access. Writes limited to Owner/admin workflows. |
| `maintenance_type_profiles`, `production_rule_templates` | R/W | R | None | Operational rule registries, not worker browsing surfaces. |
| `action_requirement_templates` | R/W | R | RPC task-context read | A worker may receive selected tool/resource instructions as part of a task card. |

### 6.3 Farm structure and current state

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `zones`, `growing_objects` | R/W owned farm | R/W managed farm | RPC assigned-task context | Worker does not browse all land objects directly. |
| `object_state` | R/W | R/W operational fields | RPC assigned-task context; mutation through result RPC | Worker observations update state only through controlled workflows. |
| `object_contents`, `crop_cycles`, `plant_instances` | R/W | R/W operational fields | RPC assigned-task context | These rows may contain planning context beyond the worker’s need. |
| `plant_lineages` | R/W | R | RPC only when attached to assigned work | Long-lived identity registry. |
| `crop_cycle_impacts` | R/W | R/W observations | RPC observation/result path | Enable RLS before user-scoped access. |
| `object_content_entity_links`, `object_content_resolutions` | R/W | R | None | Canonicalization/provenance support; not a worker surface. |
| `identity_review_queue` | R/W | R if delegated | None | Owner/integrity workflow. |

### 6.4 Field memory, planting, and observations

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `field_logs` | R/W | R/W | RPC create/read own relevant results | Do not permit broad worker direct inserts. The result function stamps actor identity. |
| `field_log_objects` | R/W via parent | R/W via parent | RPC only | Join policy inherits access from `field_logs` and the linked farm object. |
| `planting_claims` | R/W | R/W delegated operations | RPC through assigned planting completion | Structured planting capture must remain atomic with task/result state. |
| `planting_claim_objects` | R/W via parent | R/W via parent | RPC only | Join policy inherits planting-claim authorization. |
| `object_activity_events` | R/W | R/W | RPC create/read assigned context | Enable RLS. Worker events are written by controlled functions. |
| `propagation_events` | R/W | R/W delegated | RPC assigned work only | Same event-write rule. |

### 6.5 Tasks, assignments, and results

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `tasks` | R/W all farm tasks | R/W management-visible tasks | RPC worker-safe assigned/shared tasks | Worker should not receive broad direct base-table reads until normalized visibility exists. |
| `task_objects` | R/W via task | R/W via task | RPC only | Join access inherits the visible task. |
| `task_crop_cycles` | R/W via task | R/W via task | RPC only | Enable RLS. Join access inherits task and crop-cycle visibility. |
| `task_resource_requirements` | R/W via task | R/W via task | RPC task-safe projection | Worker receives only instructions/resources for the visible task. |
| `task_transitions` | R | R | RPC own visible task history | Inserts only through the canonical transition function. |
| `task_outcome_events` | R | R | RPC own visible task history | Inserts only through the canonical transition/result function. |

### 6.6 Projects, production, and maintenance planning

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `projects`, `project_goals`, `project_steps`, `project_task_links` | R/W | R/W delegated projects | RPC task context only | Project planning is not a general worker browse surface. Enable RLS on `project_task_links`. |
| `production_plans`, `production_successions` | R/W | R delegated operational plan | None or RPC assigned-task context | Remove all anonymous policies before authenticated rollout. |
| `maintenance_objects`, `maintenance_dependencies`, `maintenance_history`, `maintenance_scheduler_settings` | R/W | R/W | RPC assigned maintenance work | Worker reports completion/condition through controlled functions. |
| `rhythm_templates` | R/W | R | RPC prepared daily hand | Enable RLS. Worker receives a derived hand, not template administration. |

### 6.7 Resources and Owner/integrity records

| Tables | Owner | Manager | Farm hand | Policy decision |
|---|---|---|---|---|
| `resources` | R/W | R/W operational inventory | RPC task requirements only | Worker does not browse financial or strategic inventory by default. |
| `truth_sources`, `truth_assertions` | R/W | R if delegated | None | Owner/integrity data. |
| `integrity_audit_runs` | R/W | R if delegated | None | Internal/Owner diagnostic record. |
| `inbox_items` | R/W | R/W delegated | RPC submit/read own where required | Enable RLS; the current broad endpoint must be replaced. |

## 7. Join-table policy rule

A join table without `farm_id` must never be opened using an unconditional authenticated policy.

Its RLS condition must inherit the parent row’s farm and visibility. Examples:

- `task_objects` checks the linked task.
- `task_crop_cycles` checks the linked task and crop cycle.
- `field_log_objects` checks the linked field log.
- `planting_claim_objects` checks the linked planting claim.
- `project_task_links` checks the linked project and task.
- `task_resource_requirements` checks the linked task.

Where policy complexity would produce expensive or recursive queries, access should remain behind a security-definer RPC with an explicit membership check.

## 8. View classification

### 8.1 Candidate prepared read views

These are useful fast-read candidates after all underlying tables have correct RLS and the views run with `security_invoker=true`:

- `v_canonical_farm_graph`
- `v_object_event_timeline`
- `v_object_workbench`
- `v_task_cards`
- `v_current_crop_cycles_by_object`
- `v_crop_cycle_registry`
- `v_planned_crop_cycles_by_object`
- `crop_cycle_yield_forecast`

Required changes:

- Recreate every retained view as `security_invoker=true`.
- Include stable farm identifiers in every prepared record.
- Remove sensitive task metadata and Owner-only fields from worker-safe projections.
- Split broad views into Owner/Manager and worker-safe shapes where necessary.

### 8.2 Owner/Manager-only diagnostic views

- `v_integrity_issue_summary`
- `v_integrity_summary`
- `v_integrity_report`
- `v_phase_2_graph_summary`
- `v_crop_cycle_registry_gaps`
- `v_crop_profile_coverage`

These should never be part of the farm-hand read path.

### 8.3 Views that must be rebuilt before reuse

- `v_dashboard_zones` — broad aggregate and currently not security-invoker.
- `v_project_cards` — broad nested project/task hydration.
- `v_resource_summary` — potentially sensitive inventory aggregation.
- `v_object_operational_timeline` — broad multi-table view and not security-invoker.
- `v_crop_cycle_observation_timeline` — includes actor and raw event context.
- `v_today_rhythm` — reads a table with RLS disabled and is not user-scoped.

### 8.4 Retire or replace

- `v_object_inspection_unknowns` — hardcoded to `elm_farm`; replace with a farm-scoped diagnostic query or RPC.

No retained view should hardcode Elm Farm as the only farm.

## 9. Function and RPC classification

### 9.1 Membership helpers — keep

- `is_farm_member`
- `is_farm_owner`
- `current_farm_role`

Disposition: authenticated execution only; no anonymous execution.

### 9.2 Trigger-only functions — revoke direct execution

A trigger continues to invoke its function without `PUBLIC`, `anon`, or `authenticated` execute grants. Direct execution should be revoked for functions such as:

- `set_updated_at`
- `apply_sowing_projections`
- `collapse_new_germination_duplicate_v1`
- `create_delayed_followup_task`
- `create_germination_check_after_sowing_done`
- `derive_task_engine_fields`
- task/crop normalization, guard, mirroring, and synchronization triggers
- `strip_person_attribution_from_field_records`
- task-object reconciliation triggers

Current default execute grants expose many trigger functions unnecessarily. Phase C should revoke them from `PUBLIC`, `anon`, and `authenticated`.

### 9.3 Pure helpers — keep internal or authenticated only when needed

Examples:

- `compact_spacing_lines`
- `identity_token`
- `germination_variety_key_v1`
- `resolve_crop_profile_id_v1`
- `task_destination_object_ids_v1`

These do not need anonymous execution. Most can remain internal database helpers.

### 9.4 Read RPCs — rebuild with membership checks

- `get_object_operational_timeline_v1`
- maintenance preview functions
- weeding preview functions

The current object timeline RPC is security-definer and anonymously executable. It must be revoked and rebuilt to validate the requested farm against `auth.uid()` before returning records.

### 9.5 Controlled user mutation RPCs

Candidate public authenticated mutations after hardening:

- `record_task_transition_v1`
- replacement `record_crop_observation_v2`
- replacement `record_object_event_v2`
- replacement maintenance completion/condition functions

Each must:

1. Resolve the target row.
2. Confirm active membership at the target farm.
3. Confirm role and task visibility.
4. Confirm the actor may perform the requested transition.
5. Stamp `auth.uid()` and membership identity on result/event rows.
6. Reject client-supplied actor identity.
7. Preserve idempotency.
8. Return only a safe response shape.

### 9.6 Service-only planning and reconciliation

These remain executable only by `service_role` or scheduled infrastructure:

- `reconcile_operational_work_v1`
- `refresh_weeding_collection_tasks`
- `recalculate_weeding_priorities`
- `reconcile_active_weeding_tasks_for_object`
- `reconcile_sowing_bed_subtasks_v1`
- maintenance scheduler/control functions
- registry synchronization functions that are not invoked only as triggers

Planning functions may create broad downstream effects and must not be callable directly by ordinary authenticated clients.

## 10. Critical current RPC defect

`record_task_transition_v1` is currently executable by anonymous and authenticated roles and is `SECURITY DEFINER`.

The wrapper validates only that a task ID exists and scopes the idempotency key. It does not establish:

- the signed-in actor,
- active farm membership,
- task visibility,
- assignment,
- role permission,
- whether the transition is valid for that actor.

The internal function can then update the task, create field logs, planting claims, object contents, object events, object state, task outcome events, transitions, project-step completion, recurring tasks, child completions, and triggered follow-up work.

Therefore:

- anonymous execute must be revoked before the new authenticated application path is exposed;
- the existing function must not be used as the final user authorization boundary;
- a hardened wrapper must perform actor authorization before entering the existing atomic transition engine;
- the internal function remains service-only.

## 11. First replacement vertical-slice contract

### 11.1 Scope

The first complete replacement path is:

```text
Login
→ standard Supabase cookie session
→ getAtlasSession()
→ active membership selection
→ getVisibleTask()
→ authorized task card
→ submitTaskTransition()
→ task result + transition + farm-state effects
```

No Owner dashboard, day overview, farm launcher, or worker navigation should be treated as complete before this path passes all tests.

### 11.2 Required application modules

```text
lib/atlas-auth/
  server-client.ts
  browser-client.ts
  session.ts
  types.ts

lib/atlas-authorization/
  memberships.ts
  tasks.ts
  transitions.ts

lib/atlas-data/
  tasks.ts
  results.ts

app/(auth)/login/
app/(rebuild)/task-test/[taskId]/
app/api/atlas-v2/task/[taskId]/
app/api/atlas-v2/task/[taskId]/transition/
```

The exact route names may change, but the v2/rebuild path must remain isolated from legacy endpoints until it is complete.

### 11.3 Normalized `AtlasSession`

```ts
type AtlasRole = "owner" | "manager" | "farm_hand";

type AtlasMembership = {
  membershipId: string;
  farmId: string;
  farmKey: string;
  farmName: string;
  role: AtlasRole;
  workerKey: string | null;
  permissions: Record<string, boolean>;
};

type AtlasSession = {
  userId: string;
  email: string | null;
  displayName: string;
  memberships: AtlasMembership[];
};
```

No route may depend on a different identity shape.

### 11.4 Minimum database surface for the slice

The slice touches only:

- `user_profiles`
- `farm_memberships`
- `farms`
- `tasks`
- `task_objects`
- `growing_objects`
- `zones`
- `task_transitions`
- `task_outcome_events`
- `field_logs`
- `field_log_objects`
- `object_activity_events`
- `object_state`
- planting tables only when the selected task requires structured planting capture

All other planning and dashboard surfaces remain outside the first slice.

### 11.5 Read contract

`getVisibleTask(session, taskId)` must:

- load the task’s farm;
- require an active membership;
- return the full task for Owner;
- return the management-safe task for Manager;
- return only an assigned/shared worker-safe task for a Farm Hand;
- return not-found rather than revealing a forbidden task;
- omit private metadata and unrelated history from worker responses.

### 11.6 Transition contract

`submitTaskTransition(session, taskId, input)` must:

- verify task access before mutation;
- allow Owner all valid transitions;
- allow Manager operational transitions within delegated scope;
- allow Farm Hand only result/reporting transitions on assigned/shared work;
- derive the actor from the session;
- preserve idempotency;
- call one atomic database transition function;
- return the new safe task/result state.

### 11.7 Required tests

#### Session

- valid session resolves one normalized shape;
- expired session refreshes once or returns unauthenticated;
- no cookie-presence-only authorization remains in the v2 path;
- logout invalidates the same session path.

#### Owner

- can read any task at an owned farm;
- can transition any valid task at that farm;
- cannot access a farm without membership.

#### Manager

- can read management-visible tasks at the managed farm;
- can perform allowed operational transitions;
- cannot manage memberships or access Owner-only records.

#### Farm hand

- can read an assigned task;
- can submit completion, partial, blocked, note, and permitted evidence;
- cannot read another worker’s task;
- cannot read Owner or Manager tasks;
- cannot transition a task by guessing its UUID;
- cannot expand access by altering farm key, worker key, role, scope, metadata, or request payload.

#### Database

- user-scoped reads succeed only through intended policies/functions;
- anonymous execution of mutation RPCs fails;
- trigger-only functions are not directly executable;
- service-only planners remain unavailable to authenticated users;
- transition side effects remain atomic and idempotent.

## 12. Migration sequence

Phase B and C should implement the slice in this order:

1. Standard Supabase server/browser clients and cookie handling.
2. One normalized `getAtlasSession()`.
3. Assignment/visibility normalization for tasks.
4. Hardened membership and task-authorization helpers.
5. Minimum RLS policies for the slice tables.
6. Revoke anonymous/public function execution.
7. Harden the task-transition wrapper; keep internal engine service-only.
8. Build the isolated task-test read route.
9. Build the isolated transition route.
10. Add Owner, Manager, and Farm-Hand integration fixtures.
11. Pass direct URL, UUID guessing, expired-session, and Safari tests.
12. Only then build the Owner farm launcher and role route groups.

## 13. Phase A completion boundary

Phase A is complete when the repository contains:

- current-system inventory;
- route and data-access matrix;
- RLS table-by-role matrix;
- view and function disposition;
- first replacement vertical-slice contract.

This document completes the policy-design portion of that boundary. The next implementation step is Phase B: create the standard Supabase session clients and the single normalized `getAtlasSession()` resolver without attempting to restore legacy Atlas pages.
