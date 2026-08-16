import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816051500_worker_day_shape_owner_authoring_v1.sql"),
  "utf8",
);
const route = readFileSync(
  join(root, "app/api/atlas/owner-worker-day-shape/route.ts"),
  "utf8",
);
const control = readFileSync(
  join(root, "components/atlas/clock/clock-day-shape-control.tsx"),
  "utf8",
);

test("Day Shape authoring is Owner-only and targets an active Farm Hand", () => {
  assert.match(migration, /owner_set_worker_day_shape_api_v1/i);
  assert.match(migration, /atlas\.is_farm_owner\(p_farm_id\)/i);
  assert.match(migration, /fm\.role='farm_hand'/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /grant execute .* to authenticated,service_role/is);
  assert.match(migration, /revoke all .* from public,anon/is);
});

test("Day Shape is versioned effective policy and does not write task placements", () => {
  assert.match(migration, /policy_key text := 'standard_worker_day'/i);
  assert.match(migration, /max\(policy\.version\)/i);
  assert.match(migration, /effective_through=p_effective_from-1/i);
  assert.match(migration, /superseded_by_version/i);
  assert.doesNotMatch(migration, /insert into atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(migration, /update atlas\.worker_day_task_placements/i);
});

test("Owner route requires explicit mutation intent and does not infer hours", () => {
  assert.match(route, /owner-worker-day-shape-v1/i);
  assert.match(route, /validWeekdays/i);
  assert.match(route, /validLocalTime/i);
  assert.match(route, /owner_set_worker_day_shape_api_v1/i);
  assert.doesNotMatch(route, /08:00/);
  assert.doesNotMatch(route, /16:00/);
});

test("Clock control requires the Owner to choose weekdays and both boundaries", () => {
  assert.match(control, /Save Day Shape/i);
  assert.match(control, /selectedWeekdays\.length > 0/i);
  assert.match(control, /Boolean\(localStart\)/i);
  assert.match(control, /Boolean\(localEnd\)/i);
  assert.match(control, /Atlas will not invent Anna's start and finish time/i);
});
