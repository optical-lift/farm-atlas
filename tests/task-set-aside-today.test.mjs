import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Set aside today is an append-only daily disposition, not a reschedule", () => {
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

test("Clock and biological windows make the consequence visible without blocking emotional closure", () => {
  const migration = read("supabase/migrations/20260729204500_task_day_set_aside_v1.sql");

  assert.match(migration, /task_safe_boundary_date_v1/);
  assert.match(migration, /latest_safe_sow_date/);
  assert.match(migration, /latest_useful_sow_date/);
  assert.match(migration, /sowing_window_end/);
  assert.match(migration, /rs\.failure_at/);
  assert.match(migration, /fallen_out_of_rhythm/);
  assert.match(migration, /This work is past its safe window and will return tomorrow at risk/);
  assert.match(migration, /This work remains overdue and will return tomorrow/);
  assert.match(migration, /deferral_number/);
});

test("Anna receives Do tomorrow while Owner scheduling remains outside the disposition contract", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const control = read("components/atlas/task-set-aside-control.tsx");
  const weed = read("components/atlas/weed-card-task-focus.tsx");
  const client = read("lib/atlas/task-set-aside-client.ts");
  const route = read("app/api/atlas/task-set-aside/route.ts");

  assert.match(canonical, /props\.assignee\.key === "anna"/);
  assert.match(canonical, /TaskSetAsideControl/);
  assert.match(control, /atlas-task-more-outcomes/);
  assert.match(control, /Do tomorrow/);
  assert.match(control, /postAtlasTaskSetAsideToday/);
  assert.match(weed, /Do tomorrow/);
  assert.match(client, /task-set-aside-v1:\$\{taskId\}:\$\{serviceDate\}/);
  assert.match(route, /set_task_aside_today_v1/);
  assert.match(route, /viewer_task_day_dispositions_v1/);
});

test("The selected day and home cover omit accepted set-asides while the journal keeps a quiet record", () => {
  const taskCardsRoute = read("app/api/atlas/universal-task-cards/route.ts");
  const home = read("app/page.tsx");
  const dayPatch = read("app/TaskSetAsideDayPatch.tsx");
  const css = read("app/task-day-set-aside.css");

  assert.match(taskCardsRoute, /setAsideTaskIds/);
  assert.match(taskCardsRoute, /!setAsideTaskIds\.has\(card\.task_id\)/);
  assert.match(home, /readAtlasSetAsideTaskIds/);
  assert.match(home, /taskCards: farm\.taskCards\.filter/);
  assert.match(dayPatch, /Set aside today/);
  assert.match(dayPatch, /still overdue/);
  assert.match(dayPatch, /set aside \$\{row\.deferralCount\}×/);
  assert.match(css, /Overdue remains a timeline state/);
  assert.match(css, /background: transparent !important/);
});
