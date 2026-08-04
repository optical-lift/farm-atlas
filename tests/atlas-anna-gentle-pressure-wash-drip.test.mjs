import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationPath = new URL(
  '../supabase/migrations/20260804181000_anna_gentle_pressure_wash_drip_v1.sql',
  import.meta.url,
);

const migration = await readFile(migrationPath, 'utf8');

test('the gentle pressure-washing work is split into seven small physical goals', () => {
  for (const title of [
    'Gently Pressure Wash Back Porch',
    'Gently Pressure Wash Front Porch',
    'Pressure Wash Concrete Entrance Porch',
    'Gently Pressure Wash Attached Garage Face',
    'Gently Pressure Wash Detached Garage Face',
    'Gently Pressure Wash Behind the Garage Spirea',
    'Gently Pressure Wash Library Addition Siding',
  ]) {
    assert.match(migration, new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('each occurrence waits until its own fixed date instead of flooding Anna today', () => {
  assert.match(migration, /'time_window',\s*0,\s*1,/);
  assert.match(migration, /item\.due_date,\s*jsonb_build_object\(/);
  assert.match(migration, /scheduled_to_appear_on_due_date', true/);
  assert.match(migration, /work_lane = 'process_continuation'/);
  assert.match(migration, /commitment_kind = 'hard_date'/);
});

test('every cleaning goal is linked to a canonical physical object', () => {
  assert.match(migration, /venue_back_porch/);
  assert.match(migration, /venue_concrete_entrance_porch/);
  assert.match(migration, /venue_library_addition_exterior/);
  assert.match(migration, /attached_garage_wall_behind_spirea/);
  assert.match(migration, /'task_objects'/);
  assert.match(migration, /'object_id', item\.object_id/);
});

test('the schedule skips Sunday and avoids exterior-door painting days for the front porch', () => {
  for (const date of ['2026-08-06', '2026-08-08', '2026-08-10', '2026-08-11', '2026-08-12', '2026-08-14', '2026-08-15']) {
    assert.match(migration, new RegExp(date));
  }
  assert.doesNotMatch(migration, /date '2026-08-09'/);
  assert.match(migration, /date '2026-08-14',[\s\S]*'front_porch'/);
});
