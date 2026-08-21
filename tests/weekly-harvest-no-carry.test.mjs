import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migrationPath = path.join(
  root,
  "supabase/migrations/20260821183300_weekly_harvest_round_no_carry_v1.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("weekly Harvest rounds expire instead of entering generic worker-day carryover", () => {
  const harvestGuard = sql.indexOf("task_style','')='weekly_harvest_round'");
  const changedPlan = sql.indexOf("'changed_plan'", harvestGuard);
  const continueAfterExpiration = sql.indexOf("continue;", changedPlan);
  const genericReschedule = sql.indexOf("'rescheduled'", continueAfterExpiration);

  assert.ok(harvestGuard >= 0, "weekly Harvest task style must have an explicit rollover guard");
  assert.match(sql, /completion_independent_schedule/);
  assert.ok(changedPlan > harvestGuard, "expired Harvest must archive through changed_plan");
  assert.ok(continueAfterExpiration > changedPlan, "Harvest expiration must leave the rollover loop before rescheduling");
  assert.ok(genericReschedule > continueAfterExpiration, "generic rescheduling must remain after the Harvest terminal branch");
  assert.match(sql, /expired_weekly_harvest_round/);
});

test("the Aug 20 repair restores the real Thursday before archiving without fabricating Harvest work", () => {
  assert.match(sql, /task_series_key='anna_harvest_thursday_weekly'/);
  assert.match(sql, /execution_date',''\)='2026-08-20'/);
  assert.match(sql, /set due_date=v_execution_date/);
  assert.match(sql, /no Harvest result was recorded/);

  assert.doesNotMatch(sql, /42780ca1-d318-47e2-af8c-2e97bd323f73/);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.weekly_harvest_task_results/i);
  assert.doesNotMatch(sql, /insert\s+into\s+atlas\.crop_harvest_events/i);
  assert.doesNotMatch(sql, /delete\s+from\s+atlas\.planned_work_occurrences/i);
});

test("weekly Harvest expiration preserves independent future recurrence", () => {
  assert.match(sql, /completion_independent_schedule/);
  assert.doesNotMatch(sql, /delete\s+from\s+atlas\.work_definitions/i);
  assert.doesNotMatch(sql, /delete\s+from\s+atlas\.work_release_policies/i);
  assert.doesNotMatch(sql, /task_series_key\s*=\s*null/i);
});
