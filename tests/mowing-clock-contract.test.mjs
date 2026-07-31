import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mowing evidence is append-only and time cannot claim physical grass condition", () => {
  const schema = read("supabase/migrations/20260731155352_mowing_clock_schema_v1.sql");

  assert.match(schema, /create table if not exists atlas\.mowing_events/);
  assert.match(schema, /create table if not exists atlas\.mowing_area_state/);
  assert.match(schema, /Mowing evidence is append-only/);
  for (const outcome of [
    "mowed_full",
    "mowed_partial",
    "acceptable_no_cut",
    "too_wet",
    "equipment_or_area_problem",
    "closed_not_mowable",
  ]) assert.match(schema, new RegExp(outcome));
  assert.match(schema, /timeClaimsPhysicalCondition',false/);
  assert.match(schema, /acceptable_no_cut[\s\S]*satisfaction_kind/);
  assert.match(schema, /record_mowing_result_for_member_v1/);
  assert.match(schema, /owner_operator_record_mowing_result_v1/);
});

test("Elm mowing enrollment is bounded to five real routes with accepted cadences", () => {
  const routes = read("supabase/migrations/20260731155741_elm_mowing_clock_routes_v1.sql");
  const keys = [
    "mowing_field_rows_front_half",
    "mowing_field_rows_back_half",
    "mowing_follow_me_paths_edges",
    "mowing_curve_garden_edges",
    "mowing_u_pick_route",
  ];

  for (const key of keys) assert.match(routes, new RegExp(key));
  assert.equal((routes.match(/'mowing_[a-z_]+','/g) ?? []).length, 5);
  assert.doesNotMatch(routes, /mowing_corral|mowing_front_yard|mowing_barn_beds/);
  assert.match(routes, /'field_rows_front_half',4,1,'Riding mower',4\.0/);
  assert.match(routes, /'follow_me_paths_edges',7,1,'Push mower',4\.0/);
  assert.match(routes, /'u_pick_paths',6,1,'Riding mower',3\.5/);
  assert.match(routes, /physical_condition_authority','observation_only/);
});

test("legacy mowing work becomes governed baselines without reviving date recreation", () => {
  const baselines = read("supabase/migrations/20260731155949_elm_mowing_clock_baselines_v1.sql");

  assert.match(baselines, /status='done'[\s\S]*completed_at is not null/);
  assert.match(baselines, /'append_only_baseline'/);
  assert.match(baselines, /'recreate_on_done',false/);
  assert.match(baselines, /mowing-owner-delay/);
  assert.match(baselines, /'game_master'/);
  assert.match(baselines, /ensure_rhythm_task_v1/);
  assert.match(baselines, /planned_work_occurrences/);
  assert.doesNotMatch(baselines, /insert into atlas\.tasks/i);
});

test("mowing result UI and API preserve observation, operator mode, and canonical task focus", () => {
  const api = read("app/api/atlas/mowing/route.ts");
  const focus = read("app/task-focus/[taskId]/MowingFocusPage.tsx");
  const taskFocus = read("app/task-focus/[taskId]/page.tsx");
  const collection = read("app/collections/mowing/page.tsx");
  const rulebook = read("app/manage/rhythms/BiologicalRhythmManager.tsx");

  assert.match(api, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(api, /record_mowing_result_for_member_v1/);
  assert.match(api, /owner_operator_record_mowing_result_v1/);
  assert.match(api, /mowing_rhythm_dashboard_v1/);

  for (const outcome of [
    "mowed_full",
    "mowed_partial",
    "acceptable_no_cut",
    "too_wet",
    "equipment_or_area_problem",
    "closed_not_mowable",
  ]) assert.match(focus, new RegExp(outcome));
  assert.match(focus, /Time does not claim the grass is long, dry, or safe to mow/);
  assert.match(taskFocus, /isMowingTask/);
  assert.match(taskFocus, /MowingFocusPage/);

  assert.match(collection, /fetch\("\/api\/atlas\/mowing"/);
  assert.doesNotMatch(collection, /fetchAtlasTaskCards\s*\(/);
  assert.match(collection, /Upcoming \/ Scheduled/);
  assert.match(collection, /Recently Done \/ Resting/);
  assert.match(collection, /Not Ready \/ Paused/);
  assert.match(rulebook, /Mowing routes/);
});

test("an explicit mowing problem handoff outranks ordinary Anna collection assignment", () => {
  const precedence = read("supabase/migrations/20260731160308_mowing_problem_handoff_assignment_precedence_v1.sql");
  const schema = read("supabase/migrations/20260731155352_mowing_clock_schema_v1.sql");

  assert.match(precedence, /mowing_owner_handoff/);
  assert.match(precedence, /owner_problem_handoff_open/);
  assert.match(precedence, /worker_key='anna'/);
  assert.match(schema, /assigned_membership_id=v_owner_membership_id/);
  assert.match(schema, /'mowing_owner_handoff',true/);
});
