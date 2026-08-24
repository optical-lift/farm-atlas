import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const placementMigration = 'supabase/migrations/20260824131121_work_definition_day_placement_authority_v1.sql';
const genericOrderingMigration = 'supabase/migrations/20260824132428_worker_day_remove_farm_round_identity_ordering_v1.sql';

test('Farm Round chronology is stored on its reusable work definition', () => {
  const sql = read(placementMigration);
  assert.match(sql, /'dayPlacement', jsonb_build_object\('window','morning','anchor','top','order',0\)/);
  assert.match(sql, /'dayPlacementAuthority','work_definition'/);
  assert.match(sql, /v_definition\.metadata->'dayPlacement'/);
  assert.match(sql, /'day_placement_source','work_definition'/);
  assert.doesNotMatch(sql, /'day_order',40/);
});

test('existing and future occurrences inherit the same stored placement', () => {
  const sql = read(placementMigration);
  assert.match(sql, /\) \|\| v_placement_metadata/);
  assert.match(sql, /update atlas\.planned_work_occurrences o/);
  assert.match(sql, /update atlas\.tasks t/);
  assert.match(sql, /'day_work_order',case when .*placement \? 'order'/s);
});

test('Worker Day ordering consumes generic metadata and has no Farm Round identity rule', () => {
  const sql = read(genericOrderingMigration);
  assert.doesNotMatch(sql, /farm_round|stewardship_round|farm_round_parent/i);
  assert.match(sql, /p_metadata->>'day_work_order'/);
  assert.match(sql, /if v_explicit is not null then return v_explicit; end if;/);

  const source = read('lib/atlas/work-order.ts');
  assert.doesNotMatch(source, /farm_round|stewardship_round|farm_round_parent/i);
  assert.match(source, /atlasMetaNumber\(task, "day_work_order", "work_order", "day_order_override", "run_sheet_order"\)/);
  assert.match(source, /if \(explicit !== null\) return explicit;/);
});
