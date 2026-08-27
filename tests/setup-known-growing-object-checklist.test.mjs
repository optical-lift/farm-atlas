import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const detail = read("components/atlas/site-layout-task-detail.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const custodyContract = read("docs/architecture/shared-db-custody-consumer-v1.md");

test("Setup checklist regression stays on the app-owned runtime contract instead of database migration source", () => {
  assert.match(custodyContract, /optical-lift\/noel-core-db` owns \*\*executable database migration source\*\*/i);
  assert.match(custodyContract, /does not copy post-fence migrations back into Farm Atlas/i);
  assert.doesNotMatch(import.meta.url, /supabase\/migrations/);
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
