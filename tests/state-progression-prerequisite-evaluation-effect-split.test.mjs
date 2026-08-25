import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL(
  '../supabase/migrations/20260825193000_state_progression_prerequisite_evaluation_effect_split_v1.sql',
  import.meta.url,
);

const sql = await readFile(migrationPath, 'utf8');

function sectionBetween(start, end) {
  const startIndex = sql.indexOf(start);
  const endIndex = sql.indexOf(end, startIndex);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return sql.slice(startIndex, endIndex);
}

test('prerequisite evaluation is read-only and domain-owned', () => {
  const evaluator = sectionBetween(
    'create or replace function atlas.task_prerequisite_gate_evaluation_v1(',
    'revoke execute on function atlas.task_prerequisite_gate_evaluation_v1(uuid)',
  );

  assert.match(evaluator, /stable/);
  assert.match(evaluator, /atlas\.task_prerequisites_ready_v1/);
  assert.match(evaluator, /atlas\.task_prerequisite_waiting_text_v1/);
  assert.match(evaluator, /evidenceRemainsTaskPrerequisiteOwned/);
  assert.match(evaluator, /evaluationDoesNotMutateTask/);
  assert.match(evaluator, /evaluationDoesNotExecuteEffect/);
  assert.doesNotMatch(evaluator, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(evaluator, /insert\s+into\s+atlas\.tasks/i);
});

test('prerequisite task mutation is isolated in one internal effect consumer', () => {
  const effect = sectionBetween(
    'create or replace function atlas.apply_task_prerequisite_gate_effect_v1(',
    'revoke execute on function atlas.apply_task_prerequisite_gate_effect_v1(uuid,jsonb,timestamptz)',
  );

  assert.match(effect, /task_prerequisite_gate_evaluation_v1/);
  assert.match(effect, /Prerequisite evaluation does not belong to this downstream task/);
  assert.match(effect, /Prerequisite evaluation state and satisfied flag disagree/);
  assert.match(effect, /prerequisite_gate_restore/);
  assert.match(effect, /deferred_hidden/);
  assert.match(effect, /blocked_visible/);
  assert.match(effect, /prerequisite_gate_state', 'ready'/);
  assert.match(effect, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(effect, /update\s+atlas\.task_prerequisites/i);
});

test('legacy reconciler becomes orchestration rather than task-state authority', () => {
  const reconciler = sectionBetween(
    'create or replace function atlas.reconcile_task_prerequisite_gate_v1(',
    '$function$;\n',
  );

  assert.match(reconciler, /update\s+atlas\.task_prerequisites/i);
  assert.match(reconciler, /atlas\.task_prerequisite_gate_evaluation_v1/);
  assert.match(reconciler, /atlas\.apply_task_prerequisite_gate_effect_v1/);
  assert.doesNotMatch(reconciler, /update\s+atlas\.tasks/i);
});

test('new evaluator and effect stay private while existing reconciler custody is preserved', () => {
  assert.match(
    sql,
    /revoke execute on function atlas\.task_prerequisite_gate_evaluation_v1\(uuid\)[\s\S]*from public, anon, authenticated, service_role;/,
  );
  assert.match(
    sql,
    /revoke execute on function atlas\.apply_task_prerequisite_gate_effect_v1\(uuid,jsonb,timestamptz\)[\s\S]*from public, anon, authenticated, service_role;/,
  );
  assert.doesNotMatch(sql, /create\s+trigger/i);
  assert.doesNotMatch(sql, /drop\s+trigger/i);
});
