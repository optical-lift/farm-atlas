import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker-facing planner vocabulary is filtered before render", () => {
  const worker = read("lib/atlas/worker-display.ts");
  const workOrder = read("lib/atlas/work-order.ts");
  const layout = read("app/layout.tsx");

  assert.equal(existsSync(new URL("../app/WorkerVocabularyCleanupPatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /WorkerVocabularyCleanupPatch/);
  assert.match(worker, /atlasWorkerDisplayText/);
  assert.match(worker, /top of list/);
  assert.match(worker, /midday flex/);
  assert.match(worker, /last thing/);
  assert.match(workOrder, /return atlasWorkerDisplayText\(plannerWorkOrderLabel\(task\)\)/);
  assert.doesNotMatch(worker + workOrder, /MutationObserver|document\.querySelector/);
});
