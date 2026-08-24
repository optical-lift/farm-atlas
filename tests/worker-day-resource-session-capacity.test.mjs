import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migrationPath = 'supabase/migrations/20260824202357_worker_day_resource_session_capacity_v1.sql';
const sql = fs.readFileSync(path.join(root, migrationPath), 'utf8');

const functionBody = (name) => {
  const start = sql.indexOf(`create or replace function atlas.${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const next = sql.indexOf('\ncreate or replace function atlas.', start + 1);
  return sql.slice(start, next === -1 ? sql.length : next);
};

test('resource-session capacity belongs to a reusable resource instead of mower identity', () => {
  assert.match(sql, /'worker_day_session_contract','resource_day_session_v1'/);
  assert.match(sql, /'worker_day_session_capacity',1/);
  assert.match(sql, /resource_role',''\)='reusable_energy_set'/);
  assert.match(sql, /worker_day_resource_session_claims_v1/);
  assert.match(sql, /task_resource_requirements/);
  assert.match(sql, /required_resource_keys/);
});

test('Worker Day placement boundary enforces generic resource-session capacity', () => {
  const claims = functionBody('worker_day_resource_session_claims_v1');
  const availability = functionBody('worker_day_resource_session_availability_v1');
  const guard = functionBody('worker_day_validate_resource_session_capacity_v1');

  assert.match(availability, /count\(distinct existing_claim\.session_group_key\)/);
  assert.match(availability, /bool_or\(existing_claim\.session_group_key=v_claim\.session_group_key\)/);
  assert.match(availability, /not v_same_group_present and v_existing_group_count>=v_claim\.session_capacity/);
  assert.match(availability, /sameSessionGroupMayShareOneResourceSession/);
  assert.match(availability, /differentSessionGroupsConsumeSeparateCapacity/);
  assert.match(availability, /resourceReadinessRemainsSeparateFromSessionCapacity/);
  assert.match(guard, /worker_day_resource_session_availability_v1/);
  assert.match(guard, /errcode='55000'/);
  assert.match(sql, /before insert or update of task_id,membership_id,farm_id,service_date,state[\s\S]*on atlas\.worker_day_task_placements/);

  for (const body of [claims, availability, guard]) {
    assert.doesNotMatch(body, /elm_mowing_/);
    assert.doesNotMatch(body, /mowing_follow_me_curve_shared/);
  }
});

test('Elm battery-session topology stays in tenant rhythm configuration', () => {
  const follow = [...sql.matchAll(/when 'elm_mowing_follow_me_paths_edges' then '([^']+)'/g)].map((m) => m[1]);
  const curve = [...sql.matchAll(/when 'elm_mowing_curve_garden_edges' then '([^']+)'/g)].map((m) => m[1]);
  const front = [...sql.matchAll(/when 'elm_mowing_field_rows_front_half' then '([^']+)'/g)].map((m) => m[1]);
  const back = [...sql.matchAll(/when 'elm_mowing_field_rows_back_half' then '([^']+)'/g)].map((m) => m[1]);

  assert.ok(follow.length >= 2 && follow.every((key) => key === 'mowing_follow_me_curve_shared'));
  assert.ok(curve.length >= 2 && curve.every((key) => key === 'mowing_follow_me_curve_shared'));
  assert.ok(front.length >= 2 && front.every((key) => key === 'mowing_field_rows_front_half'));
  assert.ok(back.length >= 2 && back.every((key) => key === 'mowing_field_rows_back_half'));
  assert.notEqual(front[0], back[0]);
  assert.doesNotMatch(sql, /elm_mowing_u_pick/);
});

test('migration refuses to install over already-invalid Worker Day session claims', () => {
  assert.match(sql, /having count\(distinct claim\.session_group_key\)>claim\.session_capacity/);
  assert.match(sql, /Existing Worker Day placements violate resource-session capacity; migration aborted\./);
});