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
const migration = read("supabase/migrations/20260821044846_direct_sow_result_without_duration_v2.sql");

test("canonical direct-sow work uses the production Sow family instead of the generic shell", () => {
  assert.match(canonical, /task\.task_type === "sowing"/);
  assert.match(canonical, /operation_result_membrane === "or3_direct_sow_seed_v1"/);
  assert.match(canonical, /seed_inventory_report_required/);
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
  assert.match(adapter, /metadata\.execution_how/);
  assert.doesNotMatch(sow, /Field Row 6/);
  assert.doesNotMatch(sow, /White Lite/);
  assert.doesNotMatch(sow, /270 seeds/);
  assert.doesNotMatch(sow, /from today/i);
  assert.match(sow, /from this sowing&apos;s planned date/);
});

test("Sow completion records seed remainder without asking the worker to time sowing", () => {
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
  assert.match(migration, /record_direct_sow_seed_result_for_member_v2/);
  assert.match(migration, /'timingCaptured',false/);
  assert.match(migration, /'operationActualId',null/);
  assert.match(migration, /Duration is not collected or fabricated/);
  assert.doesNotMatch(migration, /insert into atlas\.production_operation_actuals/i);
});

test("Sow card preserves unfinished reporting through the canonical task transition route", () => {
  assert.match(sow, /postAtlasTaskTransition/);
  assert.match(sow, /transition: kind/);
  assert.match(sow, /Partly done/);
  assert.match(sow, /Problem found/);
  assert.doesNotMatch(sow, /status\s*=\s*["']done["']/);
});
