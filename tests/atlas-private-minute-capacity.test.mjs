import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804061000_atlas_private_minute_capacity_v1.sql", import.meta.url),
  "utf8",
);

function functionBody(name, nextName) {
  const start = migration.indexOf(`create or replace function atlas.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function atlas.${nextName}`, start)
    : migration.length;
  assert.ok(start >= 0, `${name} must exist`);
  return migration.slice(start, end > start ? end : migration.length);
}

const defaults = functionBody("task_capacity_default_v1", "task_capacity_plan_v1");
const resolver = functionBody("presented_work_rows_unfiltered_v1", "presented_work_rows_v1");
const publicReader = functionBody("presented_work_v1", "worker_task_hand_v1");
const workerHand = functionBody("worker_task_hand_v1", "owner_capacity_plan_v1");
const ownerReader = functionBody("owner_capacity_plan_v1", null);

test("capacity is stored as owner-private minutes, physical load, obligation, and recovery data", () => {
  assert.match(migration, /create table if not exists atlas\.task_capacity_rules/);
  assert.match(migration, /create table if not exists atlas\.task_capacity_profiles/);
  assert.match(migration, /create table if not exists atlas\.member_capacity_settings/);
  assert.match(migration, /expected_active_minutes integer/);
  assert.match(migration, /physical_load text/);
  assert.match(migration, /base_obligation_class text/);
  assert.match(migration, /recovery_origin_due_date date/);
  assert.match(migration, /micro_round_key text/);
});

test("worker accounts cannot read or call capacity internals", () => {
  assert.match(migration, /task_capacity_profiles_owner_only[\s\S]*current_farm_role\(farm_id\) = 'owner'/);
  assert.match(migration, /member_capacity_settings_owner_only[\s\S]*current_farm_role\(farm_id\) = 'owner'/);
  assert.match(migration, /revoke all on function atlas\.task_capacity_plan_v1\(atlas\.tasks, date\) from public, anon, authenticated/);
  assert.match(migration, /revoke all on function atlas\.presented_work_rows_v1\(uuid,uuid,date\) from public, anon, authenticated/);
  assert.match(migration, /authenticated_execute_expected=false/);
});

test("owner has a governed reader but no worker-facing task card receives the underbelly", () => {
  assert.match(ownerReader, /v_role <> 'owner'/);
  assert.match(ownerReader, /expectedActiveMinutes/);
  assert.match(ownerReader, /physicalLoad/);
  assert.match(ownerReader, /effectiveObligationClass/);
  assert.match(ownerReader, /selectedRecoveryMinutes/);
  assert.match(migration, /owner_capacity_plan_v1\(uuid,uuid,date\).*authenticated, service_role/s);

  assert.doesNotMatch(resolver.match(/to_jsonb\(r\.card\)[\s\S]*?from resolved r/)?.[0] ?? "", /expected_active_minutes|physical_load|effective_obligation_class|recovery_origin_due_date|micro_round_key/i);
  assert.doesNotMatch(publicReader, /budgetUnits|presentedUnits|mandatoryUnits|overloadUnits|expectedActiveMinutes|physicalLoad|recovery/i);
  assert.doesNotMatch(workerHand, /presentation_reason|expected_active_minutes|physical_load|recovery_origin_due_date/);
  assert.match(workerHand, /t\.work_lane/);
});

test("the scheduler uses real minutes and keeps regular work ahead of additive recovery work", () => {
  assert.match(resolver, /v_regular_target integer/);
  assert.match(resolver, /v_recovery_target integer/);
  assert.match(resolver, /v_maximum_planned integer/);
  assert.match(resolver, /regular_ranked as/);
  assert.match(resolver, /regular_selected as/);
  assert.match(resolver, /recovery_capacity as/);
  assert.match(resolver, /recovery_ranked as/);
  assert.match(resolver, /v_recovery_target \+ greatest\(v_regular_target-hard\.minutes-regular\.minutes,0\)/);
  assert.match(resolver, /sum\(r\.expected_active_minutes\)/);
  assert.doesNotMatch(resolver, /sum\(r\.effort_units\)/);
});

test("tiny observations have minute-scale rules and capacity classification never parses display titles", () => {
  assert.match(migration, /'germination_check'.*2, 'light'.*'grow_room_observation'/s);
  assert.match(migration, /'propagation_readiness'.*3, 'light'.*'grow_room_observation'/s);
  assert.match(migration, /'move_to_lights'.*5, 'light'.*'grow_room_observation'/s);
  assert.match(migration, /'general_chore'.*10, 'light'/s);
  assert.doesNotMatch(defaults, /p_task\.title|lower\(.*title|regexp_replace\(.*title/i);
});

test("micro work can be grouped later without revealing a capacity tab now", () => {
  assert.match(migration, /grow_room_observation/);
  assert.match(migration, /grow_room_round/);
  assert.match(migration, /departure_round/);
  assert.match(migration, /brief_chore_round/);
  assert.doesNotMatch(migration, /app\/owner|href=|<section|<main/);
});
