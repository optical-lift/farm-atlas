import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("canonical stand-count tasks are recognized from governed task metadata", () => {
  const contract = read("lib/atlas/input-contracts/worker-truth-observation.ts");

  assert.match(contract, /task_type === \"truth_acquisition_observation\"/);
  assert.match(contract, /structured_result_required/);
  assert.match(contract, /worker_truth_observation_contract/);
  assert.match(contract, /record_worker_truth_observation_v1/);
  assert.match(contract, /worker_observation_adapter/);
  assert.match(contract, /crop_observation_v1/);
  assert.match(contract, /worker_observation_key/);
  assert.match(contract, /stand_count/);
  assert.match(contract, /persistence: \"canonical\"/);
  assert.match(contract, /wholeNumber: true/);
  assert.match(contract, /unit: \"plants\"/);
});

test("canonical truth observations use the shared Atlas input renderer boundary", () => {
  const detail = read("components/atlas/truth-observation-task-detail.tsx");
  const renderer = read("components/atlas/input/AtlasInputRenderer.tsx");
  const ownerShim = read("app/owner/PersonAtlasInputSpread.tsx");
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(detail, /AtlasInputRenderer/);
  assert.match(detail, /createCanonicalWorkerTruthObservationContract/);
  assert.match(detail, /truth-observation-result/);
  assert.match(renderer, /contract: AtlasInputContract/);
  assert.match(renderer, /data-atlas-input-renderer=\"spread-v1\"/);
  assert.match(ownerShim, /components\/atlas\/input\/AtlasInputRenderer/);
  assert.match(canonical, /isCanonicalWorkerTruthObservationTask/);
  assert.match(canonical, /TruthObservationTaskDetail/);
});

test("truth-observation API derives authority from the task and writes only through the governed RPC", () => {
  const route = read("app/api/atlas/truth-observation-result/route.ts");

  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /same-origin Atlas request/);
  assert.match(route, /from\(\"tasks\"\)/);
  assert.match(route, /truth_acquisition_instance_id/);
  assert.match(route, /worker_observation_key/);
  assert.match(route, /record_worker_truth_observation_v1/);
  assert.match(route, /p_answer_kind: \"observed\"/);
  assert.match(route, /p_unit: \"plants\"/);
  assert.match(route, /Number\.isInteger\(livingPlants\)/);
  assert.doesNotMatch(route, /record_task_transition_v1|task-transition/);
  assert.doesNotMatch(route, /service_role|SUPABASE_SERVICE_ROLE_KEY/i);
});

test("Day cannot quick-complete a stand-count task without its structured result", () => {
  const day = read("app/day/page.tsx");

  assert.match(day, /structured_result_required/);
  assert.match(day, /requiresStructuredResult\(task\)/);
  assert.match(day, /window\.location\.assign\(taskResultHref\(task, returnTo\)\)/);
});
