import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const runtime = read("components/atlas/runtime/AtlasRuntimeProvider.tsx");
const migration = read("supabase/migrations/20260814164000_task_notification_idle_fast_path_v1.sql");

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
  assert.match(migration, /join atlas\.push_subscriptions subscription/i);
  assert.match(migration, /subscription\.status = 'active'/i);
  assert.match(migration, /v_audience_count/i);
  assert.match(migration, /if coalesce\(v_audience_count, 0\) = 0 then/i);
  assert.match(migration, /'idle', true/);
  assert.match(migration, /'schedulesEnsured', 0/);
  assert.match(migration, /'dayPlansRefreshed', 0/);
});

test("notification member scheduling uses an inner subscription gate, not a late dispatch-only eligibility check", () => {
  const ensureStart = migration.indexOf("create or replace function atlas.ensure_task_notification_moments_v1");
  const tickStart = migration.indexOf("create or replace function atlas.task_notification_clock_tick_v1");
  const ensureBody = migration.slice(ensureStart, tickStart);
  assert.match(ensureBody, /join lateral \([\s\S]*atlas\.push_subscriptions active_subscription/);
  assert.match(ensureBody, /active_subscription\.status = 'active'/);
  assert.doesNotMatch(ensureBody, /left join lateral \([\s\S]*atlas\.push_subscriptions/);
});
