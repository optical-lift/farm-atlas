import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const networkDetail = readFileSync(
  new URL("../components/atlas/network-inputs-task-detail.tsx", import.meta.url),
  "utf8",
);
const prerequisiteMigration = readFileSync(
  new URL("../supabase/migrations/20260804090000_task_prerequisite_gates_and_network_outreach.sql", import.meta.url),
  "utf8",
);

test("the custom network checklist exposes the canonical task movement controls", () => {
  assert.match(networkDetail, /async function reschedule\(/);
  assert.match(networkDetail, /transition: "rescheduled"/);
  assert.match(networkDetail, />Tomorrow<\/button>/);
  assert.match(networkDetail, />Next week<\/button>/);
  assert.match(networkDetail, />Pick a date<\/button>/);
  assert.match(networkDetail, /"next_day"/);
  assert.match(networkDetail, /Moved to next Elm Farm calendar day from assigned task page/);
  assert.match(networkDetail, /Rescheduled from assigned task page/);
  assert.match(networkDetail, /Move or close this card/);
});

test("network outreach waits behind explicit owner prerequisites", () => {
  assert.match(prerequisiteMigration, /create table if not exists atlas\.task_prerequisites/);
  assert.match(prerequisiteMigration, /create or replace function atlas\.reconcile_task_prerequisite_gate_v1/);
  assert.match(prerequisiteMigration, /after update of status on atlas\.tasks/);
  assert.match(prerequisiteMigration, /'owner_20260804_get_elm_google_voice_number'/);
  assert.match(prerequisiteMigration, /'owner_20260804_write_anna_network_call_script'/);
  assert.match(prerequisiteMigration, /'owner_marshall_20260730_reconstruct_florist_inputs_contacts'/);
  assert.match(prerequisiteMigration, /'anna_20260730_source_free_farm_inputs'/);
  assert.match(prerequisiteMigration, /'deferred_hidden'/);
  assert.match(prerequisiteMigration, /assigned_membership_id = case when v_hidden then null/);
  assert.match(prerequisiteMigration, /visibility_scope = case when v_hidden then 'management'/);
  assert.match(prerequisiteMigration, /prerequisite_gate_restore/);
  assert.match(prerequisiteMigration, /parent_task_id = v_network_task\.id\) <> 8/);
});
