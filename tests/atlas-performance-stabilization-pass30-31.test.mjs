import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const notificationMigration = read("supabase/migrations/20260814164000_task_notification_idle_fast_path_v1.sql");
const cardMigration = read("supabase/migrations/20260814165000_worker_day_operational_task_cards_v1.sql");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");

test("Pass 29 hydrates only already-selected Worker Day task ids without the rich card view", () => {
  assert.match(cardMigration, /worker_day_operational_task_cards_v1/);
  assert.match(cardMigration, /task\.id = any\(p_task_ids\)/);
  assert.match(cardMigration, /task_move_context_batch_v1\(p_task_ids\)/);
  assert.match(cardMigration, /limit 1/);
  assert.match(cardMigration, /'resource_requirements', '\[\]'::jsonb/);
  assert.match(cardMigration, /'action_templates', '\[\]'::jsonb/);
  assert.match(cardMigration, /'task_logs', '\[\]'::jsonb/);
  assert.doesNotMatch(cardMigration, /atlas\.v_task_cards/);
  assert.doesNotMatch(cardMigration, /atlas\.field_logs/);
});

test("Worker Day sequence carries lightweight task cards beside the canonical projection", () => {
  assert.match(sequenceServer, /worker_day_operational_task_cards_v1/);
  assert.match(sequenceServer, /\.\.\.plan\.realWork, \.\.\.plan\.automaticWork/);
  assert.match(sequenceServer, /Promise\.all\(\[/);
  assert.match(sequenceServer, /taskCards/);
  assert.match(projectionClient, /taskCards\?: AtlasTaskCard\[\]/);
  assert.match(projectionClient, /taskCards: Array\.isArray\(body\.taskCards\)/);
  assert.match(projectionClient, /AtlasWorkerDayProjectionRead[\s\S]*taskCards: AtlasTaskCard\[\]/);
});

test("Pass 30 reconciles cached Worker Days by affected task/date instead of every visited date", () => {
  assert.match(runtime, /cachedDatesContainingTasks/);
  assert.match(runtime, /runtimeEntryContainsTask/);
  assert.match(runtime, /request\.targetDate && entriesRef\.current\.has\(request\.targetDate\)/);
  assert.match(runtime, /dependencyStatus\?\.dependencies/);
  assert.match(runtime, /downstreamTaskId/);
  assert.doesNotMatch(runtime, /Promise\.allSettled\(serviceDates\.map/);
  assert.doesNotMatch(runtime, /const serviceDates = Array\.from\(entriesRef\.current\.keys\(\)\)/);
});

test("Pass 31 notification scheduling only evaluates memberships with an active push audience", () => {
  assert.match(notificationMigration, /join atlas\.push_subscriptions subscription/i);
  assert.match(notificationMigration, /subscription\.status = 'active'/i);
  assert.match(notificationMigration, /v_audience_count/i);
  assert.match(notificationMigration, /if coalesce\(v_audience_count, 0\) = 0 then/i);
  assert.match(notificationMigration, /'idle', true/);
  assert.match(notificationMigration, /'schedulesEnsured', 0/);
  assert.match(notificationMigration, /'dayPlansRefreshed', 0/);
});

test("notification member scheduling uses an inner subscription gate, not a late dispatch-only eligibility check", () => {
  const ensureStart = notificationMigration.indexOf("create or replace function atlas.ensure_task_notification_moments_v1");
  const tickStart = notificationMigration.indexOf("create or replace function atlas.task_notification_clock_tick_v1");
  const ensureBody = notificationMigration.slice(ensureStart, tickStart);
  assert.match(ensureBody, /join lateral \([\s\S]*atlas\.push_subscriptions active_subscription/);
  assert.match(ensureBody, /active_subscription\.status = 'active'/);
  assert.doesNotMatch(ensureBody, /left join lateral \([\s\S]*atlas\.push_subscriptions/);
});
