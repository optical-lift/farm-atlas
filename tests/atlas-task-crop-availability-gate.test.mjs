import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812023000_task_crop_availability_gate_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("commercial worker work can wait on observed crop availability without a fake prerequisite task", () => {
  assert.match(migration, /create table if not exists atlas\.task_crop_availability_gates/);
  assert.match(migration, /required_crop_label text not null/);
  assert.match(migration, /required_profile_metadata_key text/);
  assert.match(migration, /required_profile_metadata_value text/);
  assert.match(migration, /required_availability_status text not null default 'harvestable'/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks[^;]*harvest unlock/is);
});

test("waiting availability gate hides worker work and preserves its restore state", () => {
  assert.match(normalized, /set status='blocked', due_date=null, visibility_scope='system_internal'/);
  assert.match(migration, /restore_status text not null default 'open'/);
  assert.match(migration, /restore_visibility_scope text not null default 'assigned_worker'/);
  assert.match(migration, /restore_due_date date/);
});

test("harvestable matching crop truth satisfies and releases the waiting task", () => {
  assert.match(migration, /from atlas\.crop_harvest_availability availability/);
  assert.match(migration, /join atlas\.crop_cycles cycle/);
  assert.match(migration, /left join atlas\.crop_profiles profile/);
  assert.match(normalized, /lower\(availability\.status\)=lower\(v_gate\.required_availability_status\)/);
  assert.match(migration, /crop_profile_gate_matches_v1/);
  assert.match(normalized, /set gate_state='satisfied'/);
  assert.match(normalized, /set status=v_gate\.restore_status, due_date=v_gate\.restore_due_date, visibility_scope=v_gate\.restore_visibility_scope/);
});

test("harvest availability changes automatically reevaluate waiting gates", () => {
  assert.match(migration, /after insert or update of status,observed_date,source_event_id,estimated_quantity on atlas\.crop_harvest_availability/);
  assert.match(migration, /refresh_waiting_crop_availability_gates_v1\(new\.farm_id\)/);
});

test("Nixa Price Cutter research is literal and waits for real pollenless sunflower harvestability", () => {
  assert.match(migration, /task\.metadata->>'task_key'='anna_price_cutter_nixa_vendor_path'/);
  assert.match(migration, /Visit Nixa Price Cutter to learn how Elm can become a local flower vendor/);
  assert.match(migration, /'display_action','Visit'/);
  assert.match(migration, /'display_subject','Nixa Price Cutter'/);
  assert.match(migration, /'worker_result_label','Bring back'/);
  assert.match(migration, /'Sunflower','pollen_status','pollenless','harvestable'/);
  assert.doesNotMatch(migration, /2026-09-|2026-10-/);
});

test("new gate storage is not directly exposed to signed-in clients", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on atlas\.task_crop_availability_gates from public,anon,authenticated/);
  assert.match(migration, /grant select,insert,update,delete on atlas\.task_crop_availability_gates to service_role/);
});
