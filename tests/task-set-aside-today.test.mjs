import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("regular Anna tasks move only through a structured Unfinished disposition", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const control = read("components/atlas/structured-unfinished-control.tsx");
  const weed = read("components/atlas/weed-card-task-focus.tsx");
  const display = read("lib/atlas/task-display.ts");
  const client = read("lib/atlas/task-set-aside-client.ts");
  const route = read("app/api/atlas/task-set-aside/route.ts");
  const css = read("app/task-structured-unfinished.css");

  assert.match(canonical, /props\.assignee\.key === "anna"/);
  assert.match(canonical, /StructuredUnfinishedControl/);
  assert.doesNotMatch(canonical, /TaskSetAsideControl/);
  assert.match(control, /Partly done/);
  assert.match(control, /Problem found/);
  assert.match(control, /Weather changed/);
  assert.match(control, /Larger than expected/);
  assert.match(control, /Need supplies/);
  assert.match(control, /Need a decision/);
  assert.match(control, /Tomorrow/);
  assert.match(control, /Choose date/);
  assert.match(control, /Save unfinished/);
  assert.match(control, /postAtlasTaskTransition/);
  assert.match(control, /postAtlasTaskSetAsideToday\(task\.task_id, returnDate\)/);
  assert.doesNotMatch(control, /window\.prompt/);
  assert.match(control, /route === "mow" \|\| route === "build" \|\| route === "harvest"/);
  assert.match(control, /route === "seed" \|\| route === "plant" \|\| route === "water"/);
  assert.match(weed, /atlas-task-move-drawer atlas-weed-move-drawer/);
  assert.match(weed, />\s*Tomorrow\s*</);
  assert.match(weed, /type="date"/);
  assert.doesNotMatch(weed, />\s*Do tomorrow\s*</);
  assert.match(display, /Continued/);
  assert.match(display, /latest\.outcome === "partial" \? "Partly done" : "Problem found"/);
  assert.match(client, /task-set-aside-v2:\$\{taskId\}:\$\{serviceDate\}:\$\{requestedReturnDate\}/);
  assert.match(route, /set_task_aside_today_v2/);
  assert.match(route, /p_requested_return_date: requestedReturnDate/);
  assert.match(css, /\.atlas-structured-unfinished-panel/);
  assert.match(css, /\.atlas-structured-unfinished-save/);
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
  assert.match(dayPatch, /<strong>Set aside<\/strong>/);
  assert.match(dayPatch, /still overdue/);
  assert.match(dayPatch, /returns \$\{prettyDate\(row\.returnsOn\)\}/);
  assert.match(dayPatch, /set aside \$\{row\.deferralCount\}×/);
  assert.match(css, /Overdue remains a timeline state/);
  assert.match(css, /background: transparent !important/);
});
