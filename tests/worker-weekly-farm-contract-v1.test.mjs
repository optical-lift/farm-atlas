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

test("Weekly Contract refuses to fabricate capacity without Owner-authored Day Shape", () => {
  assert.match(migration, /state','anchor_required'/i);
  assert.match(migration, /plannedCapacityMinutes',null/i);
  assert.match(migration, /No Owner-authored Worker Day Shape is effective for this date/i);
  assert.match(migration, /capacityUsesOwnerAuthoredDayShapeOnly',true/i);
});

test("weekend capacity never silently becomes normal planned capacity", () => {
  assert.match(migration, /extract\(dow from p_day\)=6 then 'recovery'/i);
  assert.match(migration, /extract\(dow from p_day\)=0 then 'explicit_override'/i);
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

test("internal weekly functions stay behind scoped wrappers", () => {
  assert.match(migration, /owner_weekly_farm_contract_api_v1/i);
  assert.match(migration, /worker_self_weekly_farm_contract_api_v1/i);
});
