import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Set aside remains an append-only daily disposition, not a reschedule", () => {
  const migration = read("supabase/migrations/20260729204500_task_day_set_aside_v1.sql");

  assert.match(migration, /create table if not exists atlas\.task_day_dispositions/);
  assert.match(migration, /unique \(task_id, service_date, disposition\)/);
  assert.match(migration, /set_task_aside_today_v1/);
  assert.match(migration, /task_status_unchanged/);
  assert.match(migration, /due_date_unchanged/);
  assert.match(migration, /clock_state_unchanged/);
  assert.match(migration, /physical_state_unchanged/);
  assert.match(migration, /'task_set_aside_today'/);
  assert.doesNotMatch(migration, /update atlas\.tasks\s+set due_date/i);
  assert.doesNotMatch(migration, /record_task_transition_v1/);
});

test("the move drawer records a requested checklist return date while the Clock controls the real return", () => {
  const migration = read("supabase/migrations/20260729215500_task_move_drawer_return_dates_v2.sql");

  assert.match(migration, /requested_return_date date/);
  assert.match(migration, /set_task_aside_today_v2/);
  assert.match(migration, /p_requested_return_date date/);
  assert.match(migration, /when v_consequence in \('overdue','at_risk'\) then v_local_date \+ 1/);
  assert.match(migration, /least\(v_requested_return, v_safe_boundary\)/);
  assert.match(migration, /'request_honored',v_request_honored/);
  assert.match(migration, /'due_date_unchanged',true/);
  assert.doesNotMatch(migration, /update atlas\.tasks\s+set due_date/i);
});

test("set-aside visibility lasts until the actual return date", () => {
  const migration = read("supabase/migrations/20260729215500_task_move_drawer_return_dates_v2.sql");

  assert.match(migration, /d\.service_date <= coalesce\(p_day/);
  assert.match(migration, /d\.returns_on > coalesce\(p_day/);
  assert.match(migration, /distinct on \(d\.task_id\)/);
  assert.match(migration, /'requestedReturnDate',coalesce\(d\.requested_return_date,d\.returns_on\)/);
});

test("Anna generic task detail keeps the regular Done and Unfinished result set behind the worker boundary", () => {
  const boundary = read("components/atlas/canonical-assigned-task-detail.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail-client.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const results = read("components/atlas/task-primary-result-controls.tsx");
  const weed = read("components/atlas/weed-card-task-focus.tsx");
  const display = read("lib/atlas/task-display.ts");

  assert.match(boundary, /props\.assignee\.key !== "anna"/);
  assert.match(boundary, /workerExecutionTaskCard/);
  assert.doesNotMatch(canonical, /FarmHandConveyorTaskDetail/);
  assert.match(canonical, /return <AssignedTaskExecutionShell/);
  assert.match(shell, /TaskPrimaryResultControls/);
  assert.match(results, /doneLabel = "Done"/);
  assert.match(results, />\s*Unfinished\s*</);
  assert.match(shell, /"Partly done"/);
  assert.match(shell, /"Problem found"/);
  assert.match(weed, /atlas-task-move-drawer atlas-weed-move-drawer/);
  assert.match(display, /Continued/);
});

test("transplant readiness records a counted survivor result or total crop loss", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail-client.tsx");
  const capture = read("components/atlas/transplant-readiness-task-detail.tsx");
  const route = read("app/api/atlas/transplant-readiness/route.ts");
  const migration = read("supabase/migrations/20260810135407_atlas_legacy_transplant_readiness_results_v1.sql");

  assert.match(canonical, /isTransplantReadinessTask/);
  assert.match(canonical, /TransplantReadinessTaskDetail/);
  assert.match(capture, /Transplant-ready seedlings/);
  assert.match(capture, /Revise count/);
  assert.match(capture, /All seedlings lost/);
  assert.match(capture, /transplant_ready_seedlings/);
  assert.match(route, /worker_record_transplant_readiness_v1/);
  assert.match(route, /owner_operator_record_transplant_readiness_v1/);
  assert.match(migration, /transplant_readiness_history/);
  assert.match(migration, /'crop_loss'/);
  assert.match(migration, /v_action = 'failed'/);
  assert.match(migration, /v_task\.status = 'done' then 'note' else 'done'/);
});

test("problem handoff infrastructure remains governed for any specialized flow that still uses it", () => {
  const control = read("components/atlas/structured-unfinished-control.tsx");
  const handoffClient = read("lib/atlas/task-problem-handoff-client.ts");
  const handoffRoute = read("app/api/atlas/task-problem-handoff/route.ts");
  const handoffMigration = read("supabase/migrations/20260730012500_task_problem_handoff_v1.sql");
  const ownerActions = read("app/owner/tasks/[taskId]/OwnerTaskActions.tsx");
  const css = read("app/task-structured-unfinished.css");

  assert.match(control, /openAtlasTaskProblemHandoff/);
  assert.match(control, /What is the problem\?/);
  assert.match(control, /<textarea/);
  assert.match(handoffClient, /task-problem-handoff-v1/);
  assert.match(handoffRoute, /worker_open_task_problem_handoff_v1/);
  assert.match(handoffRoute, /owner_resolve_task_problem_handoff_v1/);
  assert.match(handoffMigration, /create table if not exists atlas\.task_problem_handoffs/);
  assert.match(handoffMigration, /assigned_membership_id = v_owner_membership_id/);
  assert.match(handoffMigration, /original_assigned_membership_id/);
  assert.match(handoffMigration, /original due date is unchanged/i);
  assert.doesNotMatch(handoffMigration, /set due_date\s*=/i);
  assert.match(ownerActions, /Send back to Anna/);
  assert.match(ownerActions, /resolveAtlasTaskProblemHandoff/);
  assert.match(css, /\.atlas-structured-unfinished-problem textarea/);
});

test("The selected day and home cover omit accepted set-asides at their canonical readers", () => {
  const taskCardsRoute = read("app/api/atlas/universal-task-cards/route.ts");
  const homeReader = read("lib/atlas/operator-universal-home.ts");

  assert.match(taskCardsRoute, /readAtlasTaskDayDispositions/);
  assert.match(taskCardsRoute, /setAsideTaskIds/);
  assert.match(taskCardsRoute, /filter\(\(card\) => !setAsideTaskIds\.has\(card\.task_id\)\)/);
  assert.match(homeReader, /readAtlasTaskDayDispositions/);
  assert.match(homeReader, /setAsideTaskIds/);
  assert.match(homeReader, /!setAsideTaskIds\.has\(task\.task_id\)/);
});
