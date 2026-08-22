import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260822184340_authorize_exact_planned_establishment_result_v1.sql", import.meta.url), "utf8");
const normalized = migration.replace(/\s+/g, " ").trim();

test("planned sow establishment uses exact canonical source-task identity", () => {
  assert.match(normalized, /action_key,'?'\)? <> 'sow'|action_key,''\) <> 'sow'/i);
  assert.match(normalized, /operation_class,''\) <> 'establish_aboveground'/i);
  assert.match(normalized, /cc\.lifecycle_status='planned'/i);
  assert.match(normalized, /cc\.cycle_state='planned'/i);
  assert.match(normalized, /cc\.source_task_id=p_task_id/i);
  assert.match(normalized, /canonical_source_task_match/i);
  assert.match(normalized, /crop_cycle\.source_task_id/i);
});

test("planned establishment bridge keeps reality and routing gates intact", () => {
  assert.match(normalized, /other\.lifecycle_status='active'/i);
  assert.match(normalized, /v_active_conflicts>0/i);
  assert.match(normalized, /task_execution_readiness_v1\(p_task_id\)/i);
  assert.match(normalized, /definiteCapacityConflict/i);
  assert.match(normalized, /presented_work_selection_rows_v1/i);
  assert.match(normalized, /selection\.presentation_state='presented'/i);
  assert.match(normalized, /coalesce\(selection\.overload,false\)=false/i);
  assert.match(normalized, /doesNotAuthorizeLaterCropOperations/i);
  assert.match(normalized, /doesNotInferPhysicalCompletion/i);
});

test("Worker State v2 applies the establishment bridge before choosing a result adapter", () => {
  assert.match(normalized, /worker_state_transition_selection_bridge_v1[\s\S]*worker_state_transition_planned_establishment_bridge_v1/i);
  assert.match(normalized, /v_authorized:=coalesce\(v_card #>> '\{transition,state\}',''\)='authorized_for_routed_day'/i);
  assert.match(normalized, /domainAdapter','direct_sow_seed_v1'/i);
  assert.match(normalized, /choices',jsonb_build_array\('depleted','exact_remaining','some_left_unknown'\)/i);
});

test("the establishment helper stays database-internal", () => {
  assert.match(normalized, /revoke all on function atlas\.worker_state_transition_planned_establishment_bridge_v1\(uuid,uuid,uuid,date,jsonb\) from public, anon, authenticated/i);
  assert.doesNotMatch(normalized, /grant execute on function atlas\.worker_state_transition_planned_establishment_bridge_v1[\s\S]{0,120}authenticated/i);
});