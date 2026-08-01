import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const foundation = read("supabase/migrations/20260801023000_atlas_task_notification_plan_foundation_v1.sql");
const schedule = read("supabase/migrations/20260801023010_atlas_task_notification_schedule_v1.sql");
const floodGuard = read("supabase/migrations/20260801023015_atlas_task_notification_no_backfill_flood_v1.sql");
const dispatch = read("supabase/migrations/20260801023020_atlas_task_notification_dispatch_v1.sql");
const preferences = read("supabase/migrations/20260801023030_atlas_task_notification_preferences_and_clock_v1.sql");
const firstRelease = read("supabase/migrations/20260801023040_atlas_task_notification_first_release_v1.sql");

test("daily task delivery has canonical plans and idempotent notification moments", () => {
  assert.match(foundation, /create table if not exists atlas\.task_notification_plans/);
  assert.match(foundation, /create table if not exists atlas\.task_notification_moments/);
  for (const kind of [
    "tomorrow_covered",
    "day_plan",
    "work_window",
    "task_nudge",
    "window_closing",
    "day_wrap",
  ]) {
    assert.match(foundation, new RegExp(`'${kind}'::text`));
  }
  assert.match(foundation, /task_notification_moments_identity_key unique/);
  assert.match(foundation, /revoke all on table atlas\.task_notification_moments from public, anon, authenticated/);
});

test("task timing is inferred from farm action rather than an hourly due-date field", () => {
  assert.match(foundation, /v_title like '%trash%'/);
  assert.match(foundation, /time '19:00'/);
  assert.match(foundation, /v_action = 'harvest'/);
  assert.match(foundation, /time '06:30'/);
  assert.match(foundation, /v_action in \('weed', 'weeding'\)/);
  assert.match(foundation, /time '08:00'/);
  assert.match(foundation, /v_action = 'mow'/);
  assert.match(foundation, /time '15:00'/);
  assert.match(foundation, /task_notification_plans/);
  assert.doesNotMatch(foundation, /alter table atlas\.tasks add column due_time/i);
});

test("the schedule releases one plan, grouped work, nudges, closing warnings, and a bedtime guarantee", () => {
  assert.match(schedule, /'day_plan', 'day_plan', 'day'/);
  assert.match(schedule, /'work_window', 'work_window'/);
  assert.match(schedule, /'task_nudge', 'task_nudge'/);
  assert.match(schedule, /'window_closing', 'window_closing'/);
  assert.match(schedule, /'day_wrap', 'day_wrap', 'day'/);
  assert.match(schedule, /'tomorrow_covered', 'tomorrow_covered', 'tomorrow'/);
  assert.match(schedule, /time '07:00'/);
  assert.match(schedule, /time '19:30'/);
  assert.match(schedule, /time '20:30'/);
  assert.match(schedule, /array_agg\(task\.id/);
});

test("installing the clock cannot dump historical same-day moments onto the lockscreen", () => {
  assert.match(floodGuard, /p_scheduled_for < v_as_of - interval '10 minutes'/);
  assert.match(floodGuard, /historical_backfill_suppressed/);
  assert.match(floodGuard, /p_moment_kind <> 'tomorrow_covered'/);
  assert.doesNotMatch(dispatch, /where moment\.status in \('planned', 'skipped'\)/i);
});

test("dispatch sends only still-open assigned work and suppresses a nudge after the task was touched", () => {
  assert.match(dispatch, /task\.status in \('open', 'blocked'\)/);
  assert.match(dispatch, /task\.assigned_membership_id = v_moment\.membership_id/);
  assert.match(dispatch, /v_moment\.moment_kind = 'task_nudge'/);
  assert.match(dispatch, /from atlas\.task_transitions transition/);
  assert.match(dispatch, /skip_reason = 'work_was_touched'/);
  assert.match(dispatch, /atlas\.enqueue_direct_push_v1/);
  assert.doesNotMatch(dispatch, /insert into atlas\.journal_event/i);
  assert.doesNotMatch(dispatch, /bell_history/i);
});

test("required delivery ignores optional preference suppression while optional alerts honor it", () => {
  assert.match(dispatch, /v_required := v_moment\.category in/);
  assert.match(dispatch, /if not v_required and/);
  assert.match(dispatch, /optional_category_disabled/);
  assert.match(dispatch, /when v_required then coalesce\(p_as_of, now\(\)\)/);
  assert.match(dispatch, /else atlas\.notification_next_available_at_v1/);
});

test("the task delivery clock runs every five minutes and stays service-only", () => {
  assert.match(preferences, /'atlas-task-notification-clock-v1'/);
  assert.match(preferences, /'\*\/5 \* \* \* \*'/);
  assert.match(preferences, /select atlas\.task_notification_clock_tick_v1\(\)/);
  assert.match(dispatch, /revoke all on function atlas\.task_notification_clock_tick_v1\(timestamptz\) from public, anon, authenticated/);
  assert.match(dispatch, /grant execute on function atlas\.task_notification_clock_tick_v1\(timestamptz\) to service_role/);
});

test("the morning brief names the task with the earliest release window", () => {
  assert.match(firstRelease, /order by\s+\(atlas\.task_notification_profile_v1\(first_task\.id\) ->> 'releaseTime'\)::time/s);
  assert.match(firstRelease, /Keeps the morning brief anchored to the earliest real task release/);
  assert.match(firstRelease, /dayPlansRefreshed/);
});
