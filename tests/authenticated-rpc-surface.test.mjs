import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260731185000_atlas_narrow_authenticated_rpc_surface_v1.sql",
);
const sqlLines = migration.split(/\r?\n/).map((line) => line.trim());

test("authenticated callers cannot invoke Atlas trigger bodies directly", () => {
  assert.match(migration, /p\.prorettype = 'pg_catalog\.trigger'::regtype/);
  assert.match(
    migration,
    /revoke execute on function %s from authenticated/,
  );
  assert.match(migration, /exposed_trigger_count <> 0/);
});

test("wrapper implementation helpers are removed from the signed-in API", () => {
  for (const helper of [
    "configure_project_review_core_v1",
    "configure_seed_inventory_freshness_core_v1",
    "record_project_review_result_core_v1",
    "record_seed_inventory_result_core_v1",
    "reopen_task_completion_v1_internal",
    "task_destination_object_ids_v1",
  ]) {
    assert.match(migration, new RegExp(helper));
  }
  assert.match(migration, /exposed_helper_count <> 0/);
});

test("all remaining mutable Atlas search paths are fixed", () => {
  for (const routine of [
    "biological_clock_state_from_boundaries_v1",
    "set_germination_thinning_due_date",
    "set_updated_at",
    "strip_person_attribution_from_field_records",
    "task_destination_object_ids_v1",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter function atlas\\.${routine}`),
    );
  }
  assert.match(migration, /set search_path = pg_catalog, atlas/);
  assert.match(migration, /mutable_path_count <> 0/);
});

test("supported app wrappers remain explicitly guarded by release gates", () => {
  for (const routine of [
    "universal_home_v1",
    "owner_operator_universal_home_v1",
    "worker_task_hand_v1",
    "record_quick_log_v1",
    "configure_project_review_for_member_v1",
    "owner_operator_configure_project_review_v1",
    "configure_seed_inventory_freshness_for_member_v1",
    "owner_operator_configure_seed_inventory_freshness_v1",
    "record_project_review_result_for_member_v1",
    "owner_operator_record_project_review_result_v1",
    "record_seed_inventory_result_for_member_v1",
    "owner_operator_record_seed_inventory_result_v1",
    "owner_reopen_task_completion_v1",
    "worker_reopen_task_completion_v1",
    "owner_operator_reopen_task_completion_v1",
  ]) {
    assert.match(migration, new RegExp(`atlas\\.${routine}`));
  }
  assert.match(migration, /lost authenticated execution/);
});

test("this slice only removes authenticated grants", () => {
  assert.equal(
    sqlLines.some((line) => /^grant\s+execute\b/i.test(line)),
    false,
  );
  assert.match(migration, /Web-push service-role execution was not preserved/);
});
