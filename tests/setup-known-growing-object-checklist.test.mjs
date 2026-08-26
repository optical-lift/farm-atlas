import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const detail = read("components/atlas/site-layout-task-detail.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const attemptedMaterializer = read("supabase/migrations/20260826224150_setup_known_growing_object_checklist_v1.sql");
const corrective = read("supabase/migrations/20260826224303_revert_redundant_setup_unit_materializer_v1.sql");

test("repository ledger preserves and reverses the redundant Setup materializer exactly once", () => {
  assert.match(attemptedMaterializer, /create or replace function atlas\.ensure_setup_unit_checklist_v1/);
  assert.match(attemptedMaterializer, /from atlas\.growing_objects go/);
  assert.match(corrective, /drop trigger if exists sync_setup_unit_checklist_v1 on atlas\.tasks/);
  assert.match(corrective, /delete from atlas\.task_execution_checklist_items item/);
  assert.match(corrective, /drop function if exists atlas\.ensure_setup_unit_checklist_v1\(uuid\)/);
});

test("corrective migration preserves pre-existing canonical bed checks before removing duplicate rows", () => {
  assert.match(corrective, /canonical\.item_key = duplicate\.metadata->>'growing_object_stable_key'/);
  assert.match(corrective, /canonical\.metadata->>'setupUnitContract' = 'known_growing_objects_v1'/);
  assert.match(corrective, /set checked = canonical\.checked or duplicate\.checked/);
  assert.match(corrective, /item\.metadata->>'source' = 'atlas\.growing_objects'/);
  assert.doesNotMatch(corrective, /insert into atlas\.tasks/i);
});

test("Setup stays on its canonical family renderer while using the governed checklist endpoint", () => {
  assert.match(canonical, /if \(isSiteLayoutTask\(props\.task\)\)/);
  assert.match(detail, /family="Setup"/);
  assert.match(detail, /setup_unit_checklist/);
  assert.match(detail, /\/api\/atlas\/task-execution-checklist\?taskId=/);
  assert.match(detail, /x-atlas-intent": "task-execution-checklist-v1"/);
  assert.doesNotMatch(detail, /childTasks\.map/);
});

test("Setup renders real per-bed checklist state without changing parent completion semantics", () => {
  assert.match(detail, /atlas-setup-checklist-row/);
  assert.match(detail, /aria-pressed=\{item\.checked\}/);
  assert.match(detail, /writeChecklistItem\(task\.task_id, item\.itemKey, nextChecked\)/);
  assert.match(detail, /checklist\.completeCount/);
  assert.match(detail, /checklist\.completionLabel/);
  assert.match(detail, /onDone=\{\(\) => void transition\("done"\)\}/);
  assert.match(detail, /onUnfinished=\{\(\) => setUnfinishedOpen/);
  assert.match(detail, /setup_unit_partial_prompt/);
});
