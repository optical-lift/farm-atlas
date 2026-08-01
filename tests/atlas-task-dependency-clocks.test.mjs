import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const core = read("supabase/migrations/20260801012000_atlas_task_dependency_clocks_v1.sql");
const continuation = read("supabase/migrations/20260801012050_atlas_dependency_continuation_release_v1.sql");
const pilot = read("supabase/migrations/20260801012100_atlas_friday_harvest_conditioning_pilot_v1.sql");
const route = read("app/api/atlas/task-transition/route.ts");
const client = read("lib/atlas/task-transition-client.ts");

test("dependency clocks preserve due dates while releasing work from real results", () => {
  assert.match(core, /create table if not exists atlas\.task_dependency_clocks/);
  assert.match(core, /source_task_id uuid not null/);
  assert.match(core, /downstream_occurrence_id uuid not null/);
  assert.match(core, /source_result_path text\[\]/);
  assert.match(core, /source_result_equals jsonb/);
  assert.match(core, /delay_interval interval not null/);
  assert.match(core, /new\.payload #> clock\.source_result_path = clock\.source_result_equals/);
  assert.match(core, /new\.created_at \+ clock\.delay_interval/);
});

test("elapsed clocks satisfy the existing planned-work gate instead of creating a second task list", () => {
  assert.match(core, /update atlas\.planned_work_occurrences/);
  assert.match(core, /gate_satisfied_at = v_clock\.ready_at/);
  assert.match(core, /perform atlas\.release_eligible_work_v1/);
  assert.match(core, /downstream_task_id = v_occurrence\.released_task_id/);
  assert.match(core, /case when new\.status = 'done' then 'completed' else 'cancelled' end/);
  assert.match(continuation, /planned_occurrence_id/);
  assert.match(continuation, /release_policy_id/);
  assert.match(continuation, /restore_task_relation_payload_v1/);
  assert.match(continuation, /attach_released_task_to_source_v1/);
});

test("workflow continuations do not wait behind Elm's inherited backlog ceiling", () => {
  assert.match(continuation, /release_ready_task_dependency_continuations_v1/);
  assert.match(continuation, /capacity_class', 'workflow_continuation'/);
  assert.match(continuation, /Dependency workflow continuation released outside backlog-admission capacity/);
  assert.doesNotMatch(continuation, /maximum_active_top_level_tasks/);
  assert.doesNotMatch(continuation, /maximum_active_tasks_per_member/);
  assert.doesNotMatch(continuation, /update atlas\.farm_task_release_settings/);
});

test("ready work uses direct push and stays out of Bell history", () => {
  assert.match(core, /atlas\.enqueue_direct_push_v1/);
  assert.match(core, /'dependency_ready'/);
  assert.match(core, /atlas\.notification_next_available_at_v1/);
  assert.match(core, /followup_after_minutes/);
  assert.doesNotMatch(core, /insert into atlas\.journal_events/i);
  assert.doesNotMatch(core, /bell_history_v2\(/i);
});

test("dependency clock execution is service-only while its read model is registered", () => {
  assert.match(core, /revoke all on table atlas\.task_dependency_clocks from public, anon, authenticated/);
  assert.match(core, /revoke all on function atlas\.advance_task_dependency_clocks_v1\(timestamptz, integer\) from public, anon, authenticated/);
  assert.match(continuation, /revoke all on function atlas\.release_ready_task_dependency_continuations_v1\(timestamptz, integer\)/);
  assert.match(continuation, /revoke all on function atlas\.tick_task_dependency_clocks_v1\(timestamptz, integer\)/);
  assert.match(core, /grant execute on function atlas\.task_dependency_status_v1\(uuid\) to authenticated, service_role/);
  assert.match(core, /'atlas\.task_dependency_status_v1\(uuid\)'/);
  assert.match(core, /'app_endpoint'/);
  assert.match(core, /'verified'/);
  assert.match(core, /'authorization', 'can_read_task_in_journal_v1'/);
});

test("the clock advances frequently enough for elapsed farm processes", () => {
  assert.match(core, /'atlas-task-dependency-clock-v1'/);
  assert.match(core, /'\*\/5 \* \* \* \*'/);
  assert.match(continuation, /'atlas-task-dependency-clock-v1'/);
  assert.match(continuation, /'\*\/5 \* \* \* \*'/);
  assert.match(continuation, /select atlas\.tick_task_dependency_clocks_v1\(\)/);
  assert.match(continuation, /v_first := atlas\.advance_task_dependency_clocks_v1/);
  assert.match(continuation, /v_continuations := atlas\.release_ready_task_dependency_continuations_v1/);
  assert.match(continuation, /v_second := atlas\.advance_task_dependency_clocks_v1/);
});

test("Friday harvest pilot releases bundling after three conditioning hours", () => {
  assert.match(pilot, /anna_harvest_friday_weekly_20260807/);
  assert.match(pilot, /Bundle conditioned Friday harvest/);
  assert.match(pilot, /interval '3 hours'/);
  assert.match(pilot, /'conditioning_minutes', 180/);
  assert.match(pilot, /Friday flowers are conditioned/);
  assert.match(pilot, /Bundle the conditioned harvest now/);
  assert.match(pilot, /Bundling still blocks Friday bouquet work/);
  assert.match(pilot, /assigned_membership_id', v_anna_membership_id/);
});

test("pilot data resolves stable records instead of embedding generated ids", () => {
  assert.match(pilot, /farm\.stable_key = 'elm_farm'/);
  assert.match(pilot, /profile\.display_name = 'Anna'/);
  assert.match(pilot, /Expected exactly one open Friday harvest source task/);
  assert.match(pilot, /Expected exactly one active Anna farm-hand membership/);
  assert.doesNotMatch(pilot, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("task completion responses expose the new countdown without changing transition semantics", () => {
  assert.match(route, /input\.transition === "done" \|\| input\.transition === "checklist_done"/);
  assert.match(route, /supabase\.rpc\("task_dependency_status_v1"/);
  assert.match(route, /dependencyStatus/);
  assert.match(client, /export type AtlasTaskDependencyStatus/);
  assert.match(client, /dependencyStatus\?: AtlasTaskDependencyStatus \| null/);
});
