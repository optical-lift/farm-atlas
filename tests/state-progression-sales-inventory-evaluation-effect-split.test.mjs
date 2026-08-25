import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20260825201500_state_progression_sales_inventory_evaluation_effect_split_v1.sql',
  import.meta.url,
);
const sql = await readFile(migrationPath, 'utf8');

function section(start, end) {
  const a = sql.indexOf(start);
  const b = sql.indexOf(end, a);
  assert.notEqual(a, -1, `missing ${start}`);
  assert.notEqual(b, -1, `missing ${end}`);
  return sql.slice(a, b);
}

test('sales inventory evaluation owns truth but cannot mutate tasks', () => {
  const evaluator = section(
    'create or replace function atlas.sales_outreach_inventory_gate_evaluation_v1(',
    'revoke execute on function atlas.sales_outreach_inventory_gate_evaluation_v1(uuid)',
  );
  assert.match(evaluator, /stable/);
  assert.match(evaluator, /has_positive_ready_flower_inventory_v1/);
  assert.match(evaluator, /task_prerequisites_ready_v1/);
  assert.match(evaluator, /evaluationDoesNotMutateTask/);
  assert.match(evaluator, /evaluationDoesNotExecuteEffect/);
  assert.doesNotMatch(evaluator, /update\s+atlas\.tasks/i);
});

test('sales inventory effect consumes canonical evaluation rather than deciding inventory truth', () => {
  const effect = section(
    'create or replace function atlas.apply_sales_outreach_inventory_gate_effect_v1(',
    'revoke execute on function atlas.apply_sales_outreach_inventory_gate_effect_v1(uuid,jsonb,timestamptz)',
  );
  assert.match(effect, /sales_outreach_inventory_gate_evaluation_v1/);
  assert.match(effect, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(effect, /has_positive_ready_flower_inventory_v1/);
  assert.doesNotMatch(effect, /task_prerequisites_ready_v1/);
});

test('legacy reconciler is orchestration only', () => {
  const reconciler = section(
    'create or replace function atlas.reconcile_sales_outreach_inventory_gate_v1(',
    'create or replace function atlas.sync_outreach_worker_visibility_v1()',
  );
  assert.match(reconciler, /sales_outreach_inventory_gate_evaluation_v1/);
  assert.match(reconciler, /apply_sales_outreach_inventory_gate_effect_v1/);
  assert.doesNotMatch(reconciler, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(reconciler, /has_positive_ready_flower_inventory_v1/);
});

test('outreach visibility trigger no longer duplicates inventory truth authority', () => {
  const visibility = sql.slice(sql.indexOf('create or replace function atlas.sync_outreach_worker_visibility_v1()'));
  assert.match(visibility, /sales_inventory_gate_state/);
  assert.doesNotMatch(visibility, /has_positive_ready_flower_inventory_v1/);
  assert.doesNotMatch(visibility, /flower_ready_inventory_position_v1/);
});

test('new evaluation and effect functions remain private', () => {
  assert.match(sql, /revoke execute on function atlas\.sales_outreach_inventory_gate_evaluation_v1\(uuid\)[\s\S]*from public, anon, authenticated, service_role;/);
  assert.match(sql, /revoke execute on function atlas\.apply_sales_outreach_inventory_gate_effect_v1\(uuid,jsonb,timestamptz\)[\s\S]*from public, anon, authenticated, service_role;/);
});
