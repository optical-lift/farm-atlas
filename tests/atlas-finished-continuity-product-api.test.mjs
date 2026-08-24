import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const migration = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260824002300_atlas_wide_continuity_finished_runtime_name_v1.sql'),
  'utf8',
);

test('finished Atlas continuity exposes one stable unversioned product API', () => {
  assert.match(migration, /rename to atlas_wide_continuity_summary/);
  assert.match(migration, /grant execute on function atlas\.atlas_wide_continuity_summary\(uuid,date\) to authenticated, service_role/i);
  assert.match(migration, /signature='atlas\.atlas_wide_continuity_summary_v1\(uuid, date\)'/);
  assert.match(migration, /'atlas\.atlas_wide_continuity_summary\(uuid, date\)'/);
  assert.match(migration, /canonicalProductAuthority','atlas\.atlas_wide_continuity_summary'/);
  assert.match(migration, /finishedSurface',true/);
  assert.match(migration, /Versioned Atlas-wide continuity names remain migration history only/i);
  assert.doesNotMatch(migration, /grant execute on function atlas\.atlas_wide_continuity_summary_v1/i);
});
