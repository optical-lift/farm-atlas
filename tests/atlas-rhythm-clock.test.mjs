import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPaths = [
  "supabase/migrations/20260729060000_rhythm_clock_state_schema_v1.sql",
  "supabase/migrations/20260729060100_rhythm_clock_evidence_matching_v1.sql",
  "supabase/migrations/20260729060200_rhythm_clock_rule_resolution_v1.sql",
  "supabase/migrations/20260729060300_rhythm_clock_state_and_history_v1.sql",
  "supabase/migrations/20260729060400_rhythm_clock_task_release_v1.sql",
  "supabase/migrations/20260729060500_rhythm_clock_evaluator_v1.sql",
  "supabase/migrations/20260729060600_rhythm_clock_result_effects_v1.sql",
  "supabase/migrations/20260729060700_rhythm_clock_owner_override_and_tick_v1.sql",
  "supabase/migrations/20260729060800_rhythm_clock_workflow_source_kind_v1.sql",
  "supabase/migrations/20260729060900_rhythm_history_internal_delete_v1.sql",
  "supabase/migrations/20260729061000_rhythm_workflow_trigger_isolation_v1.sql",
];

function migration() {
  return migrationPaths.map(read).join("\n");
}

test("Clock stores one current lease plus append-only satisfaction and transition history", () => {
  const sql = migration();

  assert.match(sql, /create table if not exists atlas\.rhythm_state/);
  assert.match(sql, /create table if not exists atlas\.rhythm_satisfactions/);
  assert.match(sql, /create table if not exists atlas\.rhythm_transitions/);
  assert.match(sql, /unique \(farm_id, rhythm_key, subject_kind, subject_id\)/);
  assert.match(sql, /last_qualifying_satisfaction_id/);
  assert.match(sql, /current_task_id/);
  assert.match(sql, /prevent_rhythm_history_mutation_v1/);
  assert.match(sql, /Rhythm transition and satisfaction history is append-only/);
  assert.match(sql, /if tg_op = 'DELETE' then[\s\S]*return old/);
});

test("Clock resolves the effective inheritance winner on every evaluation", () => {
  const sql = migration();

  assert.match(sql, /resolve_effective_rhythm_rule_for_clock_v1/);
  assert.match(sql, /nearest active explicit/i);
  assert.match(sql, /when 'temporary_exception' then 600/);
  assert.match(sql, /when 'subject_override' then 500/);
  assert.match(sql, /order by c\.layer_rank desc, c\.priority desc, c\.version desc/);
  assert.match(sql, /v_effective_rule := atlas\.resolve_effective_rhythm_rule_for_clock_v1/);
  assert.match(sql, /v_state\.rhythm_binding_id <> v_binding\.id/);
  assert.match(sql, /'rule_changed'/);
});

test("boundary evaluation is exact, Chicago-aware, ordered, and replay safe", () => {
  const sql = migration();
  const contract = read("lib/atlas/rhythm-clock-contract.ts");

  assert.match(sql, /rhythm_boundary_at_v1/);
  assert.match(sql, /America\/Chicago/);
  assert.match(sql, /local_wall_clock/);
  assert.match(sql, /v_as_of >= v_state\.warning_at/);
  assert.match(sql, /v_as_of >= v_state\.due_at/);
  assert.match(sql, /v_as_of >= v_state\.failure_at/);
  assert.match(sql, /loop[\s\S]*warning[\s\S]*due[\s\S]*failed/);
  assert.match(sql, /unique \(farm_id, transition_key\)/);
  assert.match(sql, /on conflict \(farm_id, transition_key\) do nothing/);
  assert.match(contract, /"coming_due"/);
  assert.match(contract, /"fallen_out_of_rhythm"/);
});

test("qualifying results require explicit canonical evidence and cannot match by title", () => {
  const sql = migration();

  assert.match(sql, /rhythm_touch_matches_workflow_v1/);
  assert.match(sql, /At least one explicit canonical identity must be present/);
  assert.match(sql, /p_touch \? 'sourceKind'/);
  assert.match(sql, /p_touch \? 'sourceEvent'/);
  assert.match(sql, /p_touch \? 'taskType'/);
  assert.match(sql, /p_touch \? 'actionKey'/);
  assert.match(sql, /p_touch \? 'workClass'/);
  assert.match(sql, /p_touch \? 'taskTitle'/);
  assert.match(sql, /return false/);
  assert.match(sql, /source_workflow_event_id uuid references atlas\.workflow_events/);
  assert.match(sql, /policy_match jsonb not null/);
});

test("partial work enters recovery while full evidence renews from the latest real satisfaction", () => {
  const sql = migration();

  assert.match(sql, /if v_effect = 'partial'/);
  assert.match(sql, /p_transition_kind => 'recovering'/);
  assert.match(sql, /p_boundary_kind => 'partial_result'/);
  assert.match(sql, /v_effect in \('full','conditional','modifier','game_master'\)/);
  assert.match(sql, /order by latest\.satisfied_at desc, latest\.created_at desc, latest\.id desc/);
  assert.match(sql, /last_qualifying_satisfaction_id = v_latest_satisfaction_id/);
  assert.match(sql, /record_rhythm_game_master_satisfaction_v1/);
  assert.match(sql, /Only a farm Owner may record a game-master rhythm satisfaction/);
});

test("due and failure work adopts explicit open work before central release", () => {
  const sql = migration();

  assert.match(sql, /ensure_rhythm_task_v1/);
  assert.match(sql, /adopted_existing_explicit_work/);
  assert.match(sql, /task_type = v_template ->> 'taskType'/);
  assert.match(sql, /action_key = v_template ->> 'actionKey'/);
  assert.match(sql, /work_class = v_template ->> 'workClass'/);
  assert.match(sql, /plan_work_occurrence_v1/);
  assert.match(sql, /signal_work_occurrence_v1/);
  assert.match(sql, /engine_instance_key', 'rhythm:' \|\| v_state\.id::text/);
  assert.match(sql, /p_maximum_active_instances => 1/);
  assert.match(sql, /project_task_links/);
});

test("canonical workflow results evaluate immediately and the server-owned tick runs hourly", () => {
  const sql = migration();

  assert.match(sql, /apply_result_rhythm_effects_v1/);
  assert.match(sql, /workflow_events_rhythm_effects_v1/);
  assert.match(sql, /after insert or update of source_event, payload on atlas\.workflow_events/);
  assert.match(sql, /farm_rhythm_tick_v1/);
  assert.match(sql, /for update skip locked/);
  assert.match(sql, /atlas-farm-rhythm-clock-v1/);
  assert.match(sql, /'17 \* \* \* \*'/);
  assert.match(sql, /select atlas\.farm_rhythm_tick_v1\(\);/);
  assert.match(sql, /'rhythm_state'/);
  assert.match(sql, /workflow_events_source_kind_check/);
});

test("a Clock failure cannot roll back the canonical workflow result", () => {
  const sql = migration();

  assert.match(sql, /A Clock evaluation problem must never roll back the canonical task result/);
  assert.match(sql, /exception when others/);
  assert.match(sql, /last_result_clock_error/);
  assert.match(sql, /last_result_workflow_event_id/);
  assert.match(sql, /raise warning 'Rhythm Clock result evaluation failed/);
  assert.match(sql, /return new/);
});

test("Build 3 does not seed Elm assumptions or alter the visual layer", () => {
  const sql = migration();
  const contract = read("lib/atlas/rhythm-clock-contract.ts");

  assert.doesNotMatch(sql, /insert into atlas\.rhythm_rules/i);
  assert.doesNotMatch(sql, /Elm Farm|Field Rows|Redbud Island/);
  assert.doesNotMatch(sql, /\.css|className|style=/);
  assert.doesNotMatch(contract, /\.css|className|style=/);
});
