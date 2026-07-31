import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("project review is explicit Owner configuration rather than guessed recurrence", () => {
  const schema = read("supabase/migrations/20260731164343_project_review_clock_v1.sql");
  const panel = read("components/atlas/portfolio/ProjectReviewPanel.tsx");

  assert.match(schema, /configure_project_review_core_v1/);
  assert.match(schema, /Only an Owner or manager may configure project review/);
  assert.match(schema, /Only farm-specific projects can enter a farm review Clock/);
  assert.match(schema, /Cross-farm and organization projects are not forced into a farm Clock/);
  assert.match(schema, /p_cadence_days/);
  assert.match(schema, /p_first_review_date/);
  assert.match(schema, /owner_reason/);
  assert.doesNotMatch(schema, /insert into atlas\.projects/i);
  assert.match(panel, /useState\(""\)/);
  assert.match(panel, /Atlas will not guess a cadence/);
  assert.doesNotMatch(panel, /setCadenceDays\("7"\)/);
});

test("project review evidence is append-only and updates canonical project truth", () => {
  const schema = read("supabase/migrations/20260731164343_project_review_clock_v1.sql");

  assert.match(schema, /create table if not exists atlas\.project_review_events/);
  assert.match(schema, /Project review evidence is append-only/);
  for (const outcome of ["on_track", "next_move_changed", "waiting_external", "blocked", "complete"]) {
    assert.match(schema, new RegExp(outcome));
  }
  assert.match(schema, /update atlas\.projects set/);
  assert.match(schema, /health_status=v_result_health/);
  assert.match(schema, /current_milestone=case/);
  assert.match(schema, /project_attention_items/);
  assert.match(schema, /upsert_journal_event_v1/);
  assert.match(schema, /timeClaimsProjectHealth',false/);
});

test("Clock review tasks use canonical project task focus and central release", () => {
  const integration = read("supabase/migrations/20260731164502_project_review_task_integration_v1.sql");
  const attachment = read("supabase/migrations/20260731165556_rhythm_occurrence_task_attachment_v1.sql");
  const taskFocus = read("components/atlas/project-task-focus.tsx");
  const reviewFocus = read("components/atlas/portfolio/ProjectReviewTaskFocus.tsx");

  assert.match(integration, /new\.task_type := 'project_review'/);
  assert.match(integration, /new\.task_scope := 'project'/);
  assert.match(integration, /project_task_links/);
  assert.match(integration, /taskType',t\.task_type/);
  assert.match(integration, /metadata',t\.metadata/);
  assert.match(attachment, /o\.source_kind='rhythm_state'/);
  assert.match(attachment, /current_task_id=p_task_id/);
  assert.match(taskFocus, /ProjectReviewTaskFocus/);
  assert.match(taskFocus, /taskType === "project_review"/);
  assert.match(reviewFocus, /Record project review/);
  assert.match(reviewFocus, /The result changes the canonical project itself/);
});

test("project review API is scoped, same-origin, and operator-aware", () => {
  const api = read("app/api/atlas/project-review/route.ts");
  const projectPage = read("app/project/[projectId]/page.tsx");
  const rulebook = read("app/manage/rhythms/BiologicalRhythmManager.tsx");

  assert.match(api, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(api, /requireAtlasApiAccess/);
  assert.match(api, /effectiveOperatorMembershipId/);
  assert.match(api, /owner_operator_configure_project_review_v1/);
  assert.match(api, /owner_operator_record_project_review_result_v1/);
  assert.match(api, /project_review_dashboard_v1/);
  assert.match(projectPage, /ProjectReviewPanel/);
  assert.match(rulebook, /Project reviews/);
  assert.match(rulebook, /do not claim that the project is healthy/);
});

test("shared release fixes preserve farm organization and attach delayed Clock tasks", () => {
  const organization = read("supabase/migrations/20260731165416_tasks_inherit_farm_organization_v1.sql");
  const attachment = read("supabase/migrations/20260731165556_rhythm_occurrence_task_attachment_v1.sql");
  const workflow = read("supabase/migrations/20260731164721_workflow_events_project_source_v1.sql");
  const activation = read("supabase/migrations/20260731165014_project_review_activation_lease_fix_v1.sql");
  const completion = read("supabase/migrations/20260731165845_project_review_completion_boundary_fix_v1.sql");

  assert.match(organization, /inherit_task_farm_organization_v1/);
  assert.match(organization, /select f\.organization_id into new\.organization_id/);
  assert.match(attachment, /source_kind='rhythm_state'/);
  assert.match(workflow, /'project'/);
  assert.match(activation, /lease_started_at=null/);
  assert.match(completion, /greatest\(v_now,v_binding\.active_from\+interval ''1 second''\)/);
});
