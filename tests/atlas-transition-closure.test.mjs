import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("legacy-shaped task cards are supplied through a membership-scoped reader", () => {
  const route = read("app/api/atlas/task-cards/route.ts");
  const migration = read("supabase/migrations/20260721053300_atlas_add_membership_scoped_task_cards_reader.sql");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /task_cards_v1/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);

  assert.match(migration, /returns setof atlas\.v_task_cards/);
  assert.match(migration, /atlas\.current_farm_role/);
  assert.match(migration, /task\.assigned_membership_id = v_membership_id/);
  assert.match(migration, /task\.visibility_scope = 'farm_shared'/);
  assert.match(migration, /revoke all .* from public, anon/is);
  assert.match(migration, /grant execute .* to authenticated, service_role/is);
});

test("Owner Home remains built from farm state and canonical schedule", () => {
  const source = read("lib/atlas-data/owner-dashboard.ts");
  assert.match(source, /getFarmOperationalState/);
  assert.match(source, /getTaskSchedule/);
  assert.doesNotMatch(source, /getOwnerTaskRows/);
  assert.doesNotMatch(source, /owner-dashboard-core/);
  assert.doesNotMatch(source, /atlasSupabase/);
});

test("transition migration history matches the applied Supabase versions", () => {
  const versions = [
    "20260721022040_atlas_scope_task_relationship_reads.sql",
    "20260721031949_atlas_close_legacy_table_and_view_access.sql",
    "20260721032030_atlas_close_legacy_callable_operations.sql",
    "20260721032043_atlas_close_trigger_function_rpc_batch_one.sql",
    "20260721032052_atlas_close_trigger_function_rpc_batch_two.sql",
    "20260721032115_atlas_close_trigger_function_rpc_batch_three.sql",
    "20260721032131_atlas_revoke_public_legacy_operations.sql",
    "20260721032139_atlas_revoke_public_trigger_functions_one.sql",
    "20260721032146_atlas_revoke_public_trigger_functions_two.sql",
    "20260721032211_atlas_repair_object_states_and_worker_assignments.sql",
    "20260721032246_atlas_repair_legacy_planting_claim_links.sql",
    "20260721032356_atlas_repair_legacy_planting_claim_memory.sql",
    "20260721032422_atlas_resolve_transition_identity_reviews.sql",
    "20260721032431_atlas_mark_legacy_actor_attribution_unknown.sql",
    "20260721032449_atlas_add_transition_integrity_view.sql",
    "20260721032618_atlas_complete_boom_boom_white_crop_cycle.sql",
    "20260721051235_atlas_restore_worker_unfinished_transitions.sql",
    "20260721053300_atlas_add_membership_scoped_task_cards_reader.sql",
  ];

  for (const filename of versions) {
    assert.equal(existsSync(new URL(`../supabase/migrations/${filename}`, import.meta.url)), true, `Missing migration ${filename}`);
  }

  assert.equal(existsSync(new URL("../supabase/migrations/20260721023500_atlas_scope_task_relationship_reads.sql", import.meta.url)), false);
});

test("transition security and integrity migrations retain their guardrails", () => {
  const access = read("supabase/migrations/20260721031949_atlas_close_legacy_table_and_view_access.sql");
  assert.match(access, /security_invoker = true/);
  assert.match(access, /revoke all privileges on table atlas\.production_plans from anon/);
  assert.match(access, /revoke all privileges on table atlas\.v_project_cards from anon, authenticated/);

  const functions = [
    read("supabase/migrations/20260721032030_atlas_close_legacy_callable_operations.sql"),
    read("supabase/migrations/20260721032131_atlas_revoke_public_legacy_operations.sql"),
  ].join("\n");
  assert.match(functions, /record_crop_observation_v1/);
  assert.match(functions, /from public/);
  assert.match(functions, /to service_role/);

  const integrity = read("supabase/migrations/20260721032449_atlas_add_transition_integrity_view.sql");
  for (const invariant of [
    "objects_without_state",
    "planting_claims_without_object_link",
    "assigned_worker_tasks_without_membership",
    "open_identity_reviews",
    "anonymous_production_write_grants",
    "anonymous_definer_functions",
    "anonymous_legacy_view_reads",
  ]) {
    assert.match(integrity, new RegExp(invariant));
  }
});
