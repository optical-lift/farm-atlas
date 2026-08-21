import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const adapter = read("components/atlas/direct-sow-task-detail.tsx");
const sow = read("app/task-focus/[taskId]/DirectSowFocusPage.tsx");
const route = read("app/api/atlas/direct-sow-result/route.ts");
const resultMigration = read("supabase/migrations/20260821044846_direct_sow_result_without_duration_v2.sql");
const successionMigration = read("supabase/migrations/20260821125912_reconcile_fr11_fr12_succession_11_v1.sql");

test("canonical sowing work uses one production Sow family", () => {
  assert.match(canonical, /function isSowCardTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /task\.task_type === "sowing"/);
  assert.match(canonical, /task\.action_key === "sow"/);
  assert.match(canonical, /task\.metadata\?\.task_style === "sowing"/);
  assert.match(canonical, /operation_result_membrane === "or3_direct_sow_seed_v1"/);
  assert.match(canonical, /DirectSowTaskDetail/);
});

test("Sow card is driven by task truth rather than Task Card Editor specimen values", () => {
  assert.match(adapter, /metadata\.execution_place/);
  assert.match(adapter, /metadata\.target_labels/);
  assert.match(adapter, /metadata\.rows_per_3ft_bed/);
  assert.match(adapter, /metadata\.in_row_spacing_in/);
  assert.match(adapter, /metadata\.seed_requirement_quantity/);
  assert.match(adapter, /metadata\.projected_germination_start/);
  assert.match(adapter, /metadata\.projected_harvest_start/);
  assert.match(adapter, /metadata\.projected_clear_bed_date/);
  assert.doesNotMatch(adapter, /metadata\.execution_how/);
  assert.doesNotMatch(sow, /Field Row 6/);
  assert.doesNotMatch(sow, /White Lite/);
  assert.doesNotMatch(sow, /270 seeds/);
  assert.doesNotMatch(sow, /Do it this way/i);
  assert.match(sow, /from this sowing&apos;s planned date/);
});

test("Sow card shows canonical succession and Venue-style Zone + bed rows", () => {
  assert.match(adapter, /production_successions/);
  assert.match(adapter, /\.eq\("sow_task_id", task\.task_id\)/);
  assert.match(adapter, /\.eq\("crop_cycle_id", cropCycleId\)/);
  assert.match(sow, /Succession \$\{task\.successionNumber\}/);
  assert.match(sow, />Zone \+ bed</);
  assert.match(sow, /zoneBedRows/);
  assert.match(sow, /type="checkbox"/);
  assert.match(successionMigration, /sequence_number\s*=\s*11|11,\s*v_plan_id/i);
  assert.match(successionMigration, /151fd9fc-9180-44c8-afc4-139ed93ff5bd/);
});

test("normal direct sow keeps seed remainder result without asking the worker to time sowing", () => {
  assert.match(sow, /Used the rest/);
  assert.match(sow, /Some left/);
  assert.match(sow, /I know how many/);
  assert.doesNotMatch(sow, /Minutes this took|actualMinutes|minutes this sowing took/i);
  assert.match(sow, /\/api\/atlas\/direct-sow-result/);
  assert.match(route, /record_direct_sow_seed_result_for_member_v2/);
  assert.match(route, /p_membership_id: authorized\.access\.membership\.membershipId/);
  assert.doesNotMatch(route, /p_actual_minutes|actualMinutes/);
  assert.match(route, /p_remaining_quantity: result === "exact_remaining"/);
  assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  assert.match(resultMigration, /record_direct_sow_seed_result_for_member_v2/);
  assert.match(resultMigration, /'timingCaptured',false/);
  assert.match(resultMigration, /'operationActualId',null/);
  assert.match(resultMigration, /Duration is not collected or fabricated/);
  assert.doesNotMatch(resultMigration, /insert into atlas\.production_operation_actuals/i);
});

test("patch sow uses the same visual family without inventing seed-inventory reporting", () => {
  assert.match(adapter, /completionMode: inventoryResult \? "seed_inventory" : "canonical"/);
  assert.match(sow, /task\.completionMode === "seed_inventory"/);
  assert.match(sow, /finishCanonicalSowing/);
  assert.match(sow, /transition: "done"/);
  assert.match(sow, /postAtlasTaskTransition/);
});

test("Sow card preserves unfinished reporting through the canonical task transition route", () => {
  assert.match(sow, /transition: kind/);
  assert.match(sow, /Partly done/);
  assert.match(sow, /Problem found/);
  assert.doesNotMatch(sow, /status\s*=\s*["']done["']/);
});
