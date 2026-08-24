import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const migrationPath = 'supabase/migrations/20260824131121_work_definition_day_placement_authority_v1.sql';

test('Farm Round placement is reusable work-definition data, not generator order prose', () => {
  const sql = read(migrationPath);
  assert.match(sql, /'dayPlacement', jsonb_build_object\('window','morning','anchor','top','order',0\)/);
  assert.match(sql, /'dayPlacementAuthority','work_definition'/);
  assert.match(sql, /v_definition\.metadata->'dayPlacement'/);
  assert.match(sql, /'day_placement_source','work_definition'/);
  assert.doesNotMatch(sql, /'day_order',40/);
});

test('released and future Farm Round work inherit the same stored placement policy', () => {
  const sql = read(migrationPath);
  assert.match(sql, /v_payload:=jsonb_build_object/);
  assert.match(sql, /\) \|\| v_placement_metadata/);
  assert.match(sql, /update atlas\.planned_work_occurrences o/);
  assert.match(sql, /update atlas\.tasks t/);
  assert.match(sql, /'day_work_order',case when .*placement \? 'order'/s);
});

test('worker timeline ordering stays generic and does not know Farm Round identity', () => {
  const source = read('lib/atlas/work-order.ts');
  assert.doesNotMatch(source, /farm_round|stewardship_round|farm_round_parent/i);
  assert.match(source, /atlasMetaNumber\(task, "day_work_order", "work_order", "day_order_override", "run_sheet_order"\)/);
  assert.match(source, /if \(explicit !== null\) return explicit;/);
});
