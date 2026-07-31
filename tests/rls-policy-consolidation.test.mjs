import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260731195500_atlas_consolidate_permissive_read_policies_v1.sql',
  import.meta.url,
);
const sql = readFileSync(migrationPath, 'utf8');

const normalized = sql.replace(/\s+/g, ' ').trim();

const replacementPolicies = [
  ['user_profiles', 'user_profiles_read_authorized'],
  ['farm_memberships', 'farm_memberships_read_authorized'],
  ['organization_memberships', 'organization_memberships_read_authorized'],
  ['tasks', 'tasks_read_authorized'],
];

const supersededPolicies = [
  'user_profiles_read_operations',
  'user_profiles_read_self',
  'farm_memberships_read_operations',
  'farm_memberships_read_self',
  'organization_memberships_read_owner',
  'organization_memberships_read_self',
  'tasks_read_manager',
  'tasks_read_owner',
  'tasks_read_project_contributor',
];

test('consolidation creates one authenticated SELECT policy per reviewed table', () => {
  for (const [tableName, policyName] of replacementPolicies) {
    assert.match(
      normalized,
      new RegExp(
        `CREATE POLICY ${policyName} ON atlas\\.${tableName} FOR SELECT TO authenticated USING`,
        'i',
      ),
    );
  }

  assert.equal(
    (normalized.match(/CREATE POLICY /gi) ?? []).length,
    replacementPolicies.length,
  );
});

test('replacement predicates preserve every prior visibility path', () => {
  assert.match(normalized, /user_id = \(SELECT auth\.uid\(\)\)/i);
  assert.match(normalized, /atlas\.can_read_farm_operations\(target_membership\.farm_id\)/i);
  assert.match(normalized, /atlas\.can_read_farm_operations\(farm_id\)/i);
  assert.match(normalized, /atlas\.is_organization_owner\(organization_id\)/i);
  assert.match(normalized, /atlas\.is_farm_owner\(farm_id\)/i);
  assert.match(normalized, /atlas\.current_farm_role\(farm_id\) = 'manager'::text/i);
  assert.match(normalized, /assigned_user_id = \(SELECT auth\.uid\(\)\)/i);
  assert.match(normalized, /atlas\.can_read_project\(ptl\.project_id\)/i);
});

test('all nine superseded permissive policies are removed', () => {
  for (const policyName of supersededPolicies) {
    assert.match(
      normalized,
      new RegExp(`DROP POLICY ${policyName} ON atlas\\.`, 'i'),
    );
  }

  assert.equal(
    (normalized.match(/DROP POLICY /gi) ?? []).length,
    supersededPolicies.length,
  );
});

test('migration fails closed on policy drift and verifies a single-policy result', () => {
  assert.match(normalized, /Reviewed Atlas policy %.% has drifted/i);
  assert.match(normalized, /expected_count/i);
  assert.match(normalized, /Replacement Atlas policy %.% was not created/i);
  assert.match(normalized, /actual_count <> 1/i);
  assert.match(normalized, /One or more superseded Atlas policies still exist/i);
});

test('migration contains no environment-specific identity fixtures', () => {
  assert.doesNotMatch(
    sql,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
