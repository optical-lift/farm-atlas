import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("annual landscape cards use the shared execution-detail contract", () => {
  const dominion = read("components/atlas/dominion-assigned-task-detail.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const execution = read("lib/atlas/task-execution.ts");

  assert.match(dominion, /TaskExecutionBrief/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /More instructions/);
  assert.match(execution, /atlasMetaString\(task, "execution_details"\)/);
  assert.match(execution, /const details = explicitDetails/);

  // Timing belongs in the task's shared execution details now; Dominion should
  // not maintain a second annual-only timing forecast parser or vocabulary.
  assert.doesNotMatch(dominion, /<strong>Timing forecast<\/strong>/);
  assert.doesNotMatch(dominion, /timing\.facts\.map/);
  assert.doesNotMatch(dominion, /"sow window": "Sow window"/);
});
