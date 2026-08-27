import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const executionRoute = read("app/api/atlas/task-execution-structure/route.ts");
const resultRoute = read("app/api/atlas/work-result/route.ts");
const custodyContract = read("docs/architecture/shared-db-custody-consumer-v1.md");

test("structured work callers live at the authenticated app boundary without taking database-source custody", () => {
  assert.match(custodyContract, /farm-atlas` owns Atlas \*\*application source\*\*/i);
  assert.match(custodyContract, /noel-core-db` owns \*\*executable database migration source\*\*/i);
  assert.match(custodyContract, /does not copy post-fence migrations back into Farm Atlas/i);

  assert.match(executionRoute, /requireAtlasApiAccess/);
  assert.match(executionRoute, /supabase\.rpc\("worker_task_execution_structure_api_v1"/);
  assert.doesNotMatch(executionRoute, /service[_-]role/i);

  assert.match(resultRoute, /requireAtlasApiAccess/);
  assert.match(resultRoute, /effectiveOperatorMembershipId/);
  assert.match(resultRoute, /supabase\.rpc\("work_result_contract_v1"/);
  assert.match(resultRoute, /supabase\.rpc\("record_work_result_submission_v1"/);
  assert.match(resultRoute, /x-atlas-intent/);
  assert.match(resultRoute, /structured-work-result-v1/);
  assert.doesNotMatch(resultRoute, /service[_-]role/i);

  assert.doesNotMatch(executionRoute, /supabase\/migrations/);
  assert.doesNotMatch(resultRoute, /supabase\/migrations/);
});
