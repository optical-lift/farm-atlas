import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('future Worker Day collection route survives canonical plan into the shared Day sequence', () => {
  const migration = read('supabase/migrations/20260825153933_future_worker_day_collection_route_v1.sql');
  const sequence = read('lib/atlas/day-sequence.ts');

  assert.match(migration, /'workRoute', nullif\(occurrence\.task_payload->'metadata'->>'work_route',''\)/);
  assert.match(sequence, /workRoute\?: string \| null;/);
  assert.match(sequence, /workRoute: string \| null;/);
  assert.equal((sequence.match(/workRoute: text\(row\.workRoute\)/g) ?? []).length, 2);
});
