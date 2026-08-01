import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260801004500_atlas_employee_bell_follow_through_v1.sql");
const visibilityMigration = read("supabase/migrations/20260801005200_atlas_employee_bell_assigned_movement_visibility_v1.sql");
const resultMigration = read("supabase/migrations/20260801005800_atlas_employee_bell_completion_results_v1.sql");
const precedenceMigration = read("supabase/migrations/20260801010400_atlas_employee_bell_result_precedence_v1.sql");
const page = read("app/bell/page.tsx");
const view = read("lib/atlas/bell-view.ts");
const action = read("lib/atlas/bell-action.ts");

const ui = `${page}\n${view}\n${action}`;

test("owner and manager retain the management Bell contract", () => {
  assert.match(migration, /v_is_management := v_role in \('owner', 'manager'\)/);
  assert.match(migration, /where v_is_management/);
  assert.match(migration, /atlas\.bell_event_is_worthy_v1\(event\.id\)/);
  assert.match(migration, /latest_worthy_event_per_obligation/);
  assert.match(visibilityMigration, /v_helper_occurrences <> 1/);
  assert.match(page, /management \? \(/);
  assert.match(page, />Coming up</);
  assert.match(page, />Older work</);
});

test("employee Bell is assigned current movement rather than another overdue list", () => {
  assert.match(migration, /where not v_is_management/);
  assert.match(migration, /event\.event_kind = 'task_result'/);
  assert.match(migration, /event\.source_event = 'rescheduled'/);
  assert.match(migration, /task\.status in \('open', 'blocked'\)/);
  assert.match(migration, /task\.due_date <= v_farm_today/);
  assert.match(migration, /task\.assigned_membership_id = v_membership_id/);
  assert.match(migration, /task\.assigned_user_id = v_user_id/);
  assert.match(migration, /'movement:' \|\| event\.task_id::text/);
  assert.match(migration, /current_assigned_task_movement_per_task/);
  assert.match(visibilityMigration, /event\.visibility_scope = 'assigned_worker'/);
  assert.match(visibilityMigration, /Expected exactly one employee movement visibility fragment/);
  assert.doesNotMatch(view, /No overdue work/);
});

test("employee movement payload carries count, due date, result, and unlock targets", () => {
  assert.match(migration, /count\(\*\)::integer as movement_count/);
  assert.match(migration, /'movementCount', item\.movement_count/);
  assert.match(migration, /'dueDate', item\.task_due_date/);
  assert.match(migration, /'farmToday'/);
  assert.match(migration, /'resultText', item\.result_text/);
  assert.match(migration, /'unlockTaskTitles'/);
  assert.match(migration, /atlas\.maintenance_dependencies/);
  assert.match(migration, /task\.metadata ->> 'downstream_task_id'/);
  assert.match(migration, /task\.metadata ->> 'owner_review_task_id'/);
});

test("missing explicit consequences derive concrete completion results from canonical task metadata", () => {
  assert.match(resultMigration, /task\.metadata -> 'detail_lines' ->> -1/);
  assert.match(resultMigration, /task\.action_key = 'mow'/);
  assert.match(resultMigration, /task\.action_key = 'weed'/);
  assert.match(resultMigration, /task\.action_key = 'germination_check'/);
  assert.match(resultMigration, /task\.action_key = 'support'/);
  assert.match(resultMigration, /task\.action_key = 'put_away'/);
  assert.match(resultMigration, /task\.action_key = 'harvest'/);
  assert.match(resultMigration, /task\.action_key = 'clean'/);
  assert.match(resultMigration, /crop cycle can advance when ready/);
  assert.match(resultMigration, /returned to its weeding rhythm/);
});

test("action-derived completion state takes priority over equipment and resource instructions", () => {
  assert.match(precedenceMigration, /Prefer explicit downstream unlocks, then explicit or action-derived completion results/);
  assert.match(precedenceMigration, /v_case_position >= v_detail_position/);
  assert.match(precedenceMigration, /Employee Bell result precedence postcondition failed/);
  assert.match(precedenceMigration, /Expected one result-precedence fragment and one case ending/);
});

test("employee UI removes planning queues and exposes follow-through consequences", () => {
  assert.match(view, /eyebrow: "Follow through"/);
  assert.match(view, /No moved work needs finishing/);
  assert.match(page, /data-atlas-bell-mode=\{management \? "management" : "follow-through"\}/);
  assert.match(page, /atlasBellConsequence\(item\)/);
  assert.match(action, /Moved once/);
  assert.match(action, /Moved \$\{movementCount\} times/);
  assert.match(action, /label: "Unlocks"/);
  assert.match(action, /label: "Result"/);
  assert.match(action, /return "Go to task"/);
});

test("follow-through migrations are fail-closed and fixture-free", () => {
  assert.match(migration, /do \$preflight\$/);
  assert.match(migration, /do \$postcondition\$/);
  assert.match(visibilityMigration, /do \$migration\$/);
  assert.match(visibilityMigration, /Employee assigned-movement visibility postcondition failed/);
  assert.match(resultMigration, /do \$migration\$/);
  assert.match(resultMigration, /Employee Bell completion-result postcondition failed/);
  assert.match(precedenceMigration, /do \$migration\$/);
  assert.match(precedenceMigration, /do \$postcondition\$/);
  assert.doesNotMatch(`${migration}\n${visibilityMigration}\n${resultMigration}\n${precedenceMigration}\n${ui}`, /6a503d9f|21436a28|23e98e5e|4cd799e2/i);
});
