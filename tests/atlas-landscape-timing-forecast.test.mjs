import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("annual landscape cards use the shared execution-detail contract", () => {
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const dominion = read("components/atlas/dominion-assigned-task-detail.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const execution = read("lib/atlas/task-execution.ts");

  assert.match(shell, /TaskExecutionBrief/);
  assert.match(brief, /taskExecutionModel\(task\)/);
  assert.match(brief, /More instructions/);
  assert.match(execution, /atlasMetaString\(task, "execution_details"\)/);
  assert.match(execution, /const details = explicitDetails/);

  // Timing belongs in the shared execution shell/details; neither the shell nor
  // the Dominion compatibility wrapper maintains an annual-only forecast parser.
  assert.doesNotMatch(shell, /<strong>Timing forecast<\/strong>/);
  assert.doesNotMatch(shell, /timing\.facts\.map/);
  assert.doesNotMatch(shell, /"sow window": "Sow window"/);
  assert.match(dominion, /AssignedTaskExecutionShell/);
  assert.doesNotMatch(dominion, /Timing forecast/);
});
