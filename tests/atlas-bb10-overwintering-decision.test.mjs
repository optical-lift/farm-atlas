import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260804173500_bb10_overwintering_crop_decision_v1.sql',
  import.meta.url,
);

const migration = await readFile(migrationPath, 'utf8');

test('BB10 ends in an open overwintering crop decision, not a preselected Horizon sowing', () => {
  assert.match(migration, /Choose Overwintering Crop for BB10/);
  assert.match(migration, /crop_plan_status', 'open_decision'/);
  assert.match(migration, /decision_scope', 'overwintering_crop'/);
  assert.match(migration, /delete from atlas\.task_crop_cycles/);
  assert.match(migration, /lifecycle_status = 'archived'/);
  assert.match(migration, /Confirm BB10 Treatment Is Complete/);
});

test('the released occurrence no longer carries a crop-cycle relation', () => {
  assert.match(migration, /relation_payload = coalesce\(relation_payload, '\{\}'::jsonb\) - 'task_crop_cycles'/);
  assert.match(migration, /No crop is preselected/);
});
