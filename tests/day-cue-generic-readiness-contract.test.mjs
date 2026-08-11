import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811202000_atlas_generic_day_readiness_contract_v2.sql", import.meta.url),
  "utf8",
);

test("shared Day readiness result contract derives worker-facing language from the cue subject", () => {
  assert.match(migration, /v_subject:=coalesce\(/);
  assert.match(migration, /nullif\(v_contract->>'subject',''\)/);
  assert.match(migration, /v_problem_blocker_text:=coalesce\(/);
  assert.match(migration, /A readiness problem was reported for '\|\|v_subject/);
  assert.match(migration, /v_move_done_when:=coalesce\(/);
  assert.match(migration, /The ready '\|\|v_subject\|\|' seedlings are potted up\.'/);
  assert.match(migration, /'execution_done_when',v_move_done_when/);
  assert.doesNotMatch(migration, /Fall kale problem reported/);
  assert.doesNotMatch(migration, /ready fall kale seedlings/);
});

test("generic contract keeps the same narrow readiness action boundary", () => {
  assert.match(migration, /v_kind<>'transplant_readiness_gate_v1'/);
  assert.match(migration, /v_move_action<>'pot_up'/);
  assert.match(migration, /source_readiness_task_id/);
  assert.match(migration, /record_task_transition_v1_internal/);
});
