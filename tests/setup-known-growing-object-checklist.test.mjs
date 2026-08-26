import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const detail = read("components/atlas/site-layout-task-detail.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const migration = read("supabase/migrations/20260826224000_setup_known_growing_object_checklist_v1.sql");

test("Setup unit checklist materializes canonical objects without creating child tasks", () => {
  assert.match(migration, /known_growing_objects_v1/);
  assert.match(migration, /from atlas\.growing_objects go/);
  assert.match(migration, /go\.farm_id = v_task\.farm_id/);
  assert.match(migration, /go\.zone_id = v_task\.zone_id/);
  assert.match(migration, /go\.object_type = v_object_type/);
  assert.match(migration, /'setup_unit:' \|\| v_object\.stable_key/);
  assert.match(migration, /'source', 'atlas\.growing_objects'/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
  assert.doesNotMatch(migration, /d6bdf176-5ccd-493a-a983-007df422de2b/i);
});

test("Setup unit scope is snapshotted on task scope change and preserves checked state", () => {
  assert.match(migration, /after insert or update of metadata, zone_id on atlas\.tasks/);
  assert.match(migration, /snapshot_on_task_scope_change_v1/);
  assert.match(migration, /on conflict \(task_id,item_key\) do update/);
  assert.doesNotMatch(migration, /checked = excluded\.checked/);
  assert.match(migration, /'retired','true'/);
  assert.match(migration, /'retired', 'false'/);
});

test("U-Pick stake and string task declares bed units semantically rather than by generated id", () => {
  assert.match(migration, /t\.task_type = 'site_layout'/);
  assert.match(migration, /t\.action_key = 'measure_stake_string'/);
  assert.match(migration, /z\.stable_key = 'u_pick'/);
  assert.match(migration, /'setup_unit_object_type', 'bed'/);
});

test("Setup stays on its canonical family renderer while using governed checklist reads and writes", () => {
  assert.match(canonical, /if \(isSiteLayoutTask\(props\.task\)\)/);
  assert.match(detail, /family="Setup"/);
  assert.match(detail, /setup_unit_checklist/);
  assert.match(detail, /\/api\/atlas\/task-execution-checklist\?taskId=/);
  assert.match(detail, /x-atlas-intent": "task-execution-checklist-v1"/);
  assert.match(detail, /atlas-setup-checklist-row/);
  assert.match(detail, /aria-pressed=\{item\.checked\}/);
  assert.doesNotMatch(detail, /childTasks\.map/);
});

test("Setup checklist retains parent Done and Unfinished semantics", () => {
  assert.match(detail, /onDone=\{\(\) => void transition\("done"\)\}/);
  assert.match(detail, /onUnfinished=\{\(\) => setUnfinishedOpen/);
  assert.match(detail, /setup_unit_partial_prompt/);
  assert.match(detail, /writeChecklistItem\(task\.task_id, item\.itemKey, nextChecked\)/);
});
