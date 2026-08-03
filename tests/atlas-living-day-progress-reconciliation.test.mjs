import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260803150000_atlas_repair_late_living_day_snapshot_progress.sql",
  import.meta.url,
);
const routePath = new URL("../app/api/atlas/living-day-plan/route.ts", import.meta.url);

test("late first-load snapshots preserve work completed before preparation", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /repair_late_living_day_snapshot_v1/i);
  assert.match(sql, /transition\.created_at\s*<=\s*v_snapshot\.prepared_at/i);
  assert.match(sql, /task\.assigned_membership_id\s*=\s*p_membership_id/i);
  assert.match(sql, /'denominator_preserved'/i);
  assert.match(sql, /planned_task_ids\s*=\s*v_reconciled/i);
  assert.match(sql, /resolved_before_preparation/i);
});

test("Living Day rereads the frozen plan after reconciliation", async () => {
  const route = await readFile(routePath, "utf8");
  const firstPrepare = route.indexOf('supabase.rpc("prepare_living_day_plan_v1"');
  const repair = route.indexOf('supabase.rpc("repair_late_living_day_snapshot_v1"');
  const secondPrepare = route.indexOf('supabase.rpc("prepare_living_day_plan_v1"', firstPrepare + 1);

  assert.ok(firstPrepare >= 0, "the finite plan is prepared first");
  assert.ok(repair > firstPrepare, "late completions are reconciled after preparation");
  assert.ok(secondPrepare > repair, "a repaired plan is reread before returning progress");
  assert.match(route, /\(reconciliation\.data as \{ repaired\?: unknown \}\)\.repaired === true/);
});
