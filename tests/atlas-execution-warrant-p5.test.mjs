import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20260820000145_p5_task_execution_warrant_contract_v1.sql",
  "utf8",
);

test("task readiness explicitly identifies itself as execution warrant only", () => {
  assert.match(sql, /'contractRole','execution_warrant'/);
  assert.match(sql, /'executionReady',v_ready/);
  assert.match(sql, /'requirementAuthority',false/);
  assert.match(sql, /'requirementExistenceNotInferredFromReady',true/);
  assert.match(sql, /'notReadyDoesNotMeanNotRequired',true/);
  assert.match(
    sql,
    /thisContractOnlyAnswersWhetherRepresentedTaskMayExecuteNow/,
  );
});

test("P5 preserves the mature readiness inputs rather than replacing the gate engine", () => {
  assert.match(sql, /atlas\.task_prerequisites_ready_v1\(p_task_id\)/);
  assert.match(sql, /atlas\.task_required_resources_available_v1\(p_task_id\)/);
  assert.match(sql, /atlas\.task_execution_destination_readiness_v1\(p_task_id\)/);
  assert.match(sql, /atlas\.task_seed_readiness_v1\(p_task_id\)/);
  assert.match(sql, /atlas\.task_state_consequence_gate_v1\(p_task_id\)/);
});

test("P5 does not manufacture requirement, task, occurrence, or placement state", () => {
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.state_consequence_instances/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.tasks/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.planned_work_occurrences/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.worker_day_task_placements/i);
});

test("execution warrant remains an internal composition contract", () => {
  assert.match(
    sql,
    /revoke all on function atlas\.task_execution_readiness_v1\(uuid\) from public,anon,authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function atlas\.task_execution_readiness_v1\(uuid\) to service_role/,
  );
});
