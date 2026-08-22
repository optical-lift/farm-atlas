import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const baseMigration = read("supabase/migrations/20260822094149_saturday_recovery_feed_speed_v1.sql");
const gateMigration = read("supabase/migrations/20260822094231_saturday_recovery_gate_truth_v2.sql");
const optionalHoldMigration = read("supabase/migrations/20260822094259_saturday_recovery_optional_hold_v3.sql");
const workerPlanServer = read("lib/atlas/worker-day-plan-server.ts");

function functionBody(source, functionName) {
  const marker = `create or replace function atlas.${functionName}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${functionName} must exist`);
  const rest = source.slice(start);
  const next = rest.indexOf("\ncreate or replace function atlas.", marker.length);
  return next === -1 ? rest : rest.slice(0, next);
}

test("recovery-day selection uses recovery capacity for required work instead of hiding the workday", () => {
  assert.match(baseMigration, /capacityClass'='recovery'/);
  assert.match(baseMigration, /recoveryCapacityMinutes/);
  assert.match(baseMigration, /'recoveryRequired'/);
  assert.match(baseMigration, /c\.work_lane in \('required','process_continuation'\)/);
  assert.match(baseMigration, /c\.commitment_kind in \('hard_date','dependency'\)/);
  assert.match(baseMigration, /persistent_weed_card/);
  assert.match(baseMigration, /exactly_one_weed_card_per_workday/);
  assert.match(baseMigration, /recovery_required_selected/);
});

test("recovery gate requires an actual recovery-required signal and holds legacy-presented optional work", () => {
  assert.match(gateMigration, /and coalesce\(\(value->>'recoveryRequired'\)::boolean,false\)/);
  assert.match(gateMigration, /protected_minimum_selected/);
  assert.match(gateMigration, /required_selected/);
  assert.match(optionalHoldMigration, /value->>'legacyPresentationState'='presented'/);
  assert.match(optionalHoldMigration, /and not coalesce\(\(value->>'recoveryRequired'\)::boolean,false\)/);
  assert.match(baseMigration, /v_item_reason:='recovery_reserved_for_required'/);
});

test("presented-work v1 is cut over to the recovery-aware v3 selector", () => {
  const wrapper = functionBody(baseMigration, "presented_work_selection_rows_v1");
  assert.match(wrapper, /select \* from atlas\.presented_work_selection_rows_v3/);
});

test("live worker feed avoids the legacy planner and builds only canonical selected real work", () => {
  const feed = functionBody(baseMigration, "worker_day_feed_plan_live_v1");
  assert.match(feed, /presented_work_selection_rows_v3/);
  assert.match(feed, /'realWork',v_real/);
  assert.match(feed, /'automaticWork','\[\]'::jsonb/);
  assert.match(feed, /'suggestions','\[\]'::jsonb/);
  assert.doesNotMatch(feed, /owner_worker_day_plan_v1/);
  assert.doesNotMatch(feed, /floating_paid_work_candidates_v1/);
  assert.doesNotMatch(feed, /project_pull_items/);
  assert.doesNotMatch(feed, /farm_clock_reality_candidates_v1/);
});

test("owner day API uses the lean feed only for the live farm day and preserves non-live planning", () => {
  const api = functionBody(baseMigration, "owner_worker_day_plan_choreographed_api_v2");
  assert.match(api, /if p_day=v_today then/);
  assert.match(api, /worker_day_feed_plan_live_v1/);
  assert.match(api, /else[\s\S]*owner_worker_day_plan_choreographed_v1/);
  assert.match(api, /worker_day_selection_overlay_v1/);
  assert.match(api, /worker_day_chronology_overlay_v1/);
});

test("server worker-day reader calls the v2 API and cannot silently regress to v1", () => {
  assert.match(workerPlanServer, /\.rpc\("owner_worker_day_plan_choreographed_api_v2"/);
  assert.doesNotMatch(workerPlanServer, /\.rpc\("owner_worker_day_plan_choreographed_api_v1"/);
});
