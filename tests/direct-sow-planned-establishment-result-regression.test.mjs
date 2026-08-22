import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260822184340_authorize_exact_planned_establishment_result_v1.sql", import.meta.url), "utf8");
const normalized = migration.replace(/\s+/g, " ").trim();

test("planned sow establishment uses exact canonical source-task identity", () => {
  assert.ok(normalized.includes("coalesce(v_task.action_key,'') <> 'sow'"));
  assert.ok(normalized.includes("coalesce(v_task.operation_class,'') <> 'establish_aboveground'"));
  assert.ok(normalized.includes("cc.lifecycle_status='planned'"));
  assert.ok(normalized.includes("cc.cycle_state='planned'"));
  assert.ok(normalized.includes("cc.source_task_id=p_task_id"));
  assert.ok(normalized.includes("canonical_source_task_match"));
  assert.ok(normalized.includes("crop_cycle.source_task_id"));
});

test("planned establishment bridge keeps reality and routing gates intact", () => {
  assert.ok(normalized.includes("other.lifecycle_status='active'"));
  assert.ok(normalized.includes("v_active_conflicts>0"));
  assert.ok(normalized.includes("task_execution_readiness_v1(p_task_id)"));
  assert.ok(normalized.includes("definiteCapacityConflict"));
  assert.ok(normalized.includes("presented_work_selection_rows_v1"));
  assert.ok(normalized.includes("selection.presentation_state='presented'"));
  assert.ok(normalized.includes("coalesce(selection.overload,false)=false"));
  assert.ok(normalized.includes("doesNotAuthorizeLaterCropOperations"));
  assert.ok(normalized.includes("doesNotInferPhysicalCompletion"));
});

test("Worker State v2 applies the establishment bridge before choosing a result adapter", () => {
  const selectionBridge = normalized.indexOf("worker_state_transition_selection_bridge_v1");
  const establishmentBridge = normalized.indexOf("worker_state_transition_planned_establishment_bridge_v1", selectionBridge + 1);
  const authorizationCheck = normalized.indexOf("v_authorized:=coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day'", establishmentBridge);
  assert.ok(selectionBridge >= 0 && establishmentBridge > selectionBridge && authorizationCheck > establishmentBridge);
  assert.ok(normalized.includes("'domainAdapter','direct_sow_seed_v1'"));
  assert.ok(normalized.includes("jsonb_build_array('depleted','exact_remaining','some_left_unknown')"));
});

test("the establishment helper stays database-internal", () => {
  assert.ok(normalized.includes("revoke all on function atlas.worker_state_transition_planned_establishment_bridge_v1(uuid,uuid,uuid,date,jsonb) from public, anon, authenticated"));
  assert.doesNotMatch(normalized, /grant execute on function atlas\.worker_state_transition_planned_establishment_bridge_v1[\s\S]{0,120}authenticated/i);
});