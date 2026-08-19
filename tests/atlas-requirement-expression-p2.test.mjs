import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "supabase/migrations/20260819234436_p2_crop_requirement_expression_and_warrant_v1.sql";
const sql = readFileSync(migrationPath, "utf8");

test("P2 stores source requirements separately from truth acquisition consequences", () => {
  assert.match(sql, /consequence_role text not null default 'state_consequence'/);
  assert.match(sql, /'operation_requirement'/);
  assert.match(sql, /'truth_acquisition'/);
  assert.match(sql, /source_requirement_instance_id uuid null/);
  assert.match(sql, /references atlas\.state_consequence_instances\(id\)/);
  assert.match(
    sql,
    /'sourceRequirementPolicyKey','crop-hardening-off-transplant-response-required'/,
  );
});

test("hardening-off living crops can say transplant is required without profile or task lineage", () => {
  assert.match(sql, /v_cycle\.cycle_state='hardening_off'/);
  assert.match(sql, /v_cycle\.planted_date is null/);
  assert.match(sql, /'transplantResponseRequired',v_transplant_required/);
  assert.match(sql, /'profileRequiredToRecognizeCurrentNeed',false/);
  assert.match(sql, /'openTaskRequiredToRecognizeCurrentNeed',false/);
  assert.match(sql, /'missingProfileDoesNotSuppress',true/);
  assert.match(sql, /'openTaskDoesNotSuppress',true/);
});

test("P2 preserves unknown historical requirement onset instead of inventing a transplant date", () => {
  assert.match(sql, /v_onset:=null;/);
  assert.match(sql, /v_time_class:='known_active_by';/);
  assert.match(sql, /'exactRequirementOnsetEstablished',false/);
  assert.match(sql, /hardeningStartIsNotAutomaticallyExactTransplantDueDate/);
  assert.match(sql, /requirement_onset_date date null/);
  assert.match(sql, /requirement_known_active_by date null/);
});

test("missing transplant destination blocks execution but does not erase the requirement", () => {
  assert.match(sql, /'destination_required'/);
  assert.match(sql, /'blocksExecution',true/);
  assert.match(sql, /'doesNotEraseRequirement',true/);
  assert.match(sql, /'warrant','missing_truth'/);
  assert.match(sql, /'missingDestinationBlocksExecutionNotRequirement',true/);
  assert.match(sql, /'requirementExistsIndependentlyOfExecutionWarrant',true/);
});

test("missing crop profile is explicitly non-blocking for the current transplant response", () => {
  assert.match(sql, /if v_cycle\.crop_profile_id is null then/);
  assert.match(sql, /'kind','crop_profile_source_missing'/);
  assert.match(sql, /'blocksExecution',false/);
  assert.match(
    sql,
    /current hardening-off witness is sufficient to preserve the transplant requirement/,
  );
});

test("resolving execution warrant cannot reset requirement time", () => {
  assert.match(sql, /'warrantResolutionDoesNotResetRequirementTime',true/);
  assert.match(sql, /requirementKnownActiveBy/);
  assert.match(sql, /requirementTimeClass/);
});

test("P2 does not manufacture a Worker task or placement just to represent the requirement", () => {
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.tasks\b/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.worker_day_task_placements\b/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.planned_work_occurrences\b/i);
  assert.match(sql, /'workerPlacementComesAfterWarrant',true/);
});

test("P2 composes crop-cycle requirements into the mature consequence engine instead of replacing it", () => {
  assert.match(
    sql,
    /alter function atlas\.state_consequence_snapshot_v1\(text,uuid\)\s+rename to state_consequence_snapshot_pre_p2_v1/,
  );
  assert.match(sql, /if p_subject_kind='crop_cycle' then/);
  assert.match(
    sql,
    /return atlas\.state_consequence_snapshot_pre_p2_v1\(p_subject_kind,p_subject_id\)/,
  );
  assert.match(
    sql,
    /v_result:=atlas\.reconcile_state_consequences_v1\('crop_cycle',p_crop_cycle_id\)/,
  );
});

test("new P2 helpers are service-internal rather than browser RPC surface", () => {
  for (const signature of [
    "atlas.crop_cycle_requirement_snapshot_v1(uuid,date)",
    "atlas.crop_operation_execution_warrant_v1(uuid,text,uuid)",
    "atlas.crop_cycle_requirement_expression_v1(uuid,date)",
    "atlas.reconcile_crop_cycle_requirement_state_v1(uuid)",
    "atlas.classify_state_consequence_instance_v1()",
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(
      sql,
      new RegExp(`revoke all on function ${escaped} from public,anon,authenticated`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`grant execute on function ${escaped} to service_role`, "i"),
    );
  }
});
