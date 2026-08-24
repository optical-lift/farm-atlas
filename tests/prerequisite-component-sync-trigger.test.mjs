import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260824175458_fix_prerequisite_component_sync_trigger_v1.sql",
  "utf8",
);

test("prerequisite component sync follows downstream task identity", () => {
  assert.match(migration, /sync_task_execution_components_from_prerequisite_trigger_v1/);
  assert.match(migration, /new\.downstream_task_id/);
  assert.match(migration, /old\.downstream_task_id/);
  assert.match(
    migration,
    /create trigger trg_sync_task_components_from_prerequisites_v1[\s\S]*execute function atlas\.sync_task_execution_components_from_prerequisite_trigger_v1\(\)/,
  );
  assert.doesNotMatch(
    migration,
    /create trigger trg_sync_task_components_from_prerequisites_v1[\s\S]*execute function atlas\.sync_task_execution_components_from_canonical_trigger_v1\(\)/,
  );
});

test("prerequisite trigger adapter stays internal", () => {
  assert.match(
    migration,
    /revoke all on function atlas\.sync_task_execution_components_from_prerequisite_trigger_v1\(\) from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function atlas\.sync_task_execution_components_from_prerequisite_trigger_v1\(\) to service_role/,
  );
});
