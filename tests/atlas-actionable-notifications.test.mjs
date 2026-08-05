import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("task notifications offer Done and a five-hour reminder with an Open fallback", () => {
  const worker = read("public/sw.js");

  assert.match(worker, /atlas-pwa-shell-v9/);
  assert.match(worker, /action: "done", title: "Done"/);
  assert.match(worker, /action: "snooze-5h", title: "Remind in 5h"/);
  assert.match(worker, /delayMinutes: action === "snooze" \? 300/);
  assert.match(worker, /event\.action \|\| "open"/);
  assert.match(worker, /openAtlasDestination\(deepLink\)/);
  assert.match(worker, /credentials: "include"/);
  assert.match(worker, /x-atlas-intent": "notification-action-v1"/);
  assert.match(worker, /delete fallback\.actions/);
});

test("notification actions are authenticated and server-authoritative", () => {
  const route = read("app/api/atlas/notification-action/route.ts");
  const migration = read("supabase/migrations/20260804225015_task_notification_actions_v1.sql");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /handle_task_notification_action_v1/);
  assert.match(route, /notification-action-v1/);
  assert.match(route, /Math\.max\(15, Math\.min\(Math\.round\(requestedDelay\), 1440\)\)/);

  assert.match(migration, /auth\.uid\(\)/);
  assert.match(migration, /moment\.user_id = v_user_id/);
  assert.match(migration, /membership\.active/);
  assert.match(migration, /presented_work_rows_v1/);
  assert.match(migration, /quick_complete_allowed/);
  assert.match(migration, /record_task_transition_v1/);
  assert.match(migration, /completion_source', 'notification_action'/);
  assert.match(migration, /make_interval\(mins => v_delay\)/);
  assert.match(migration, /coalesce\(p_delay_minutes, 300\)/);
  assert.match(migration, /'snooze:' \|\| v_moment\.id::text/);
  assert.match(migration, /grant execute.*authenticated/);
});

test("grouped or structured notifications cannot falsely quick-complete work", () => {
  const worker = read("public/sw.js");
  const migration = read("supabase/migrations/20260804225015_task_notification_actions_v1.sql");

  assert.match(worker, /if \(taskIds\.length === 1\) actions\.push/);
  assert.match(migration, /if v_open_count <> 1 then/);
  assert.match(migration, /status', 'open_required'/);
  assert.match(migration, /requiresOpen', true/);
  assert.doesNotMatch(worker, /record_task_transition_v1/);
});

test("rhythm pushes describe the work instead of exposing Clock internals", () => {
  const migration = read("supabase/migrations/20260805002453_user_facing_rhythm_push_copy.sql");

  assert.match(migration, /when 'rhythm_failure' then 'Atlas · Overdue'/);
  assert.match(migration, /v_task_title \|\| ' is overdue\.'/);
  assert.match(migration, /' weed rhythm fell out of rhythm\$', ' needs weeding\.'/);
  assert.match(migration, /when v_category in \('rhythm_warning', 'rhythm_due'\)/);
  assert.match(migration, /atlas\.notification_can_user_read_event_v1/);
});
