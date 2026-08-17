import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260817015500_principal_farm_capacity_escalation_bridge_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ");

test("Farm Clock escalates only governed weekly capacity exceptions to Principal", () => {
  assert.match(normalized, /worker_weekly_capacity_conflict_v1/i);
  assert.match(normalized, /record_operational_escalation_v1/i);
  assert.match(normalized, /'capacity_breach'/i);
  assert.match(normalized, /'missing_critical_information'/i);
  assert.match(normalized, /v_state='conflict'/i);
  assert.match(normalized, /v_state in \('capacity_truth_required','capacity_policy_conflict'\)/i);
  assert.match(normalized, /v_required_minutes>0/i);
});

test("ordinary unfinished tasks never become the Principal escalation source", () => {
  assert.doesNotMatch(normalized, /from atlas\.tasks\b/i);
  assert.doesNotMatch(normalized, /join atlas\.tasks\b/i);
  assert.match(normalized, /delegatedTasksRemainFarmContained/i);
  assert.match(normalized, /contained_in_farm_clock/i);
});

test("feasible or recovery-usable weeks resolve rather than escalate", () => {
  assert.match(normalized, /if v_escalation_kind is null then/i);
  assert.match(normalized, /weekly_capacity_no_longer_requires_principal/i);
  assert.match(normalized, /status='resolved'/i);
});

test("capacity exception tick is farm-local, recurring, and service-only", () => {
  assert.match(normalized, /now\(\) at time zone r\.timezone/i);
  assert.match(normalized, /17 \* \* \* \*/i);
  assert.match(normalized, /cron\.schedule/i);
  assert.match(normalized, /revoke all on function atlas\.sync_worker_weekly_capacity_escalation_v1\(uuid,uuid,date\) from public, anon, authenticated/i);
  assert.match(normalized, /revoke all on function atlas\.tick_worker_weekly_capacity_escalations_v1\(\) from public, anon, authenticated/i);
  assert.match(normalized, /grant execute on function atlas\.sync_worker_weekly_capacity_escalation_v1\(uuid,uuid,date\) to service_role/i);
  assert.match(normalized, /grant execute on function atlas\.tick_worker_weekly_capacity_escalations_v1\(\) to service_role/i);
});
