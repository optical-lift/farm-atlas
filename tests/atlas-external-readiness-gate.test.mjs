import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260814043920_external_readiness_gate_v1.sql"),
  "utf8",
);
const preservationMigration = readFileSync(
  join(root, "supabase/migrations/20260814044133_external_readiness_gate_preserve_blocker_v1.sql"),
  "utf8",
);

test("external readiness is a durable release gate rather than worker-facing blocked work", () => {
  assert.match(migration, /create table if not exists atlas\.task_external_readiness_gates/);
  assert.match(migration, /gate_state text not null default 'waiting'/);
  assert.match(migration, /visibility_scope='system_internal'/);
  assert.match(migration, /due_date=null/);
  assert.match(migration, /state=case when occurrence\.state in \('completed','cancelled'\) then occurrence\.state else 'planned' end/);
  assert.match(migration, /released_task_id=case when occurrence\.state in \('completed','cancelled'\) then occurrence\.released_task_id else null end/);
  assert.match(migration, /external_gate\.gate_state=''waiting''/);
  assert.match(migration, /then false/);
});

test("owner readiness resolution restores the same canonical task identity", () => {
  assert.match(migration, /create or replace function atlas\.owner_set_external_readiness_v1/);
  assert.match(migration, /if not atlas\.is_farm_owner\(v_task\.farm_id\)/);
  assert.match(migration, /set status=v_gate\.restore_status/);
  assert.match(migration, /visibility_scope=v_gate\.restore_visibility_scope/);
  assert.match(migration, /released_task_id=case when occurrence\.state in \('completed','cancelled'\) then occurrence\.released_task_id else v_task\.id end/);
  assert.match(migration, /release_reason='external_readiness_satisfied'/);
  assert.match(migration, /worker_day_on_or_after_v1/);
});

test("Home Depot pickup is repaired by stable identity behind the real pickup-ready condition", () => {
  assert.match(migration, /anna_20260807_home_depot_curbside_pickup/);
  assert.match(migration, /home_depot_order_ready_for_pickup/);
  assert.match(migration, /Home Depot order ready for pickup/);
  assert.match(migration, /Home Depot order is not ready for pickup yet/);
});

test("readiness cycling preserves the real blocker text instead of degrading to a generic wait", () => {
  assert.match(preservationMigration, /blocker_text=coalesce\(nullif\(atlas\.task_external_readiness_gates\.blocker_text, ''''\),excluded\.blocker_text\)/);
});

test("external readiness gate is service-owned and owner mutation is explicitly registered", () => {
  assert.match(migration, /alter table atlas\.task_external_readiness_gates enable row level security/);
  assert.match(migration, /revoke all on atlas\.task_external_readiness_gates from public,anon,authenticated/);
  assert.match(migration, /grant select,insert,update,delete on atlas\.task_external_readiness_gates to service_role/);
  assert.match(migration, /atlas\.owner_set_external_readiness_v1\(uuid, text, text\)/);
  assert.match(migration, /'owner_admin_endpoint','verified','active'/);
});
