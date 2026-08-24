import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const migrationPath = 'supabase/migrations/20260824012841_platform_work_scope_adapter_v1.sql';
const sql = fs.readFileSync(path.join(root, migrationPath), 'utf8');

test('platform work scope resolves organization above an explicit operating unit', () => {
  assert.match(sql, /resolve_platform_work_scope_v1/);
  assert.match(sql, /v_farm\.organization_id/);
  assert.match(sql, /organizationMembershipId/);
  assert.match(sql, /operatingUnitKind/);
  assert.match(sql, /operatingUnitMembershipId/);
  assert.match(sql, /Active organization membership required for operating-unit membership/);
  assert.match(sql, /if v_kind <> 'farm'/);
  assert.doesNotMatch(sql, /tenant_id/);
});

test('platform work scope remains service-internal while the first adapter generalizes incrementally', () => {
  assert.match(sql, /revoke all on function atlas\.resolve_platform_work_scope_v1\(text,uuid,uuid\) from public,anon,authenticated/);
  assert.match(sql, /grant execute on function atlas\.resolve_platform_work_scope_v1\(text,uuid,uuid\) to service_role/);
  assert.match(sql, /'platform_work_scope','platform'/);
  assert.match(sql, /'needs_generalization'/);
  assert.match(sql, /initialOperatingUnitKinds/);
});

test('Worker Day Shape consumes platform scope without rewriting domain scheduling state', () => {
  const workerStart = sql.indexOf('create or replace function atlas.worker_day_shape_effective_v1');
  const worker = sql.slice(workerStart);
  assert.match(worker, /resolve_platform_work_scope_v1\('farm',p_farm_id,p_membership_id\)/);
  assert.match(worker, /v_scope->>'timezone'/);
  assert.doesNotMatch(worker, /from atlas\.farm_memberships/);
  assert.doesNotMatch(worker, /from atlas\.farms/);
  assert.match(worker, /from atlas\.member_capacity_settings/);
  assert.match(worker, /from atlas\.worker_day_shape_policies/);
});
