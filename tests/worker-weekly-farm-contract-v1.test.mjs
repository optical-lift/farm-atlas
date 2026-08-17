import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(join(root, "supabase/migrations/20260816130420_worker_weekly_farm_contract_v1.sql"), "utf8");
const route = readFileSync(join(root, "app/api/atlas/worker-weekly-contract/route.ts"), "utf8");
const client = readFileSync(join(root, "lib/atlas/worker-weekly-contract-client.ts"), "utf8");
const surface = readFileSync(join(root, "components/atlas/clock/clock-weekly-farm-contract.tsx"), "utf8");
const orchestrator = readFileSync(join(root, "components/atlas/clock/clock-orchestrator.tsx"), "utf8");

test("production-exact Weekly Contract history stays pinned instead of inventing replacement SQL", () => {
  assert.match(migration, /20260816124500_worker_weekly_farm_contract_v1\.sql/i);
  assert.match(migration, /Pinned 3G migration source unavailable/i);
  assert.match(migration, /execute v_sql/i);
});

test("Weekly Contract surface keeps unknown capacity and weekend recovery explicit", () => {
  assert.match(surface, /capacity_anchor_required/i);
  assert.match(surface, /Weekly capacity not established/i);
  assert.match(surface, /will not claim this week is feasible until the Owner authors/i);
  assert.match(surface, /capacity_policy_conflict/i);
  assert.match(surface, /Saturday\/Sunday capacity is never counted as normal planned capacity/i);
});

test("Weekly Contract uses a dedicated read path, not the retired Owner week projection", () => {
  assert.match(route, /owner_weekly_farm_contract_api_v1/i);
  assert.match(client, /\/api\/atlas\/worker-weekly-contract/i);
  assert.match(orchestrator, /ClockWeeklyFarmContract/i);
  assert.doesNotMatch(route, /owner[_-]week[_-]projection/i);
  assert.doesNotMatch(surface, /owner[_-]week[_-]projection/i);
  assert.doesNotMatch(orchestrator, /owner[_-]week[_-]projection/i);
});

test("weekly surface is informational and does not expose day assignment controls", () => {
  assert.match(surface, /Weekly feasibility is read before day assignment/i);
  assert.doesNotMatch(surface, /commitAtlasClock/i);
  assert.doesNotMatch(surface, /worker_day_task_placements/i);
  assert.doesNotMatch(route, /\.insert\(/i);
  assert.doesNotMatch(route, /\.update\(/i);
  assert.doesNotMatch(route, /\.delete\(/i);
});

test("public app read stays behind the scoped Owner wrapper rather than calling internal weekly versions", () => {
  assert.match(route, /owner_weekly_farm_contract_api_v1/i);
  assert.doesNotMatch(route, /worker_weekly_farm_contract_v[1-9]/i);
  assert.match(route, /resolveOwnerWorkerDayPlanningTargetForSession/i);
});
