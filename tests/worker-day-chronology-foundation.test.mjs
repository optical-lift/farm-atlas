import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816041000_worker_day_chronology_foundation_v1.sql"),
  "utf8",
);

test("Day Shape is durable owner-authored truth and no guessed Elm shift is seeded", () => {
  assert.match(migration, /create table if not exists atlas\.worker_day_shape_policies/i);
  assert.match(migration, /policy_key text not null/i);
  assert.match(migration, /version integer not null/i);
  assert.match(migration, /weekdays smallint\[\] not null/i);
  assert.match(migration, /local_start time without time zone not null/i);
  assert.match(migration, /local_end time without time zone not null/i);
  assert.match(migration, /effective_from date not null/i);
  assert.match(migration, /anchor_required/i);
  assert.match(migration, /requiresOwnerDayShape/i);
  assert.doesNotMatch(migration, /insert into atlas\.worker_day_shape_policies/i);
});

test("chronology reuses canonical Worker Day, reservations, capacity and committed placements", () => {
  assert.match(migration, /worker_day_chronology_overlay_v1/i);
  assert.match(migration, /member_day_capacity_blocks_v1/i);
  assert.match(migration, /worker_day_task_placements/i);
  assert.match(migration, /task_capacity_plan_v1/i);
  assert.match(migration, /clock_day_capacity_state_v2/i);
  assert.match(migration, /committed_timed/i);
  assert.match(migration, /unplaced_no_lawful_interval/i);
  assert.match(migration, /visible_noncounting/i);
});

test("chronology is proposal-only and never writes Worker Day placement truth", () => {
  assert.match(migration, /proposalIsAuthoritative',false/i);
  assert.match(migration, /timelineAuthority.*proposal/is);
  assert.doesNotMatch(migration, /insert into atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(migration, /update atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(migration, /delete from atlas\.worker_day_task_placements/i);
});

test("Owner and Farm Hand read the same chronology contract", () => {
  assert.match(migration, /owner_worker_day_plan_choreographed_api_v1/i);
  assert.match(migration, /worker_self_day_plan_api_v1/i);
  assert.match(migration, /\{clockTimeline\}/i);
  const uses = migration.match(/worker_day_chronology_overlay_v1\(p_farm_id,p_membership_id,p_day,v_plan\)/gi) ?? [];
  assert.equal(uses.length, 2);
});

test("internal Day Shape and chronology helpers are not authenticated Data API endpoints", () => {
  assert.match(migration, /revoke all on function atlas\.worker_day_shape_effective_v1\(uuid,uuid,date\) from public,anon,authenticated/i);
  assert.match(migration, /revoke all on function atlas\.worker_day_chronology_overlay_v1\(uuid,uuid,date,jsonb\) from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function atlas\.worker_day_shape_effective_v1\(uuid,uuid,date\) to service_role/i);
  assert.match(migration, /grant execute on function atlas\.worker_day_chronology_overlay_v1\(uuid,uuid,date,jsonb\) to service_role/i);
});
