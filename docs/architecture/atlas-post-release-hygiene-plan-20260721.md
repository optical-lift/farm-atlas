# Atlas Post-Release Hygiene Plan — July 21, 2026

## Branch and timing

Branch: `agent/atlas-post-release-hygiene`

This branch starts from the documented PR #43 release head. It is intentionally separate from the shared-surface restoration. Do not apply these database changes to production, merge this branch, or retarget PR #43 while the current-head preview and authenticated Anna phone acceptance are still pending.

The branch currently contains planning only. Each implementation group below must receive its own migration, source-contract tests, live identity matrix, and rollback notes.

## Goals

1. Remove avoidable privilege and search-path ambiguity without breaking membership-scoped RPCs.
2. Improve the joins Atlas actually uses for assignments, zones, objects, crop cycles, and production successions.
3. simplify overlapping RLS evaluation while preserving the exact Owner, Manager, Farm-Hand, and outsider results proven for PR #43.
4. Remove only demonstrably duplicate or obsolete indexes.
5. Turn the existing Resources records into a visible dependency system for task readiness and blockers.

## Baseline captured before implementation

### Security advisor: Atlas-specific findings

- `atlas.set_updated_at` has a mutable search path.
- `atlas.strip_person_attribution_from_field_records` has a mutable search path.
- `atlas.set_germination_thinning_due_date` has a mutable search path.
- `atlas.task_destination_object_ids_v1` has a mutable search path.
- `atlas.farm_membership_invites` has RLS enabled with no direct table policies.
- Several internal trigger/helper functions inherit broad execute grants from default function privileges.
- App-facing `SECURITY DEFINER` RPCs are intentionally executable by authenticated users only when they contain their own membership/role checks. They must be classified, not blindly revoked.

### Performance advisor: high-value Atlas findings

Missing foreign-key indexes include:

- `atlas.tasks.assigned_membership_id`
- `atlas.tasks.zone_id`
- `atlas.growing_objects.zone_id`
- `atlas.crop_cycles.object_id`
- `atlas.crop_cycles.crop_profile_id`
- `atlas.production_plans.crop_profile_id`
- `atlas.production_plans.rule_template_id`
- `atlas.production_successions.crop_cycle_id`
- `atlas.production_successions.sow_task_id`
- `atlas.field_log_objects.zone_id`
- `atlas.maintenance_dependencies.dependent_task_id`
- `atlas.maintenance_history.object_id`

Additional findings:

- `farm_memberships_read_self` and `user_profiles_read_self` reevaluate `auth.uid()` per row instead of using an initialization-plan-safe scalar subquery.
- `atlas.farm_memberships`, `atlas.tasks`, and `atlas.user_profiles` each have overlapping permissive `SELECT` policies.
- `atlas.tasks` has two byte-for-byte equivalent unique partial indexes:
  - `tasks_active_engine_instance_idx`
  - `tasks_one_active_engine_instance_uidx`
- Unused-index notices exist, but a zero usage count alone is not sufficient evidence to drop an index after a recent deployment or statistics reset.

### Resources baseline

The dependency layer already contains:

- 28 `atlas.resources` rows.
- 22 `atlas.task_resource_requirements` rows.
- 12 `atlas.action_requirement_templates` rows.

The problem is operational integration and visibility, not absence of schema/data.

## Phase 1 — Function privilege inventory and classification

Create a generated inventory of every Atlas function with:

- signature and owner;
- `SECURITY DEFINER` versus invoker;
- configured `search_path`;
- grants to `PUBLIC`, `anon`, `authenticated`, and `service_role`;
- whether it is called by an application route, another function, or only a trigger;
- its internal membership/role assertion.

Classify each function into one of four groups:

1. **Public/anonymous by design** — expected to be rare in `atlas`.
2. **Authenticated app RPC** — direct application entry point with explicit membership/role checks.
3. **Internal helper** — callable only by controlled RPCs; direct authenticated execution should be revoked.
4. **Trigger-only function** — direct execution should be revoked from `PUBLIC`, `anon`, and `authenticated`.

Initial helper/trigger candidates for direct-grant cleanup:

- `enforce_task_reality_gate()`
- `mirror_task_spacing_lines()`
- `roll_partial_task_to_next_day_v1()`
- `set_germination_thinning_due_date()`
- `unlock_snapdragon_lights_task_on_germination()`
- supporting destination/variety helper functions where no application route calls them directly

Acceptance criteria:

- No application route loses a required RPC.
- Anna's shared reader and assigned-task mutation matrix remains unchanged.
- Authenticated outsiders remain denied.
- Trigger behavior continues through real insert/update tests.
- Direct execution of trigger-only functions is denied.

## Phase 2 — Search-path hardening

Add explicit, minimal `search_path` settings to the four Atlas functions identified by the advisor:

- `atlas.set_updated_at`
- `atlas.strip_person_attribution_from_field_records`
- `atlas.set_germination_thinning_due_date`
- `atlas.task_destination_object_ids_v1`

Prefer schema-qualified object references inside function bodies. Preserve function signatures so trigger bindings and dependent RPCs do not need replacement.

Acceptance criteria:

- The four Atlas mutable-search-path warnings disappear.
- Existing triggers remain attached.
- Task date generation, germination thinning timing, person-attribution stripping, and destination-object derivation produce identical results before and after migration.

## Phase 3 — High-value indexes first

Add indexes in measured groups, beginning with the relationships on the hottest operational paths:

### Group A: task and assignment views

- `tasks(assigned_membership_id)` with a useful partial/filter shape based on the actual open/blocked query plans.
- `tasks(zone_id)`.
- Consider a composite index that matches the canonical task-card reader only after `EXPLAIN (ANALYZE, BUFFERS)` proves it is preferable to separate indexes.

### Group B: zone/object/history navigation

- `growing_objects(zone_id)`.
- `crop_cycles(object_id)`.
- `crop_cycles(crop_profile_id)`.
- `field_log_objects(zone_id)`.
- `maintenance_history(object_id)`.

### Group C: production plan joins

- `production_plans(crop_profile_id)`.
- `production_plans(rule_template_id)`.
- `production_successions(crop_cycle_id)`.
- `production_successions(sow_task_id)`.

Do not add every advisor-listed index mechanically. For low-row-count or write-heavy tables, capture query evidence and estimated growth first.

Acceptance criteria:

- Canonical Home/Day/Week/Month, object workbench, and production reader query plans use the intended indexes where selective.
- No meaningful regression in task-transition or field-log writes.
- Advisor count decreases for the selected foreign keys.
- Index names describe table and key consistently.

## Phase 4 — Duplicate and unused index review

### Confirmed duplicate

`tasks_active_engine_instance_idx` and `tasks_one_active_engine_instance_uidx` are identical unique partial indexes on `(farm_id, engine_instance_key)` for active `open`/`blocked` tasks.

Preferred cleanup:

- Preserve `tasks_one_active_engine_instance_uidx` because its name expresses the invariant.
- Drop `tasks_active_engine_instance_idx` only after checking that no migration, test, or operational script refers to that exact index name.

### Unused notices

Review Atlas unused-index notices with:

- `pg_stat_user_indexes` age/reset context;
- production query logs;
- index size;
- write overhead;
- uniqueness/constraint role;
- seasonal queries that may not have run yet.

Never remove a unique or release-guard index merely because the advisor currently reports zero scans.

Acceptance criteria:

- The Atlas duplicate-index warning is removed.
- The one-active-engine-instance invariant remains enforced under concurrent insert tests.
- Every dropped unused index has written evidence and a restoration statement.

## Phase 5 — RLS evaluation cleanup

### Init-plan rewrites

Rewrite self-read predicates from direct `auth.uid()` calls to `(select auth.uid())` where semantically equivalent:

- `farm_memberships_read_self`
- `user_profiles_read_self`

### Policy consolidation

Evaluate consolidating these overlapping `SELECT` policies:

- `farm_memberships_read_operations` + `farm_memberships_read_self`
- `tasks_read_manager` + `tasks_read_owner`
- `user_profiles_read_operations` + `user_profiles_read_self`

The final predicates must preserve all current visibility outcomes. Policy consolidation is not permission expansion.

Required identity matrix after every policy change:

- Owner.
- Manager.
- Anna / Farm Hand.
- Authenticated outsider.
- Signed-out/anon.

Acceptance criteria:

- The selected init-plan and multiple-permissive-policy warnings disappear.
- Row counts and visible IDs match the pre-migration fixtures for each identity.
- Anna still sees shared farm context but no Owner-only task content.
- Owner and Manager retain their intended wider operational reads.
- Outsider and anon remain denied.

## Phase 6 — Membership-invite sealed-table documentation

`atlas.farm_membership_invites` has RLS enabled with no direct table policies. That can be an intentional sealed-table design when every operation passes through narrowly checked RPCs.

Document and test:

- Which invite RPCs are Owner-only.
- Which pending/accept RPC is available to the intended signed-in invitee.
- Why direct table reads/writes are forbidden.
- Expiration, revocation, duplicate-email, and replay behavior.
- Which service-side route, if any, marks an invite sent or records an auth user.

Acceptance criteria:

- Direct table access remains unavailable.
- Owner can prepare/revoke/list only within the owned farm.
- A recipient can read/accept only the matching valid invite.
- Anna cannot prepare, revoke, or inspect another person's invite.
- The advisor finding is documented as accepted architecture or replaced by explicit deny policies if that improves clarity without opening access.

## Phase 7 — Make Resources operational

The schema and seed data exist. Connect them to the user experience and task engine.

Required behavior:

- Task detail shows required resources as linked objects, not commentary text.
- A missing resource can supply a structured blocker reason.
- Resource availability changes can unlock or reclassify dependent work.
- Action templates generate consistent resource requirements.
- Mowing, weeding, sowing, planting, harvest, and post-harvest work can each expose relevant tools/materials without duplicating descriptions across tasks.
- Owner controls resource inventory/availability; Anna reads requirements and records field outcomes within assignment scope.

Initial audit questions:

- How many of the 22 requirements point to current canonical tasks?
- Which of the 28 resources have no requirement links?
- Which action templates create requirements that the current task engine ignores?
- Can `blocked` tasks point to a resource requirement instead of relying only on free text?

Acceptance criteria:

- At least one complete workflow is proven end to end: action template → task requirement → visible task resource → unavailable blocker → availability restored → task unblocked.
- No hardcoded resource commentary is required for that workflow.
- Resource state is farm-scoped and covered by the same Owner/Farm-Hand identity matrix.

## Implementation order and release discipline

1. Add SQL/source inventory tests before migrations.
2. Implement one phase per migration or tightly related migration set.
3. Run repository tests and production build.
4. Apply to an isolated Supabase branch or controlled preview environment first.
5. Re-run security and performance advisors.
6. Run the complete Owner/Manager/Anna/outsider/anon matrix.
7. Verify a current-head Vercel preview.
8. Only then prepare a focused pull request to the accepted post-release base.

## Explicit exclusions

- Do not change the shared purple homepage contract.
- Do not recreate a reduced Farm-Hand portal.
- Do not mix Titus, Song, `draft`, `public`, or unrelated schema advisor findings into this Atlas branch.
- Do not remove app-facing authenticated RPC grants solely because a generic advisor labels authenticated `SECURITY DEFINER` execution as a warning; inspect the function's internal authorization contract first.
- Do not merge this hygiene work before PR #43 has passed authenticated Anna mobile acceptance and been deliberately released.
